export interface ChunkTextOptions {
  readonly maxChunkSize?: number | undefined;
  readonly chunkOverlap?: number | undefined;
}

export interface TextChunk {
  readonly content: string;
  readonly index: number;
  readonly charCount: number;
}

/**
 * Sanitizes input text, stripping null characters (\0) and normalizing newlines.
 */
export function sanitizeText(text: string): string {
  return text.replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Splits text recursively into semantic chunks respecting paragraphs, sentences, words, and overlap.
 */
export function chunkText(text: string, options?: ChunkTextOptions): TextChunk[] {
  const sanitized = sanitizeText(text).trim();
  if (!sanitized) {
    return [];
  }

  const maxChunkSize = options?.maxChunkSize ?? 800;
  const chunkOverlap = options?.chunkOverlap ?? 100;

  if (maxChunkSize <= 0) {
    throw new Error("maxChunkSize must be greater than 0");
  }
  if (chunkOverlap < 0 || chunkOverlap >= maxChunkSize) {
    throw new Error("chunkOverlap must be non-negative and less than maxChunkSize");
  }

  if (sanitized.length <= maxChunkSize) {
    return [
      {
        content: sanitized,
        index: 0,
        charCount: sanitized.length,
      },
    ];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < sanitized.length) {
    const endIndex = startIndex + maxChunkSize;

    if (endIndex >= sanitized.length) {
      const finalChunk = sanitized.slice(startIndex).trim();
      if (finalChunk) {
        chunks.push(finalChunk);
      }
      break;
    }

    // Try to find natural split point before endIndex
    const window = sanitized.slice(startIndex, endIndex);
    let splitPoint = -1;

    // Hierarchy of separators
    const separators = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

    for (const sep of separators) {
      const lastIndex = window.lastIndexOf(sep);
      // Ensure the split point is reasonably past half of the maxChunkSize to avoid tiny fragments
      if (lastIndex > maxChunkSize * 0.3) {
        splitPoint = lastIndex + (sep === " " ? 0 : sep.length);
        break;
      }
    }

    if (splitPoint === -1) {
      splitPoint = maxChunkSize;
    }

    const chunkContent = sanitized.slice(startIndex, startIndex + splitPoint).trim();
    if (chunkContent) {
      chunks.push(chunkContent);
    }

    // Advance start index applying overlap
    const step = Math.max(1, splitPoint - chunkOverlap);
    startIndex += step;
  }

  return chunks.map((content, index) => ({
    content,
    index,
    charCount: content.length,
  }));
}
