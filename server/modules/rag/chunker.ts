/**
 * Token-aware sliding window chunker.
 *
 * Counts tokens via a lightweight word/char heuristic (~4 chars per token).
 * For real LLM-grade tokenization we'd swap in a tokenizer lib, but the goal
 * here is consistent sizing for embeddings, not exact token parity.
 *
 * Behavior:
 *   - Normalize line endings and trim trailing whitespace.
 *   - Split into chunks of `chunkSize` tokens with `chunkOverlap` token overlap.
 *   - Never returns empty chunks.
 *   - If input is shorter than chunkSize, returns one chunk with the full text.
 */

export type Chunk = {
  index: number;
  text: string;
};

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(text: string, chunkSize: number, chunkOverlap: number): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!normalized) return [];

  const effectiveOverlap = Math.max(0, Math.min(chunkOverlap, Math.floor(chunkSize / 2)));
  const stride = chunkSize - effectiveOverlap;
  const chunkSizeChars = chunkSize * CHARS_PER_TOKEN;
  const strideChars = Math.max(1, stride * CHARS_PER_TOKEN);

  const chunks: Chunk[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + chunkSizeChars);
    const slice = normalized.slice(cursor, end).trim();
    if (slice.length > 0) {
      chunks.push({ index, text: slice });
      index += 1;
    }
    if (end >= normalized.length) break;
    cursor += strideChars;
  }

  return chunks;
}
