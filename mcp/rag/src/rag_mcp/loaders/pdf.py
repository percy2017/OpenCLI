from pathlib import Path

import fitz


def load_pdf(path: Path):
    doc = fitz.open(path)
    try:
        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if text:
                yield {"text": text, "page": page_num}
    finally:
        doc.close()
