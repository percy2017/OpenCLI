"""Tests for the `rag_status` tool surface: empty index, populated index,
and KNOWN_DIMENSIONS lookup."""
import tempfile
import unittest
from pathlib import Path

from tests._helpers import reloaded_config


class StatusTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp_chroma = Path(self._tmp.name) / "chroma"
        self.tmp_chroma.mkdir()

    def test_status_empty_index(self):
        # Reload so retrieve binds to the freshly-reloaded config, then
        # monkeypatch CHROMA_DIR on the retrieve module to redirect the
        # collection to an empty temp dir. Assertions live INSIDE the `with`
        # because reloaded_config reloads modules again in its `finally`.
        with reloaded_config() as (cfg, _, _, _, retrieve):
            original = retrieve.CHROMA_DIR
            retrieve.CHROMA_DIR = self.tmp_chroma
            try:
                status = retrieve.get_status()
            finally:
                retrieve.CHROMA_DIR = original

            self.assertEqual(status["provider"], "ollama")
            self.assertEqual(status["embed_model"], cfg.EMBED_MODEL)
            # Default model is mxbai-embed-large:latest → 1024 dims.
            self.assertEqual(status["embed_dimensions"], 1024)
            self.assertEqual(status["sources"], 0)
            self.assertEqual(status["chunks"], 0)
            self.assertEqual(status["chunk_size"], cfg.CHUNK_SIZE)
            self.assertEqual(status["chunk_overlap"], cfg.CHUNK_OVERLAP)
            self.assertTrue(status["base_url"].startswith("http"))

    def test_status_unknown_model_reports_null_dimensions(self):
        # Override EMBED_MODEL to a name not in KNOWN_DIMENSIONS — the status
        # must surface that instead of guessing.
        with reloaded_config() as (_, _, _, _, retrieve):
            # Mutate cfg via the retrieve module: retrieve.EMBED_MODEL is
            # a binding captured at reload time, so patching retrieve is
            # the only way to override after reload has finished.
            retrieve.EMBED_MODEL = "mystery-embedder-7b"
            original = retrieve.CHROMA_DIR
            retrieve.CHROMA_DIR = self.tmp_chroma
            try:
                status = retrieve.get_status()
            finally:
                retrieve.CHROMA_DIR = original

            self.assertEqual(status["embed_model"], "mystery-embedder-7b")
            self.assertIsNone(status["embed_dimensions"])

    def test_status_reflects_populated_index(self):
        # Drop chunks directly via the collection API (skips the embedder)
        # so the test stays offline. Confirms sources/chunks counts move.
        with reloaded_config() as (_, _, _, _, retrieve):
            original = retrieve.CHROMA_DIR
            retrieve.CHROMA_DIR = self.tmp_chroma
            try:
                coll = retrieve._collection()
                coll.add(
                    ids=["doc-a::0", "doc-a::1", "doc-b::0"],
                    documents=["a1", "a2", "b1"],
                    embeddings=[[0.1] * 1024, [0.2] * 1024, [0.3] * 1024],
                    metadatas=[
                        {"source": "/tmp/a.txt", "filename": "a.txt"},
                        {"source": "/tmp/a.txt", "filename": "a.txt"},
                        {"source": "/tmp/b.txt", "filename": "b.txt"},
                    ],
                )
                status = retrieve.get_status()
            finally:
                retrieve.CHROMA_DIR = original

            self.assertEqual(status["chunks"], 3)
            self.assertEqual(status["sources"], 2)


if __name__ == "__main__":
    unittest.main()