---
name: python-mcp-module-tuneup
description: Workflow for upgrading an existing Python FastMCP server module — enrich tool descriptions, add a status/introspection tool, parallelize sequential batch work with asyncio.to_thread + Semaphore (sync boundary preserved), and update tests for the new concurrency model.
source: auto-skill
extracted_at: '2026-07-15T07:54:57.833Z'
---

# Tune up an existing Python FastMCP module

Use this when you have a working FastMCP server that:
- has tools with thin descriptions agents don't understand
- does sequential per-chunk HTTP work that's slow on real workloads
- has no introspection tool, so agents start blind

Apply the four changes in order. They compose: each later step builds on the previous one's mental model.

## Step 1 — Enrich existing tool descriptions

Each tool description should answer three questions an agent new to the module will ask:

1. **What does this tool do in one sentence?** (already there)
2. **Where does it fit in the pipeline?** Name the loaders, splitters, embedding model with default + dims.
3. **What doesn't it do?** Especially: is this retrieval-only or does it synthesize answers?

Concretely, for each `mcp.tool(...)` block add a `\n\n` paragraph after the existing text:

```python
@mcp.tool(
    name="search",
    title="Semantic search the RAG index",
    description=(
        "Return the top-k chunks most similar to the query..."  # existing
        "\n\n"
        "Retrieval-only: this tool returns RAW CHUNKS, not a natural-"
        "language answer. The calling model must synthesize the final "
        "response from the returned chunks and cite them.\n\n"
        "Cosine similarity is computed over vectors from the configured "
        "embedding model — call `rag_status` to confirm the active "
        "model and vector dimensionality before relying on scores."
    ),
    annotations=_READ_ONLY,
)
```

Same pattern for ingest tools: name the model, the dims, the splitter, and the env vars that change behavior.

## Step 2 — Add a `*_status` tool as the first-call surface

Agents shouldn't have to guess provider state. Add a Pydantic output model and a read-only tool that returns:
- active provider / base_url / model / dimensions (null when unknown)
- chunk size + overlap
- counts (sources, chunks)

Description should explicitly tell the agent to call this first, and what to do based on the result:

```python
@_READ_ONLY  # readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
```

If you don't know the dimensions for a model, surface `None` rather than guessing — agents need honesty, not plausible lies. Use a `KNOWN_DIMENSIONS` dict in `config.py` and let unknown models fall through.

Implement the status function alongside the other retrieve functions, so it shares the chroma/persistent-client boilerplate.

## Step 3 — Parallelize sequential batch HTTP with sync boundary preserved

> **CRITICAL:** Do NOT use `asyncio.run()` in the sync wrapper. FastMCP runs tool handlers inside its own event loop, so `asyncio.run()` raises `"cannot be called from a running event loop"` and breaks every tool that calls the batch function (`ingest_file`, `ingest_directory`, etc.). Use a `ThreadPoolExecutor` instead — pure threads, no asyncio, works inside any context.

When you have:

```python
def embed_batch(texts: list[str]) -> list[list[float]]:
    return [embed_one(t) for t in texts]
```

Replace with a thread-pool fan-out that keeps the public function sync (so existing callers and module-level monkeypatches keep working):

```python
from concurrent.futures import ThreadPoolExecutor

from ..config import EMBED_CONCURRENCY  # int, e.g. 4


def embed_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []  # never spin up a pool for empty input
    # `pool.map` preserves input order in the output, so result[i] matches
    # texts[i] regardless of completion order.
    with ThreadPoolExecutor(max_workers=EMBED_CONCURRENCY) as pool:
        return list(pool.map(embed_one, texts))
```

Key invariants:
- `embed_one` stays **synchronous and unchanged** — tests that do `emb.httpx.post = fake_post` keep working because each thread reads the module-level reference at call time.
- **Why `ThreadPoolExecutor` and not `asyncio.run(...)` + `asyncio.gather(...)`:** FastMCP tool handlers run inside an asyncio loop. `asyncio.run()` from a sync wrapper would try to create a NEW loop, which fails with `RuntimeError: asyncio.run() cannot be called from a running event loop`. A pure-thread implementation has no event-loop interaction. Symptom: every ingest-related tool fails with that RuntimeError; introspection tools (`list_sources`, `*_status`, `delete_source`) keep working because they don't touch the batch function.
- Cap concurrency with `max_workers`. The cap should reflect the **client-side bottleneck** (HTTP sockets, GIL on JSON parsing), not the server's throughput. 4 is a sane default for an Ollama-on-localhost setup.
- Empty input must short-circuit before pool construction (avoid the overhead of an empty pool).
- If you genuinely need async in the **server's** code (e.g. you're calling an `httpx.AsyncClient` from inside a tool), do that directly inside the `async def` tool handler — don't bridge through a sync wrapper.

