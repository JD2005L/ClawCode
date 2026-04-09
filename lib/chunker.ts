import { createHash } from "crypto";
import type { ChunkRecord } from "./types.js";

/**
 * Markdown chunker — mirrors OpenClaw's chunkMarkdown()
 * (src/memory/internal.ts:167-248)
 *
 * Splits a file into overlapping chunks of ~maxTokens size.
 * Token estimate: 1 token ≈ 4 chars (same heuristic as OpenClaw).
 */

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 80;

export function chunkMarkdown(
  content: string,
  filePath: string,
  options?: { maxTokens?: number; overlapTokens?: number }
): ChunkRecord[] {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const maxChars = Math.max(32, maxTokens * 4);
  const overlapChars = Math.max(0, overlapTokens * 4);

  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const chunks: ChunkRecord[] = [];
  let chunkStart = 0;
  let currentChars = 0;
  let chunkLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    chunkLines.push(line);
    currentChars += line.length + 1; // +1 for newline

    if (currentChars >= maxChars || i === lines.length - 1) {
      const text = chunkLines.join("\n");
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
      const startLine = chunkStart + 1; // 1-indexed
      const endLine = i + 1;

      chunks.push({
        id: `${filePath}:${startLine}:${endLine}`,
        path: filePath,
        startLine,
        endLine,
        text,
        hash,
      });

      // Overlap: keep last overlapChars worth of lines for next chunk
      if (i < lines.length - 1) {
        let overlapSize = 0;
        let overlapStart = chunkLines.length;
        for (let j = chunkLines.length - 1; j >= 0; j--) {
          overlapSize += chunkLines[j].length + 1;
          if (overlapSize >= overlapChars) {
            overlapStart = j;
            break;
          }
        }
        chunkLines = chunkLines.slice(overlapStart);
        chunkStart = i + 1 - chunkLines.length;
        currentChars = chunkLines.reduce((sum, l) => sum + l.length + 1, 0);
      }
    }
  }

  return chunks;
}
