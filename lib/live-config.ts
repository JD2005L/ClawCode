/**
 * Live config — watches agent-config.json on disk and keeps an in-memory copy
 * up to date. Consumers call `getLiveConfig()` each time they need config; the
 * watcher updates the underlying object on file change (debounced).
 *
 * Not everything can hot-reload:
 *   - Config that's used to INITIALIZE long-lived state at startup (HTTP
 *     server bind, memory backend, SQLite index) requires a full /mcp.
 *   - Config read on every tool call (search tuning, memory_context knobs,
 *     heartbeat active hours) applies live.
 *
 * When a critical key changes, the watcher invokes the optional
 * `onCriticalChange` callback with the list of changed critical keys. The
 * consumer (server.ts) is expected to surface that via an MCP logging
 * notification so the agent can tell the user to run /mcp.
 */

import fs from "fs";
import path from "path";
import { loadConfig, type AgentConfig } from "./config.ts";

// ---------------------------------------------------------------------------
// Keys whose values are captured at startup and cannot be hot-reloaded.
// Changing any of these requires /mcp to fully rebuild MCP state.
// ---------------------------------------------------------------------------

export const CRITICAL_KEYS = [
  "memory.backend",
  "memory.extraPaths",
  "http.enabled",
  "http.port",
  "http.host",
  "http.token",
] as const;

export type CriticalKey = (typeof CRITICAL_KEYS)[number];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let current: AgentConfig | null = null;
let currentWorkspace: string | null = null;
let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export interface CriticalChange {
  key: CriticalKey;
  from: unknown;
  to: unknown;
}

export type CriticalChangeCallback = (changes: CriticalChange[]) => void;

let onCriticalChange: CriticalChangeCallback | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load the config from disk once and cache it. Must be called before getLiveConfig. */
export function initLiveConfig(workspace: string): AgentConfig {
  currentWorkspace = workspace;
  try {
    current = loadConfig(workspace);
  } catch {
    // loadConfig returns defaults on any failure — but if somehow it throws,
    // keep whatever was previously loaded (or a safe empty default).
    current = current ?? {
      memory: { backend: "builtin", citations: "auto" },
    };
  }
  return current;
}

/** Return the latest config. Throws if initLiveConfig was never called. */
export function getLiveConfig(): AgentConfig {
  if (!current) {
    throw new Error("getLiveConfig called before initLiveConfig");
  }
  return current;
}

/**
 * Begin watching agent-config.json for changes. Subsequent writes update the
 * in-memory config (debounced 300ms). Critical-key changes trigger the
 * callback, if provided.
 *
 * Safe to call multiple times — each call replaces the previous watcher.
 */
export function startConfigWatcher(
  workspace: string,
  callback?: CriticalChangeCallback,
  opts: { debounceMs?: number } = {}
): void {
  if (!current) initLiveConfig(workspace);
  currentWorkspace = workspace;
  onCriticalChange = callback ?? null;

  stopConfigWatcher();

  const configPath = path.join(workspace, "agent-config.json");
  const debounceMs = opts.debounceMs ?? 300;

  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      reload(configPath);
    }, debounceMs);
  };

  try {
    // Watch the parent directory so we survive atomic replaces (editors rename
    // a temp file over the target, which can break fs.watch on the file itself).
    const dir = path.dirname(configPath);
    const basename = path.basename(configPath);
    watcher = fs.watch(dir, (_event, filename) => {
      if (!filename) return;
      if (filename !== basename) return;
      trigger();
    });
    watcher.on("error", () => {
      // Filesystem event errors are non-fatal — the user can always /mcp.
    });
  } catch {
    watcher = null;
  }
}

/** Stop watching. Safe to call even if no watcher is active. */
export function stopConfigWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {}
    watcher = null;
  }
}

// ---------------------------------------------------------------------------
// Diff — detect critical-key changes
// ---------------------------------------------------------------------------

function getByPath(obj: unknown, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let node: any = obj;
  for (const p of parts) {
    if (node === null || node === undefined) return undefined;
    node = node[p];
  }
  return node;
}

function equalDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equalDeep(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!equalDeep((a as any)[k], (b as any)[k])) return false;
    return true;
  }
  return false;
}

export function diffCriticalKeys(
  before: AgentConfig,
  after: AgentConfig
): CriticalChange[] {
  const changes: CriticalChange[] = [];
  for (const key of CRITICAL_KEYS) {
    const before_ = getByPath(before, key);
    const after_ = getByPath(after, key);
    if (!equalDeep(before_, after_)) {
      changes.push({ key, from: before_, to: after_ });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Internal: reload logic
// ---------------------------------------------------------------------------

function reload(configPath: string): void {
  if (!currentWorkspace) return;
  const previous = current;

  // Validate before swap: if the file is malformed, loadConfig returns
  // defaults. We want to KEEP the previous valid config in that case, not
  // clobber with defaults. So we read raw first.
  let nextConfig: AgentConfig | null = null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    JSON.parse(raw); // validate
    nextConfig = loadConfig(currentWorkspace);
  } catch {
    // Malformed JSON or missing file — keep previous.
    return;
  }

  if (!nextConfig) return;

  current = nextConfig;

  if (previous && onCriticalChange) {
    const changes = diffCriticalKeys(previous, nextConfig);
    if (changes.length > 0) {
      try {
        onCriticalChange(changes);
      } catch {
        // Callback errors should not crash the watcher.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test-only helper — NOT exported from the public surface the server uses
// ---------------------------------------------------------------------------

/** Force a reload without going through fs.watch. Used by tests. */
export function __testReload(): void {
  if (!currentWorkspace) return;
  reload(path.join(currentWorkspace, "agent-config.json"));
}

/** Reset module state between tests. */
export function __testReset(): void {
  stopConfigWatcher();
  current = null;
  currentWorkspace = null;
  onCriticalChange = null;
}
