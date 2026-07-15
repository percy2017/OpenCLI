import os
import tempfile
import unittest
from pathlib import Path

from tests._helpers import reloaded_config


class PathPolicyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.allowed = self.tmp / "allowed"
        self.outside = self.tmp / "outside"
        self.allowed.mkdir()
        self.outside.mkdir()
        self.allowed_file = self.allowed / "doc.txt"
        self.allowed_file.write_text("hello", encoding="utf-8")
        self.outside_file = self.outside / "secret.txt"
        self.outside_file.write_text("nope", encoding="utf-8")

    def _enter(self):
        return reloaded_config({"RAG_ALLOWED_ROOTS": str(self.allowed)})

    def test_unset_roots_falls_back_to_home_cloudcli(self):
        # When neither env var is set, ALLOWED_ROOTS defaults to ~/.cloudcli.
        # The legacy "is not configured" branch in policy.py is now
        # unreachable; paths outside the fallback are rejected by the
        # standard "not within any allowed root" check.
        with reloaded_config() as (cfg, policy, *_):
            from pathlib import Path as _P
            self.assertEqual(len(cfg.ALLOWED_ROOTS), 1)
            self.assertEqual(cfg.ALLOWED_ROOTS[0], _P.home() / ".cloudcli")
            with self.assertRaises(policy.PathNotAllowedError) as ctx:
                policy.validate_path(self.allowed_file)
            self.assertIn("not within any allowed root", str(ctx.exception))

    def test_path_inside_root_is_allowed(self):
        with self._enter() as (cfg, policy, *_):
            resolved = policy.validate_path(self.allowed_file)
            self.assertEqual(resolved, self.allowed_file.resolve())

    def test_path_outside_root_is_rejected(self):
        with self._enter() as (cfg, policy, *_):
            with self.assertRaises(policy.PathNotAllowedError) as ctx:
                policy.validate_path(self.outside_file)
            self.assertIn("not within any allowed root", str(ctx.exception))

    def test_symlink_inside_root_pointing_outside_is_rejected(self):
        link = self.allowed / "escape"
        os.symlink(self.outside_file, link)
        with self._enter() as (cfg, policy, *_):
            with self.assertRaises(policy.PathNotAllowedError):
                policy.validate_path(link)

    def test_nonexistent_path_inside_root_resolves(self):
        ghost = self.allowed / "future.txt"
        with self._enter() as (cfg, policy, *_):
            resolved = policy.validate_path(ghost)
            self.assertEqual(resolved, ghost.resolve())

    def test_ingest_file_returns_error_dict_when_path_blocked(self):
        from rag_mcp.rag.ingest import ingest_file
        with self._enter():
            result = ingest_file(str(self.outside_file))
        self.assertEqual(result["status"], "error")
        self.assertIn("not within any allowed root", result["error"])

    def test_ingest_directory_returns_error_dict_when_path_blocked(self):
        from rag_mcp.rag.ingest import ingest_directory
        with self._enter():
            result = ingest_directory(str(self.outside))
        self.assertEqual(result["status"], "error")
        self.assertIn("not within any allowed root", result["error"])

    def test_symlinked_root_accepts_path_inside_target(self):
        # Root itself is a symlink to a real directory; inputs resolved
        # against the symlinked root should still be accepted.
        real = self.tmp / "real_data"
        real.mkdir()
        target = self.tmp / "allowed_link"
        os.symlink(real, target)
        with reloaded_config({"RAG_ALLOWED_ROOTS": str(target)}) as (_, policy, *_):
            inside = real / "doc.txt"
            inside.write_text("ok", encoding="utf-8")
            resolved = policy.validate_path(inside)
            self.assertTrue(str(resolved).startswith(str(real.resolve())))

    def test_path_outside_symlinked_root_is_rejected(self):
        real = self.tmp / "real_data"
        real.mkdir()
        target = self.tmp / "allowed_link"
        os.symlink(real, target)
        with reloaded_config({"RAG_ALLOWED_ROOTS": str(target)}) as (_, policy, *_):
            other = self.tmp / "other"
            other.mkdir()
            outside = other / "doc.txt"
            outside.write_text("nope", encoding="utf-8")
            with self.assertRaises(policy.PathNotAllowedError):
                policy.validate_path(outside)


if __name__ == "__main__":
    unittest.main()