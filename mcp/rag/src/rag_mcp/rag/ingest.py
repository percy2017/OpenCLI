import logging
from pathlib import Path

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter

from ..config import (
    CHROMA_DIR,
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    COLLECTION_NAME,
    SUPPORTED_EXTS,
)
from ..loaders import load_document
from .embeddings import embed_batch
from .policy import PathNotAllowedError, validate_path

log = logging.getLogger(__name__)

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    length_function=len,
)


def _collection():
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def _doc_id(source: str, idx: int) -> str:
    safe = source.replace("/", "_").replace("\\", "_")
    return f"{safe}::{idx}"


def ingest_file(path: str) -> dict:
    try:
        p = validate_path(Path(path))
    except PathNotAllowedError as e:
        return {"source": path, "status": "error", "error": str(e)}

    if not p.exists():
        return {"source": str(p), "status": "error", "error": "file not found"}
    if p.suffix.lower() not in SUPPORTED_EXTS:
        return {
            "source": str(p),
            "status": "error",
            "error": f"unsupported extension: {p.suffix}",
        }

    records = list(load_document(p))
    if not records:
        return {"source": str(p), "status": "error", "error": "no extractable text"}

    chunks: list[dict] = []
    for rec in records:
        for chunk_text in _splitter.split_text(rec["text"]):
            meta = {"source": str(p), "filename": p.name}
            for k, v in rec.items():
                if k != "text":
                    meta[k] = v
            chunks.append({"text": chunk_text, "meta": meta})

    log.info("Ingesting %s: %d chunks", p.name, len(chunks))

    coll = _collection()

    existing = coll.get(where={"source": str(p)})
    if existing["ids"]:
        coll.delete(ids=existing["ids"])

    embeddings = embed_batch([c["text"] for c in chunks])
    coll.add(
        ids=[_doc_id(str(p), i) for i in range(len(chunks))],
        documents=[c["text"] for c in chunks],
        embeddings=embeddings,
        metadatas=[c["meta"] for c in chunks],
    )

    return {"source": str(p), "chunks": len(chunks), "status": "ok"}


def ingest_directory(path: str, glob: str = "**/*") -> dict:
    try:
        root = validate_path(Path(path))
    except PathNotAllowedError as e:
        return {"path": path, "files": 0, "total_chunks": 0, "status": "error", "error": str(e)}

    if not root.exists():
        return {
            "path": str(root),
            "files": 0,
            "total_chunks": 0,
            "status": "error",
            "error": "path not found",
        }

    files = [
        p for p in root.glob(glob)
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    ]
    total_chunks = 0
    results = []
    for f in files:
        try:
            r = ingest_file(str(f))
            results.append(r)
            if r.get("status") == "ok":
                total_chunks += r["chunks"]
        except Exception as e:
            log.exception("Failed to ingest %s", f)
            results.append({"source": str(f), "status": "error", "error": str(e)})

    return {
        "path": str(root),
        "files": len(files),
        "total_chunks": total_chunks,
        "results": results,
        "status": "ok",
    }