/**
 * Memory database — SQLite with FTS5
 * Mirrors OpenClaw's memory-schema.ts and manager.ts
 *
 * Schema:
 * - files: track file metadata (hash, mtime, size)
 * - chunks: store text chunks with line ranges
 * - chunks_fts: FTS5 virtual table for full-text search
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { chunkMarkdown } from "./chunker.ts";
import { buildFtsQuery, extractKeywords } from "./keywords.ts";
import { applyMMR } from "./mmr.ts";
import { getDecayMultiplier } from "./temporal-decay.ts";
import type { SearchResult } from "./types.ts";

const MAX_SNIPPET_CHARS = 700;
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.1;

export class MemoryDB {
  private db: Database.Database;
  private pluginRoot: string;
  private memoryDir: string;
  private dirty = true;

  constructor(pluginRoot: string) {
    this.pluginRoot = pluginRoot;
    this.memoryDir = path.join(pluginRoot, "memory");

    // Ensure memory directory exists
    try {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    } catch {
      // Directory creation failed — will error on DB open
    }

    const dbPath = path.join(this.memoryDir, ".memory.sqlite");

    try {
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      this.initSchema();
    } catch (err) {
      // If DB fails (corrupt, permissions, etc.), create in-memory fallback
      this.db = new Database(":memory:");
      this.db.pragma("journal_mode = WAL");
      this.initSchema();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
      );
    `);

    // FTS5 virtual table — separate creation (can't use IF NOT EXISTS)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5 (
          text,
          id UNINDEXED,
          path UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
    } catch {
      // Already exists — OK
    }
  }

  /**
   * List all memory files to index.
   * Searches: memory/*.md + MEMORY.md at root
   */
  private listMemoryFiles(): Array<{ relPath: string; fullPath: string }> {
    const files: Array<{ relPath: string; fullPath: string }> = [];

    // Root MEMORY.md
    const rootMemory = path.join(this.pluginRoot, "MEMORY.md");
    if (fs.existsSync(rootMemory)) {
      files.push({ relPath: "MEMORY.md", fullPath: rootMemory });
    }

    // memory/MEMORY.md
    const memMemory = path.join(this.memoryDir, "MEMORY.md");
    if (fs.existsSync(memMemory)) {
      files.push({ relPath: "memory/MEMORY.md", fullPath: memMemory });
    }

    // All .md files in memory/ (excluding .dreams/ and hidden files)
    try {
      const entries = fs.readdirSync(this.memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "MEMORY.md") continue; // Already added
        const fullPath = path.join(this.memoryDir, entry.name);
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push({ relPath: `memory/${entry.name}`, fullPath });
        }
      }
    } catch {
      // memory/ doesn't exist yet
    }

    return files;
  }

  /**
   * Sync memory files to the database.
   * Only re-indexes files whose hash has changed.
   * Mirrors OpenClaw's syncMemoryFiles().
   */
  sync(): { indexed: number; removed: number; unchanged: number } {
    const memoryFiles = this.listMemoryFiles();
    const currentPaths = new Set(memoryFiles.map((f) => f.relPath));
    let indexed = 0;
    let removed = 0;
    let unchanged = 0;

    const getFile = this.db.prepare("SELECT hash FROM files WHERE path = ?");
    const upsertFile = this.db.prepare(
      "INSERT OR REPLACE INTO files (path, hash, mtime, size) VALUES (?, ?, ?, ?)"
    );
    const deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
    const deleteChunks = this.db.prepare("DELETE FROM chunks WHERE path = ?");
    const deleteFts = this.db.prepare("DELETE FROM chunks_fts WHERE path = ?");
    const insertChunk = this.db.prepare(
      "INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, text, hash) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertFts = this.db.prepare(
      "INSERT INTO chunks_fts (text, id, path, start_line, end_line) VALUES (?, ?, ?, ?, ?)"
    );

    const transaction = this.db.transaction(() => {
      // Index new/changed files
      for (const { relPath, fullPath } of memoryFiles) {
        try {
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, "utf-8");
          const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

          const existing = getFile.get(relPath) as { hash: string } | undefined;
          if (existing?.hash === hash) {
            unchanged++;
            continue;
          }

          // Re-index this file
          deleteChunks.run(relPath);
          deleteFts.run(relPath);
          upsertFile.run(relPath, hash, Math.floor(stat.mtimeMs), stat.size);

          const chunks = chunkMarkdown(content, relPath);
          for (const chunk of chunks) {
            insertChunk.run(
              chunk.id,
              chunk.path,
              chunk.startLine,
              chunk.endLine,
              chunk.text,
              chunk.hash
            );
            insertFts.run(
              chunk.text,
              chunk.id,
              chunk.path,
              chunk.startLine,
              chunk.endLine
            );
          }
          indexed++;
        } catch {
          // Skip unreadable files
        }
      }

      // Remove stale files
      const allPaths = this.db
        .prepare("SELECT path FROM files")
        .all() as Array<{ path: string }>;
      for (const { path: dbPath } of allPaths) {
        if (!currentPaths.has(dbPath)) {
          deleteChunks.run(dbPath);
          deleteFts.run(dbPath);
          deleteFile.run(dbPath);
          removed++;
        }
      }
    });

    try {
      transaction();
    } catch {
      // Transaction failed — DB may be locked or corrupt. Mark dirty for retry.
      return { indexed: 0, removed: 0, unchanged: 0 };
    }
    this.dirty = false;
    return { indexed, removed, unchanged };
  }

  /**
   * Mark database as dirty (needs re-sync before next search).
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Search memory using FTS5 with BM25 ranking + temporal decay + MMR.
   * Mirrors OpenClaw's hybrid search (FTS component).
   */
  search(
    query: string,
    options?: {
      maxResults?: number;
      minScore?: number;
      enableDecay?: boolean;
      halfLifeDays?: number;
      enableMMR?: boolean;
      mmrLambda?: number;
    }
  ): SearchResult[] {
    // Sync if dirty
    if (this.dirty) {
      this.sync();
    }

    const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const enableDecay = options?.enableDecay ?? true;
    const halfLifeDays = options?.halfLifeDays ?? 30;
    const enableMMR = options?.enableMMR ?? true;
    const mmrLambda = options?.mmrLambda ?? 0.7;

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    // FTS5 search with BM25 ranking
    // Fetch more candidates than needed for MMR to work with
    const candidateMultiplier = enableMMR ? 4 : 1;
    const candidateLimit = maxResults * candidateMultiplier;

    let rows: Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      rank: number;
    }>;

    try {
      rows = this.db
        .prepare(
          `SELECT
            chunks_fts.id,
            chunks_fts.path,
            chunks_fts.start_line,
            chunks_fts.end_line,
            chunks.text,
            rank
          FROM chunks_fts
          JOIN chunks ON chunks.id = chunks_fts.id
          WHERE chunks_fts MATCH ?
          ORDER BY rank
          LIMIT ?`
        )
        .all(ftsQuery, candidateLimit) as typeof rows;
    } catch {
      // FTS query syntax error — fall back to no results
      return [];
    }

    if (rows.length === 0) return [];

    // Convert BM25 rank to [0, 1] score (rank is negative, lower = better)
    const now = new Date();
    let results: SearchResult[] = rows.map((row) => {
      // BM25 rank → score: 1 / (1 + abs(rank))
      let score = 1 / (1 + Math.abs(row.rank));

      // Apply temporal decay
      if (enableDecay) {
        score *= getDecayMultiplier(row.path, now, halfLifeDays);
      }

      // Truncate snippet
      let snippet = row.text;
      if (snippet.length > MAX_SNIPPET_CHARS) {
        snippet = snippet.slice(0, MAX_SNIPPET_CHARS - 3) + "...";
      }

      return {
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        snippet,
        score,
        citation: `${row.path}#L${row.start_line}-L${row.end_line}`,
      };
    });

    // Filter by minimum score
    results = results.filter((r) => r.score >= minScore);

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply MMR for diversity
    if (enableMMR && results.length > 1) {
      results = applyMMR(results, maxResults, mmrLambda);
    } else {
      results = results.slice(0, maxResults);
    }

    return results;
  }

  /**
   * Read a memory file with optional line range.
   * Mirrors OpenClaw's memory_get.
   */
  readFile(
    relPath: string,
    from?: number,
    lineCount?: number
  ): { text: string; path: string } | { error: string } {
    // Security: resolve and validate path
    const fullPath = path.resolve(this.pluginRoot, relPath);
    if (!fullPath.startsWith(this.pluginRoot)) {
      return { error: "Path outside workspace" };
    }

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      if (from !== undefined) {
        const start = Math.max(0, from - 1);
        const count = lineCount || 50;
        const sliced = lines.slice(start, start + count);
        return {
          text: sliced.map((l, i) => `${start + i + 1}\t${l}`).join("\n"),
          path: relPath,
        };
      }

      return {
        text: lines.map((l, i) => `${i + 1}\t${l}`).join("\n"),
        path: relPath,
      };
    } catch {
      return { error: `File not found: ${relPath}` };
    }
  }

  /**
   * Get stats about the memory database.
   */
  stats(): { files: number; chunks: number; totalSize: number } {
    const files = (
      this.db.prepare("SELECT COUNT(*) as count FROM files").get() as {
        count: number;
      }
    ).count;
    const chunks = (
      this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
        count: number;
      }
    ).count;
    const totalSize = (
      this.db
        .prepare("SELECT COALESCE(SUM(size), 0) as total FROM files")
        .get() as { total: number }
    ).total;
    return { files, chunks, totalSize };
  }

  close(): void {
    this.db.close();
  }
}