## Step 4 — Update tests for the parallel model

### 4a. Order assertions move from captures to results

The old test probably looks like:

```python
self.assertEqual([c["prompt"] for c in captured], ["x", "y"])
```

With parallel HTTP calls, capture order is **non-deterministic** even though result order from `asyncio.gather` is preserved. Change the assertion to verify what's actually contractually guaranteed:

```python
# Result order MUST match input order regardless of HTTP timing.
self.assertEqual(out, [[0.1], [0.1]])
# Each input must produce exactly one HTTP call (no dupes, no drops).
self.assertEqual(len(captured), len(texts))
self.assertEqual(sorted(c["prompt"] for c in captured), sorted(texts))
```

Add a small `time.sleep(0.01)` inside the mock handler to make the race observable — without it, the test can pass even if you accidentally re-introduce a sequential implementation.

### 4b. Add tests for the new status tool

Cover three cases:
1. **Empty index** — `sources=0, chunks=0`, provider/model/dims reflect config.
2. **Unknown model** — set `EMBED_MODEL` to a name not in `KNOWN_DIMENSIONS`, assert `embed_dimensions is None`. Use `retrieve.EMBED_MODEL = "..."` directly because `from ..config import` captures the binding at reload time.
3. **Populated index** — add chunks directly via `coll.add(...)` (skip the embedder to stay offline), assert `chunks` and `sources` counts reflect them.

```python
coll.add(
    ids=["doc-a::0", "doc-a::1"],
    documents=["a1", "a2"],
    embeddings=[[0.1] * 1024, [0.2] * 1024],
    metadatas=[{"source": "/tmp/a.txt", "filename": "a.txt"}, ...],
)
status = retrieve.get_status()
self.assertEqual(status["chunks"], 2)
```

### 4c. Test gotcha: `reloaded_config` reloads in `finally`

If your test helper looks like:

```python
@contextmanager
def reloaded_config(env=None):
    saved = {...}
    # clear env, apply env, reload modules
    try:
        yield cfg, policy, embeddings, ingest, retrieve
    finally:
        # restore env, reload modules AGAIN
```

Then **all assertions must be INSIDE the `with` block**. After the `with` exits, the helper reloads modules with the restored env, so values you captured inside may not equal values you read outside:

```python
# WRONG — assertion runs after reloaded_config's finally has reloaded
with reloaded_config() as (cfg, _, _, _, retrieve):
    status = retrieve.get_status()
self.assertEqual(status["embed_model"], cfg.EMBED_MODEL)  # cfg.EMBED_MODEL has changed!

# RIGHT — assertions live inside the with
with reloaded_config() as (cfg, _, _, _, retrieve):
    status = retrieve.get_status()
    self.assertEqual(status["embed_model"], cfg.EMBED_MODEL)  # both still bound to reloaded state
```

When you need to override a module-level constant for one test (e.g. setting `EMBED_MODEL` to an unknown name), patch the **consumer module** (`retrieve.EMBED_MODEL = "..."`), not the source (`cfg.EMBED_MODEL`). The consumer captured the binding at reload time.

## Verification

After all four steps:
```bash
python -m unittest discover -s tests -v
```

Expect test count to grow by ~3-5 (one new batch-order test, one empty-input test, three status tests). All previous tests must still pass — no public API changed, only internals and descriptions.

Confirm via MCP introspection that the new tool is registered with the right title:
```python
async def list_tools():
    return await mcp.list_tools()
```

## When NOT to use this skill

- The module is brand new and has zero tools — write fresh, don't retrofit.
- The batch operation is already parallel and tested for order — skip step 3 and 4a.
- The server already has a `*_status` or equivalent introspection tool — skip step 2.
- The MCP server is JS/TS (this skill is Python-specific: `asyncio.to_thread`, Pydantic models).
