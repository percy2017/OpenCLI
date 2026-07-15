import unittest

import httpx

from tests._helpers import reloaded_config


class _PatchedHttpxClient:
    """Re-route httpx.post through a MockTransport-managed Client.

    rag.embeddings.embed_one() calls `httpx.post(url, json=..., timeout=...)`;
    swapping the module attribute for an object with the same `.post` shape
    lets us assert on the request payload without a real network."""

    def __init__(self, transport: httpx.MockTransport):
        self._client = httpx.Client(transport=transport)

    def post(self, url, json=None, timeout=None):  # noqa: A002
        return self._client.post(url, json=json, timeout=timeout)


class EmbeddingHelperTests(unittest.TestCase):
    def test_embed_one_uses_prompt_field(self):
        with reloaded_config() as (cfg, _, embeddings, *_):
            cfg.OLLAMA_URL = "http://test-ollama"

            captured: list[dict] = []

            def handler(request: httpx.Request) -> httpx.Response:
                import json
                captured.append(json.loads(request.content))
                return httpx.Response(200, json={"embedding": [0.42]})

            transport = httpx.MockTransport(handler)
            patched = _PatchedHttpxClient(transport)

            import rag_mcp.rag.embeddings as emb
            original = emb.httpx
            emb.httpx = patched
            try:
                vec = emb.embed_one("hi")
            finally:
                emb.httpx = original

            self.assertEqual(vec, [0.42])
            self.assertEqual(captured[0]["prompt"], "hi")
            self.assertEqual(captured[0]["model"], cfg.EMBED_MODEL)
            # Regression guard: legacy `prompt` field must stay; no `input`.
            self.assertNotIn("input", captured[0])

    def test_embed_batch_preserves_input_order_in_results(self):
        with reloaded_config() as (cfg, _, embeddings, *_):
            cfg.OLLAMA_URL = "http://test-ollama"

            captured: list[dict] = []

            def handler(request: httpx.Request) -> httpx.Response:
                import json
                # Tiny sleep makes the race observable when the implementation
                # is sequential; parallel calls land here in non-deterministic
                # order but `embed_batch` must still return chunks in input order.
                import time
                time.sleep(0.01)
                captured.append(json.loads(request.content))
                return httpx.Response(200, json={"embedding": [0.1]})

            transport = httpx.MockTransport(handler)
            patched = _PatchedHttpxClient(transport)

            import rag_mcp.rag.embeddings as emb
            original = emb.httpx
            emb.httpx = patched
            try:
                out = emb.embed_batch(["x", "y", "z"])
            finally:
                emb.httpx = original

            # Result order MUST match input order regardless of HTTP timing.
            self.assertEqual(len(out), 3)
            self.assertEqual(out, [[0.1], [0.1], [0.1]])
            # Each input must produce exactly one HTTP call (no dupes, no drops).
            self.assertEqual(len(captured), 3)
            self.assertEqual(
                sorted(c["prompt"] for c in captured),
                ["x", "y", "z"],
            )

    def test_embed_batch_empty_input_short_circuits(self):
        # No async loop should spin up for an empty batch.
        with reloaded_config({"RAG_EMBED_CONCURRENCY": "4"}):
            import rag_mcp.rag.embeddings as emb
            self.assertEqual(emb.embed_batch([]), [])

    def test_embed_batch_works_inside_running_event_loop(self):
        # Regression guard: an earlier implementation used `asyncio.run()`
        # inside the sync `embed_batch`, which raises "cannot be called from
        # a running event loop" when invoked from FastMCP's tool handler
        # (FastMCP runs tools inside its own asyncio loop). Pure-thread
        # implementation sidesteps that — this test pins the behavior.
        import asyncio
        import httpx

        with reloaded_config({"RAG_EMBED_CONCURRENCY": "4"}):
            import rag_mcp.rag.embeddings as emb

            class _Resp:
                def __init__(self, vec):
                    self._vec = vec
                    self.request = httpx.Request("POST", "http://t")

                def raise_for_status(self):
                    pass

                def json(self):
                    return {"embedding": self._vec}

            captured: list[str] = []

            def handler(url, json=None, timeout=None):  # noqa: A002
                captured.append(json["prompt"])
                return _Resp([0.42])

            original = emb.httpx.post
            emb.httpx.post = handler
            try:
                async def call_from_inside_loop():
                    # `ingest_file` reaches `embed_batch` synchronously from
                    # inside FastMCP's event loop. Mirror that here.
                    return emb.embed_batch(["x", "y"])

                result = asyncio.run(call_from_inside_loop())
            finally:
                emb.httpx.post = original

            self.assertEqual(result, [[0.42], [0.42]])
            self.assertEqual(sorted(captured), ["x", "y"])


if __name__ == "__main__":
    unittest.main()