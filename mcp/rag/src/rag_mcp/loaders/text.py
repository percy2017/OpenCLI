from pathlib import Path


def load_text(path: Path):
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read().strip()
    if text:
        yield {"text": text}
