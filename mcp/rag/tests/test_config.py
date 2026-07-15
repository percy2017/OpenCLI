import os
import unittest
from pathlib import Path

from tests._helpers import reloaded_config


class ConfigEnvTests(unittest.TestCase):
    def test_defaults_when_no_env_set(self):
        with reloaded_config() as (cfg, *_):
            # Default aligns with OpenCLI's .env default; tests must not assume
            # a different value when neither name is set in env.
            self.assertEqual(cfg.OLLAMA_URL, "http://127.0.0.1:11434")
            self.assertEqual(cfg.EMBED_MODEL, "mxbai-embed-large:latest")
            self.assertEqual(cfg.EMBED_TIMEOUT, 60.0)
            self.assertEqual(cfg.CHUNK_SIZE, 512)
            self.assertEqual(cfg.CHUNK_OVERLAP, 50)
            # When neither RAG_ALLOWED_ROOTS nor WORKSPACES_ROOT is set, the
            # config falls back to ~/.cloudcli so the MCP doesn't reject
            # every ingest out of the box.
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 1)
            self.assertEqual(cfg.ALLOWED_ROOTS[0], Path.home() / ".cloudcli")

    def test_workpaces_root_falls_back_to_allowed_roots(self):
        with reloaded_config({"WORKSPACES_ROOT": "/srv/docs"}) as (cfg, *_):
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 1)
            self.assertEqual(str(cfg.ALLOWED_ROOTS[0]), str(Path("/srv/docs").resolve()))

    def test_explicit_allowed_roots_wins_over_workpaces_root(self):
        with reloaded_config({
            "RAG_ALLOWED_ROOTS": "/srv/primary",
            "WORKSPACES_ROOT": "/srv/fallback",
        }) as (cfg, *_):
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 1)
            self.assertEqual(str(cfg.ALLOWED_ROOTS[0]), str(Path("/srv/primary").resolve()))

    def test_ollama_base_url_falls_back(self):
        with reloaded_config({"OLLAMA_BASE_URL": "http://other:1234"}) as (cfg, *_):
            self.assertEqual(cfg.OLLAMA_URL, "http://other:1234")

    def test_env_overrides_take_effect(self):
        env = {
            "OLLAMA_URL": "http://other-host:9999",
            "OLLAMA_EMBED_MODEL": "nomic-embed-text",
            "OLLAMA_EMBED_TIMEOUT": "12.5",
            "RAG_CHUNK_SIZE": "500",
            "RAG_CHUNK_OVERLAP": "50",
        }
        with reloaded_config(env) as (cfg, *_):
            self.assertEqual(cfg.OLLAMA_URL, "http://other-host:9999")
            self.assertEqual(cfg.EMBED_MODEL, "nomic-embed-text")
            self.assertEqual(cfg.EMBED_TIMEOUT, 12.5)
            self.assertEqual(cfg.CHUNK_SIZE, 500)
            self.assertEqual(cfg.CHUNK_OVERLAP, 50)

    def test_allowed_roots_parses_colon_separated_paths(self):
        with reloaded_config({"RAG_ALLOWED_ROOTS": "/tmp/a:/tmp/b"}) as (cfg, *_):
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 2)
            self.assertTrue(all(isinstance(r, Path) for r in cfg.ALLOWED_ROOTS))
            self.assertEqual({str(r) for r in cfg.ALLOWED_ROOTS}, {str(Path("/tmp/a").resolve()), str(Path("/tmp/b").resolve())})

    def test_allowed_roots_skips_empty_segments(self):
        with reloaded_config({"RAG_ALLOWED_ROOTS": ":/tmp/x::"}) as (cfg, *_):
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 1)
            self.assertEqual(str(cfg.ALLOWED_ROOTS[0]), str(Path("/tmp/x").resolve()))

    def test_env_restored_after_reload(self):
        # Snapshot previous values
        prior = {k: os.environ.get(k) for k in ("OLLAMA_URL",)}
        with reloaded_config({"OLLAMA_URL": "http://scratch:1234"}):
            pass
        for k, v in prior.items():
            if v is None:
                self.assertNotIn(k, os.environ)
            else:
                self.assertEqual(os.environ[k], v)


if __name__ == "__main__":
    unittest.main()