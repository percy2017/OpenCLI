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

    def test_embed_batch_calls_per_chunk_in_order(self):
        with reloaded_config() as (cfg, _, embeddings, *_):
            cfg.OLLAMA_URL = "http://test-ollama"

            captured: list[dict] = []

            def handler(request: httpx.Request) -> httpx.Response:
                import json
                captured.append(json.loads(request.content))
                return httpx.Response(200, json={"embedding": [0.1]})

            transport = httpx.MockTransport(handler)
            patched = _PatchedHttpxClient(transport)

            import rag_mcp.rag.embeddings as emb
            original = emb.httpx
            emb.httpx = patched
            try:
                out = emb.embed_batch(["x", "y"])
            finally:
                emb.httpx = original

            self.assertEqual(out, [[0.1], [0.1]])
            self.assertEqual([c["prompt"] for c in captured], ["x", "y"])


if __name__ == "__main__":
    unittest.main()