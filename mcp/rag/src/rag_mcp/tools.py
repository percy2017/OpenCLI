"""Tool registration for the RAG MCP server.

Each tool is typed with Pydantic models so FastMCP emits an `outputSchema`
and `structuredContent` automatically, plus `annotations` per the MCP spec
(`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
"""
import logging
from typing import Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import Annotations, ToolAnnotations
from pydantic import BaseModel, Field

from .rag.ingest import ingest_directory as _ingest_directory
from .rag.ingest import ingest_file as _ingest_file
from .rag.retrieve import clear_index as _clear_index
from .rag.retrieve import delete_source as _delete_source
from .rag.retrieve import get_source_text as _get_source_text
from .rag.retrieve import list_sources as _list_sources
from .rag.retrieve import search as _search

log = logging.getLogger(__name__)


# ----- Pydantic output models --------------------------------------------------

class IngestFileResult(BaseModel):
    source: str = Field(description="Absolute path of the indexed file")
    chunks: int = Field(default=0, description="Number of chunks now stored for this source")
    status: Literal["ok", "error"] = Field(description="'ok' or 'error'")
    error: str | None = Field(default=None, description="Human-readable error when status='error'")


class IngestFileError(BaseModel):
    source: str
    chunks: Literal[0] = 0
    status: Literal["error"] = "error"
    error: str


class IngestDirectoryResult(BaseModel):
    path: str
    files: int = Field(description="Number of supported files found")
    total_chunks: int = Field(description="Sum of chunks across all successfully ingested files")
    status: Literal["ok", "error"]
    error: str | None = None
    results: list[IngestFileResult | IngestFileError] = Field(
        default_factory=list,
        description="Per-file ingest outcome, in the same order they were discovered",
    )


class SearchHit(BaseModel):
    text: str = Field(description="Chunk text that matched the query")
    source: str = Field(description="Absolute path of the file the chunk came from")
    filename: str = Field(description="Basename of the source file")
    page: int | None = Field(default=None, description="PDF page number when applicable")
    sheet: str | None = Field(default=None, description="XLSX sheet name when applicable")
    slide: int | None = Field(default=None, description="PPTX slide number when applicable")
    score: float | None = Field(default=None, description="Cosine similarity in [0, 1]; higher is better")


class SearchResult(BaseModel):
    query: str
    count: int = Field(description="Number of hits returned (≤ k)")
    hits: list[SearchHit]


class SourceInfo(BaseModel):
    name: str = Field(description="Absolute path of the source")
    filename: str = Field(description="Basename of the source")
    chunks: int = Field(description="Number of chunks currently indexed for this source")


class DeleteSourceResult(BaseModel):
    deleted: bool
    source: str
    removed_chunks: int = 0
    reason: str | None = None


class ClearIndexResult(BaseModel):
    deleted: bool
    removed_chunks: int = 0


# ----- Annotations per tool ---------------------------------------------------

_READ_ONLY = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)

_DESTRUCTIVE = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=True,
    openWorldHint=False,
)

_INGEST = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=True,    # re-ingesting the same path replaces existing chunks
    openWorldHint=False,
)


# ----- Tool registration ------------------------------------------------------

def register_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        name="ingest_file",
        title="Ingest one document",
        description=(
            "Index a single office document (PDF, DOCX, XLSX, PPTX, TXT, MD, "
            "CSV) into the vector store. Re-indexing the same path replaces "
            "existing chunks. The path must fall inside RAG_ALLOWED_ROOTS."
        ),
        annotations=_INGEST,
    )
    def ingest_file(path: str) -> IngestFileResult:
        raw = _ingest_file(path)
        return IngestFileResult(**raw)

    @mcp.tool(
        name="ingest_directory",
        title="Ingest a directory of documents",
        description=(
            "Recursively index every supported file under a directory. "
            "`glob` follows pathlib glob rules (default `**/*`). Returns "
            "the per-file results in discovery order so callers can surface "
            "which files failed. The root must fall inside RAG_ALLOWED_ROOTS."
        ),
        annotations=_INGEST,
    )
    def ingest_directory(path: str, glob: str = "**/*") -> IngestDirectoryResult:
        raw = _ingest_directory(path, glob)
        results = [IngestFileResult(**r) if r.get("chunks", 0) > 0
                   else IngestFileError(**r) for r in raw.get("results", [])]
        return IngestDirectoryResult(
            path=raw.get("path", path),
            files=raw.get("files", 0),
            total_chunks=raw.get("total_chunks", 0),
            status=raw.get("status", "error"),
            error=raw.get("error"),
            results=results,
        )

    @mcp.tool(
        name="search",
        title="Semantic search the RAG index",
        description=(
            "Return the top-k chunks most similar to the query. Each hit "
            "includes the source path, filename, page/sheet/slide when "
            "applicable, and a cosine similarity score in [0, 1] where "
            "higher is better. The same query returns the same hits every "
            "time as long as the index hasn't changed."
        ),
        annotations=_READ_ONLY,
    )
    def search(query: str, k: int = 5) -> SearchResult:
        hits = _search(query, k)
        return SearchResult(
            query=query,
            count=len(hits),
            hits=[SearchHit(**h) for h in hits],
        )

    @mcp.tool(
        name="list_sources",
        title="List indexed documents",
        description=(
            "List every document currently in the index with its filename "
            "and the number of chunks stored for it."
        ),
        annotations=_READ_ONLY,
    )
    def list_sources_tool() -> list[SourceInfo]:
        sources = _list_sources()
        return [SourceInfo(**s) for s in sources]

    @mcp.tool(
        name="delete_source",
        title="Delete one indexed document",
        description=(
            "Remove all chunks belonging to a given source path. The path "
            "must match exactly one returned by list_sources. Idempotent: "
            "removing an already-removed source returns deleted=false."
        ),
        annotations=_DESTRUCTIVE,
    )
    def delete_source(name: str) -> DeleteSourceResult:
        raw = _delete_source(name)
        return DeleteSourceResult(**raw)

    @mcp.tool(
        name="clear_index",
        title="Clear the entire RAG index",
        description=(
            "Remove every chunk from the index. The index is reset to "
            "empty. This is destructive and irreversible; use it for "
            "rebuilds or to wipe test data."
        ),
        annotations=_DESTRUCTIVE,
    )
    def clear_index_tool() -> ClearIndexResult:
        raw = _clear_index()
        return ClearIndexResult(**raw)

    @mcp.resource(
        uri="source://{name}",
        name="indexed_source",
        title="Full text of an indexed source",
        description=(
            "Read the complete indexed text of one document, in insertion "
            "order. Use this when the top-k retrieval from `search` is not "
            "enough — for example, when you need every line item in a "
            "spreadsheet or every paragraph in a long report. The `name` "
            "must match exactly one path returned by `list_sources`."
        ),
        mime_type="text/plain",
        annotations=Annotations(audience=["assistant"], priority=0.7),
    )
    def indexed_source(name: str) -> str:
        text = _get_source_text(name)
        if text is None:
            raise ValueError(f"No indexed source matches: {name}")
        return text