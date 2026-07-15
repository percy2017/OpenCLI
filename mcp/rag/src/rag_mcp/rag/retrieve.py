import logging

import chromadb

from ..config import CHROMA_DIR, COLLECTION_NAME
from .embeddings import embed_one

log = logging.getLogger(__name__)


def _collection():
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def search(query: str, k: int = 5) -> list[dict]:
    qvec = embed_one(query)
    coll = _collection()

    res = coll.query(query_embeddings=[qvec], n_results=k)

    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    distances = (res.get("distances") or [[]])[0]

    out: list[dict] = []
    for text, meta, dist in zip(docs, metas, distances):
        score = 1.0 - float(dist) if dist is not None else None
        out.append({
            "text": text,
            "source": meta.get("source", ""),
            "filename": meta.get("filename", ""),
            "page": meta.get("page"),
            "sheet": meta.get("sheet"),
            "slide": meta.get("slide"),
            "score": score,
        })
    return out


def list_sources() -> list[dict]:
    coll = _collection()
    res = coll.get(include=["metadatas"])
    sources: dict[str, dict] = {}
    for meta in res.get("metadatas") or []:
        src = meta.get("source", "")
        if not src:
            continue
        if src not in sources:
            sources[src] = {
                "name": src,
                "filename": meta.get("filename", ""),
                "chunks": 0,
            }
        sources[src]["chunks"] += 1
    return list(sources.values())


def get_source_text(source: str) -> str | None:
    """Reconstruct the full text of a source from its stored chunks, in
    insertion order. Returns None if the source isn't indexed."""
    coll = _collection()
    res = coll.get(where={"source": source}, include=["documents"])
    docs = res.get("documents") or []
    ids = res.get("ids") or []
    if not docs:
        return None

    # Chunk IDs are <safe_source>::<idx> assigned at ingest time; sorting by
    # the trailing idx restores the original document sequence so callers
    # reading the resource see paragraphs and tables in document order.
    def _idx(i: str) -> int:
        try:
            return int(i.rsplit("::", 1)[-1])
        except ValueError:
            return 0

    paired = sorted(zip(ids, docs), key=lambda p: _idx(p[0]))
    return "\n\n".join(text for _, text in paired)


def delete_source(name: str) -> dict:
    coll = _collection()
    existing = coll.get(where={"source": name})
    ids = existing.get("ids") or []
    if not ids:
        return {"deleted": False, "source": name, "reason": "not found"}
    coll.delete(ids=ids)
    return {"deleted": True, "source": name, "removed_chunks": len(ids)}


def clear_index() -> dict:
    coll = _collection()
    existing = coll.get()
    ids = existing.get("ids") or []
    if ids:
        coll.delete(ids=ids)
    return {"deleted": True, "removed_chunks": len(ids)}