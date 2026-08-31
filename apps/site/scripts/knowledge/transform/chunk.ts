/**
 * Splitting a section that is too long, at a boundary a reader would recognise.
 *
 * The old chunker split on character count alone, which cut code blocks in
 * half — and half a code block is worse than none: the model reads a fragment
 * of a chain as if it were the whole API. §17 lists what must never be broken,
 * and the rule that follows from it is simple: a fence is atomic, paragraphs
 * are the preferred seam, and a sentence is the last resort.
 *
 * Most sections are one chunk. This runs on the tail of the distribution.
 */

/** Chunks above this are split. Sized for the embedding window and §38's budget. */
export const MAX_CHUNK_CHARS = 1200;

/** A tail shorter than this carries no meaning alone and is folded back. */
const MIN_CHUNK_CHARS = 200;

/**
 * A code fence is atomic even when it is over the limit on its own.
 *
 * Splitting one produces two invalid programs where there was a valid one, and
 * an example the reader cannot run is not a smaller problem than a long chunk.
 */
const FENCE = /(```[\s\S]*?```)/g;

interface Block {
  text: string;
  atomic: boolean;
}

/** Splits text into prose paragraphs and atomic code blocks, in order. */
function blocks(text: string): Block[] {
  const found: Block[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FENCE)) {
    for (const paragraph of text.slice(cursor, match.index).split(/\n{2,}/)) {
      if (paragraph.trim()) found.push({ text: paragraph.trim(), atomic: false });
    }

    found.push({ text: match[0].trim(), atomic: true });
    cursor = match.index + match[0].length;
  }

  for (const paragraph of text.slice(cursor).split(/\n{2,}/)) {
    if (paragraph.trim()) found.push({ text: paragraph.trim(), atomic: false });
  }

  return found;
}

/** A paragraph that is itself over the limit, split at sentence ends. */
function splitParagraph(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const pieces: string[] = [];
  let current = "";

  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length > MAX_CHUNK_CHARS) {
      pieces.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }

  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/**
 * One section in, one or more chunks out.
 *
 * The whole section is kept when it fits, which is the case for roughly nine
 * in ten of them — every interesting decision here is about the tail.
 */
export function chunkSection(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const pieces: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };

  for (const block of blocks(trimmed)) {
    for (const part of block.atomic ? [block.text] : splitParagraph(block.text)) {
      // an atomic block that does not fit starts its own chunk rather than
      // overflowing the one in progress
      if (current && current.length + part.length + 2 > MAX_CHUNK_CHARS) push();
      current += current ? `\n\n${part}` : part;
    }
  }
  push();

  if (pieces.length > 1 && pieces[pieces.length - 1].length < MIN_CHUNK_CHARS) {
    const tail = pieces.pop() as string;
    pieces[pieces.length - 1] += `\n\n${tail}`;
  }

  return pieces.length > 0 ? pieces : [trimmed];
}
