from pathlib import Path

from .pdf import load_pdf
from .docx import load_docx
from .xlsx import load_xlsx
from .pptx import load_pptx
from .text import load_text


_LOADERS = {
    ".pdf": load_pdf,
    ".docx": load_docx,
    ".xlsx": load_xlsx,
    ".pptx": load_pptx,
    ".txt": load_text,
    ".md": load_text,
    ".csv": load_text,
}


def load_document(path: Path):
    ext = path.suffix.lower()
    loader = _LOADERS.get(ext)
    if loader is None:
        raise ValueError(f"Unsupported extension: {ext}")
    yield from loader(path)
