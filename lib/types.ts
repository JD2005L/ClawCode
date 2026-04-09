export interface ChunkRecord {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

export interface FileRecord {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  citation: string;
}

export interface RecallEntry {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  recallCount: number;
  totalScore: number;
  maxScore: number;
  firstRecalledAt: string;
  lastRecalledAt: string;
  recallDays: string[];
  conceptTags: string[];
}
