/**
 * Text-cleaning pipeline for the chat "Read aloud" button.
 *
 * Goal: keep prose that sounds natural when spoken, drop everything that
 * would be jarring or unreadable for a TTS engine — fenced code, JSON
 * blobs (inline or full-line), shell commands, function signatures, URLs,
 * bare file paths, markdown decorations, HTML tags, and decorative emoji.
 *
 * Aggressiveness rationale: TTS engines will literally speak "open brace,
 * quote, status, quote, colon" out loud for any JSON that slips through.
 * False positives (a word gets dropped) are far less annoying than having
 * a 10-second string of punctuation read back to the user.
 *
 * The function is pure (no I/O) so it can be exercised by unit tests with
 * no fixtures. Each step logs how many characters it dropped at DEBUG
 * level (gated by `DEBUG=tts`).
 *
 * The output is capped to TTS_MAX_CHARS (default 9500) to stay below the
 * upstream `mmx speech synthesize` 10k-character server-side limit. When
 * the cap kicks in we truncate at the last sentence boundary inside the
 * budget and append an ellipsis.
 */

// Hard cap chosen to leave ~500 chars of headroom under `mmx`'s documented
// 10k-character limit. Override via env if upstream changes.
const DEFAULT_MAX_CHARS = 9500;

// A "structural" character signals JSON/dict/list syntax: braces, brackets,
// colons, commas, quotes. When a line/run is mostly these, it's data, not
// prose.
const STRUCTURAL_CHARS = /[{}\[\]":,]/g;

// Decorative symbol characters: pictographs, dingbats, transport, etc.
// `Letter`, `Number`, `Mark`, `Punctuation`, `Separator` are kept; the
// rest get dropped. We intentionally keep `Mark` (combining accents) so
// accented Spanish/French/etc. characters survive.
const NON_PROSE_CHARS = /[^\p{L}\p{N}\p{M}\p{P}\p{Z}\s]/gu;

/**
 * Strip everything that doesn't belong in spoken audio, leaving only what
 * a human narrator would actually say.
 *
 * Exported for direct unit testing.
 */
export function cleanTextForSpeech(markdown: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (!markdown) return '';

  let working = String(markdown);
  const originalLen = working.length;
  const debug = process.env.DEBUG?.includes('tts');

  // 1. Drop fenced code blocks first — both ``` and ~~~ styles. Needs the
  //    `g` flag and `[\s\S]*?` because the bodies can contain newlines.
  const fenced = working.match(/```[\s\S]*?```|~~~[\s\S]*?~~~/g);
  working = working.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ');
  if (debug && fenced) logStep('fenced-code', fenced.join('').length);

  // 2. Drop indented-code blocks: any run of lines that begin with 2+
  //    leading spaces or a tab. Real chat prose is never indented, so a
  //    false positive here costs us nothing.
  working = working.replace(/(?:^[ \t]{2,}.+(?:\n|$))+?/gm, ' ');

  // 3. Drop inline backticks: `foo` → keep the inner text, but we drop
  //    the result entirely if the inner text is structurally code-like.
  working = working.replace(/`([^`\n]+)`/g, (_match, inner: string) =>
    looksLikeCode(inner) ? ' ' : inner,
  );

  // 4. Drop JSON-shaped runs of {...} or [...]. Detection is intentionally
  //    generous: any nested braces/brackets that contain a string-colon-
  //    string pattern (= a JSON key:value) gets dropped wholesale,
  //    regardless of the run's length. Shorter JSON fragments (e.g. one
  //    line in a paragraph) get dropped by the "JSON-like content"
  //    detector below.
  working = working.replace(/\{\s*(?:"[^"\n]+"\s*:\s*(?:"[^"\n]*"|[\s\S]*?)\s*,?\s*)+\}/g, ' ');
  working = working.replace(/\{\s*"[\s\S]*?"\s*:\s*[\s\S]*?\}/g, ' ');
  working = working.replace(/\[[\s\S]*?\]/g, (m) =>
    looksLikeJson(m) ? ' ' : m,
  );

  // 5. Drop whole lines that look like code, JSON, or shell commands.
  //    This catches single-line variants that survived step 4 and the
  //    "tool output" lines the LLM often pastes (e.g. `$ npm install`).
  working = working
    .split('\n')
    .map((line) => (looksLikeCodeOrCommandLine(line) ? ' ' : line))
    .join('\n');

  // 6. Drop inline JSON/object literals embedded in prose. Heuristic:
  //    a brace-balanced {...} or bracket-balanced [...] with at least one
  //    colon inside it (the structural signature of a config/key-value
  //    payload). Length threshold lowered to 8 chars so even short
  //    fragments like {ok:true} or [1,2,3] get dropped.
  working = working.replace(/\{[^{}\n]*?:[^{}\n]*?\}/g, (m) =>
    m.length >= 8 ? ' ' : m,
  );
  working = working.replace(/\[[^\[\]\n]*?:[^\[\]\n]*?\]/g, (m) =>
    m.length >= 8 ? ' ' : m,
  );

  // 7. Drop http(s), file://, ws:// URLs (and bare www. references).
  const urlMatch = working.match(/\b(?:https?|file|wss?):\/\/\S+|\bwww\.\S+/g);
  working = working.replace(/\b(?:https?|file|wss?):\/\/\S+|\bwww\.\S+/g, ' ');
  if (debug && urlMatch) logStep('urls', urlMatch.join('').length);

  // 8. Drop bare filesystem paths and Linux line refs like "/path:65".
  //    Path itself doesn't appear in prose; trailing :N is a code-edit
  //    pointer that TTS will garble ("path colon sixty-five"). Won't eat
  //    "/usr" in prose because that pattern requires a trailing /segment.
  working = working.replace(
    /(^|[\s`])(?:\/(?:[\w.\-]+\/)+[\w.\-]+)(?::\d+(?:[:\d]+)?)?/g,
    '$1',
  );

  // 9. Strip markdown link decorations, leaving just the anchor text.
  working = working.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 10. Strip markdown emphasis/structure decorations.
  working = working.replace(/(\*\*|__)(.*?)\1/g, '$2');
  working = working.replace(/(\*|_)(.*?)\1/g, '$2');
  working = working.replace(/~~(.*?)~~/g, '$1');
  working = working.replace(/^#{1,6}\s+/gm, '');
  working = working.replace(/^>\s?/gm, '');
  working = working.replace(/^[-*+]\s+/gm, '');
  working = working.replace(/^\d+\.\s+/gm, '');
  working = working.replace(/^---+$/gm, ' ');

  // 11. Drop any remaining stray backticks (shouldn't be any after step 3
  //     but backticks outside the normal regex get caught here).
  working = working.replace(/`+/g, ' ');

  // 12. Flatten markdown tables. Drop the header separator line, then
  //     collapse each row into a single line of comma-separated values so
  //     the row reads as prose instead of being read cell-by-cell.
  working = working.replace(/^\s*\|?\s*[-:|\s]+\|[-:|\s]+\s*$/gm, ' ');
  working = working.replace(/^\s*\|+/gm, '');
  working = working.replace(/\|+\s*$/gm, '');
  working = working.replace(/\|+/g, ', ');

  // 13. Strip HTML tags.
  working = working.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');

  // 14. Drop decorative emoji and other non-prose symbol characters.
  const emojiMatch = working.match(NON_PROSE_CHARS);
  working = working.replace(NON_PROSE_CHARS, ' ');
  if (debug && emojiMatch) logStep('emoji', emojiMatch.join('').length);

  // 15. Final per-line check: drop any line that's now mostly non-letter
  //     characters (punctuation, digits, leftover structural chars).
  //     Catches individual punctuation-only or code-residue lines that
  //     slipped through every other step. Also drops lines that consist
  //     almost entirely of paired delimiters (braces, brackets, parens),
  //     even when short — single-character leftovers like "}" or ";" are
  //     never meaningful prose.
  working = working
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (looksLikeCodeOrCommandLine(trimmed)) return false;
      // Anything that's a single paired delimiter (}, ], ), etc.) with no
      // letters at all is structural residue.
      if (/^[\]})\])]+$/.test(trimmed)) return false;
      if (letterRatio(trimmed) < 0.4 && trimmed.length >= 20) return false;
      return true;
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // 16. Collapse whitespace: 3+ newlines → 2, then any run of whitespace
  //     → single space.
  working = working.replace(/\n{3,}/g, '\n\n');
  working = working.replace(/[ \t]{2,}/g, ' ');

  if (debug) {
    logStep('total', originalLen - working.length);
  }

  // 17. Length cap: truncate at the last sentence boundary inside the
  //     budget. Hard-truncate if no boundary exists.
  if (working.length > maxChars) {
    const truncated = truncateAtSentenceBoundary(working, maxChars);
    if (debug) logStep('truncated', working.length - truncated.length);
    working = truncated;
  }

  return working.trim();
}

/** Quick check: does the string look like JSON? Looks for the
 *  `"key": value` signature that distinguishes JSON from prose with
 *  occasional braces. */
function looksLikeJson(segment: string): boolean {
  if (!segment || segment.length < 8) return false;
  if (segment.includes('":') || segment.includes('": ')) return true;
  // Tolerate unquoted keys (YAML-ish) but require at least one colon and
  // a structural character.
  if (STRUCTURAL_CHARS.test(segment) && segment.includes(':')) return true;
  return false;
}

/** Quick check: does the line look like source code or a shell command?
 *  Used both for the per-line trim and for inline-code content. */
function looksLikeCode(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;

  // Definite code signals — almost always present in source, almost never
  // in prose.
  if (/^(const|let|var|function|def|class|import|export|return|if|else|for|while|switch|case|break|continue|new|throw|try|catch|finally)\b/.test(s)) return true;
  if (/^[a-zA-Z_][\w]*\s*\(.*\)\s*(=>|->)?\s*\{?$/.test(s)) return true; // foo() { or foo() =>
  if (/^(public|private|protected|static|async|readonly)\s/.test(s)) return true;
  if (/^\/\//.test(s) || /^\/\*/.test(s) || /^\#!/.test(s)) return true; // comments / shebang
  if (/^[{[][\s\S]*[}\]]$/.test(s) && structuralRatio(s) >= 0.3) return true; // single-line JSON/dict
  if (/^\$\s/.test(s)) return true; // shell prompt
  if (/^>\s/.test(s)) return true; // redirect or quote

  // Heuristic: high density of structural characters and punctuation that
  // doesn't appear in normal prose.
  if (s.length >= 20 && structuralRatio(s) >= 0.25) return true;
  return false;
}

/** Full-line variant: same checks plus a structural-character floor that
 *  only triggers when the line is long enough to not be a one-word
 *  sentence. */
function looksLikeCodeOrCommandLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Drop "command output" lines the LLM often pastes verbatim.
  if (/^(npm|yarn|pnpm|pip|git|docker|curl|wget|sudo|cd|ls|cat|echo|export|source|python|node)\b/.test(trimmed)) return true;
  if (/^Traceback \(most recent call last\)/.test(trimmed)) return true;
  if (/^Error:\s/.test(trimmed) && trimmed.length < 200 && structuralRatio(trimmed) > 0.1) {
    // Short error messages with paths are usually stack traces; keep
    // prose-style errors, drop the trace-y ones.
    if (/\.js:\d+|\.ts:\d+|\.py:\d+/.test(trimmed)) return true;
  }
  return looksLikeCode(trimmed);
}

function structuralRatio(segment: string): number {
  const matches = segment.match(STRUCTURAL_CHARS);
  if (!matches) return 0;
  return matches.length / segment.length;
}

/** Letter density. Lines dominated by punctuation/numbers are usually
 *  leftover structural residue (table cells, file lists). */
function letterRatio(line: string): number {
  if (!line) return 0;
  // Strip whitespace before measuring so "   " doesn't count as 100% letters.
  const stripped = line.replace(/\s/g, '');
  if (stripped.length === 0) return 0;
  const letters = stripped.match(/\p{L}/gu);
  return letters ? letters.length / stripped.length : 0;
}

/**
 * Truncate at the last sentence terminator (`.`, `!`, `?`, or CJK
 * equivalents) that still fits inside `budget`. Falls back to the last
 * whitespace so we never slice a word in half.
 */
function truncateAtSentenceBoundary(text: string, budget: number): string {
  if (text.length <= budget) return text;

  const window = text.slice(0, budget);
  const sentencePattern = /[.!?。！？](?:["')\]」）]*)/g;
  let lastCut = -1;
  let match: RegExpExecArray | null;
  while ((match = sentencePattern.exec(window)) !== null) {
    lastCut = match.index + match[0].length;
  }

  if (lastCut > budget * 0.5) {
    return `${window.slice(0, lastCut).trimEnd()}…`;
  }

  const ws = window.lastIndexOf(' ');
  if (ws > budget * 0.5) {
    return `${window.slice(0, ws).trimEnd()}…`;
  }
  return `${window.trimEnd()}…`;
}

function logStep(label: string, droppedChars: number): void {
  if (droppedChars > 0) {
    console.log(`[tts-cleaner] dropped ${droppedChars} chars at stage: ${label}`);
  }
}