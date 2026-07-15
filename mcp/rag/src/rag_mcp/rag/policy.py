import os
from pathlib import Path

from ..config import ALLOWED_ROOTS


class PathNotAllowedError(Exception):
    """Raised when a path is outside RAG_ALLOWED_ROOTS or roots are unset."""


def _real(path: Path) -> Path:
    """Resolve a path, following symlinks. Falls back to the lexical path if
    the target doesn't exist yet — validation must work for files that will
    be created later."""
    try:
        return path.resolve(strict=True)
    except (FileNotFoundError, RuntimeError):
        return path.resolve(strict=False)


def _real_root(root: Path) -> Path:
    """Resolve one ALLOWED_ROOTS entry. We tolerate missing paths here (the
    operator may have configured a root that hasn't been created yet) and
    fall back to the lexical resolved path."""
    try:
        return Path(os.path.realpath(root))
    except OSError:
        return root.resolve(strict=False)


# Pre-resolve roots once at import so per-call validation doesn't redo the
# syscall. The set is small; this is fine.
_RESOLVED_ROOTS: tuple[Path, ...] = tuple(_real_root(r) for r in ALLOWED_ROOTS)


def validate_path(p: Path) -> Path:
    """Resolve `p` (following symlinks) and verify it falls inside one of
    ALLOWED_ROOTS — also resolved so symlinked roots match symlinked inputs.
    Raises PathNotAllowedError otherwise."""
    resolved = _real(p)

    if not _RESOLVED_ROOTS:
        raise PathNotAllowedError(
            "RAG_ALLOWED_ROOTS is not configured; set it to one or more "
            "absolute paths (colon-separated) to allow ingestion."
        )
    for root in _RESOLVED_ROOTS:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise PathNotAllowedError(
        f"Path {resolved} is not within any allowed root: "
        f"{[str(r) for r in _RESOLVED_ROOTS]}"
    )
