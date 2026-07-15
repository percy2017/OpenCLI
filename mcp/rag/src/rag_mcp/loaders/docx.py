from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


def _iter_block_items(parent):
    """Walk the document body in visual order, yielding each block element.
    `parent` is the body or a cell — both expose `.iter_inner_items()` /
    `.element.body` in the same shape (paragraphs and tables)."""
    if hasattr(parent, "element"):
        # A document body has no .element — it IS the element.
        element = parent.element.body if hasattr(parent.element, "body") else parent.element
    else:
        element = parent
    for child in element.iterchildren():
        tag = child.tag
        if tag == qn("w:p"):
            yield ("p", child)
        elif tag == qn("w:tbl"):
            yield ("tbl", child)


def _table_to_rows(table):
    """Flatten one DOCX table to a list of pipe-separated row strings, with a
    header note if the first row looks like one. Empty cells stay empty so
    column alignment isn't lost in retrieval."""
    rows = []
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
        rows.append(" | ".join(cells))
    return rows


def load_docx(path: Path):
    doc = Document(path)

    # 1. Headers and footers from every section (they don't appear in body).
    header_footer_blocks: list[str] = []
    for section in doc.sections:
        for hf in (section.header, section.footer):
            if hf is None:
                continue
            for para in hf.paragraphs:
                if para.text.strip():
                    header_footer_blocks.append(para.text.strip())

    # 2. Walk the body in document order, grouping paragraphs into runs and
    #    tables into pipe-delimited grids. We yield one record per visual
    #    block (paragraph group OR table) so the chunker gets semantically
    #    coherent chunks instead of mixing paragraph 7 with table row 3.
    body_runs: list[tuple[str, list[str]]] = []  # (kind, lines)
    current_kind: str | None = None
    current_lines: list[str] = []

    def flush():
        nonlocal current_kind, current_lines
        if current_kind is not None and current_lines:
            body_runs.append((current_kind, current_lines))
        current_kind = None
        current_lines = []

    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            p = Paragraph(child, doc)
            text = p.text.strip()
            if not text:
                continue
            if current_kind != "p":
                flush()
                current_kind = "p"
            current_lines.append(text)
        elif child.tag == qn("w:tbl"):
            t = Table(child, doc)
            rows = _table_to_rows(t)
            if not rows:
                continue
            flush()
            current_kind = "tbl"
            current_lines = rows
            flush()
    flush()

    # 3. Emit records.
    if header_footer_blocks:
        yield {"text": "\n".join(header_footer_blocks), "section": "header_footer"}

    for idx, (kind, lines) in enumerate(body_runs):
        text = "\n".join(lines) if kind == "p" else "\n".join(lines)
        rec: dict = {"text": text}
        if kind == "tbl":
            rec["kind"] = "table"
        body_runs_idx = idx
        rec["block"] = body_runs_idx
        yield rec
