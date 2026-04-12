/**
 * HTTP Bridge — optional local HTTP server that runs alongside the MCP stdio server.
 *
 * When enabled via agent-config.json (`http.enabled: true`), this starts a
 * localhost HTTP listener that exposes agent status, webhook ingestion, and
 * (future) OpenAI-compatible chat endpoints.
 *
 * Architecture: Node's built-in `http` module — zero external dependencies.
 * The server only binds to 127.0.0.1 by default for security.
 */

import http from "http";
import fs from "fs";
import path from "path";

export interface HttpBridgeConfig {
  enabled: boolean;
  port: number;
  host: string;
  /** Bearer token for authenticated endpoints. If empty, no auth required. */
  token: string;
}

export const HTTP_DEFAULTS: HttpBridgeConfig = {
  enabled: false,
  port: 18790,
  host: "127.0.0.1",
  token: "",
};

interface StatusProvider {
  getIdentity: () => string;
  getMemoryStats: () => { files: number; chunks: number; totalSize: number };
  getConfig: () => Record<string, any>;
}

interface WebhookEntry {
  id: string;
  ts: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export class HttpBridge {
  private server: http.Server | null = null;
  private config: HttpBridgeConfig;
  private workspace: string;
  private status: StatusProvider;
  private webhookQueue: WebhookEntry[] = [];
  private startedAt: string | null = null;

  constructor(
    config: HttpBridgeConfig,
    workspace: string,
    status: StatusProvider
  ) {
    this.config = config;
    this.workspace = workspace;
    this.status = status;
  }

  /** Start the HTTP server. Returns the actual port. */
  async start(): Promise<number> {
    if (this.server) return this.config.port;

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handleRequest(req, res));

      srv.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          // Port busy — log and don't crash the MCP server
          console.error(
            `[http-bridge] Port ${this.config.port} in use — HTTP bridge disabled`
          );
          this.server = null;
          reject(err);
        } else {
          reject(err);
        }
      });

      srv.listen(this.config.port, this.config.host, () => {
        this.server = srv;
        this.startedAt = new Date().toISOString();
        console.error(
          `[http-bridge] Listening on http://${this.config.host}:${this.config.port}`
        );
        resolve(this.config.port);
      });
    });
  }

  /** Stop the HTTP server gracefully. */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.startedAt = null;
        resolve();
      });
    });
  }

  /** Whether the HTTP server is currently running. */
  isRunning(): boolean {
    return this.server !== null;
  }

  /** Drain the webhook queue (called by MCP tool). */
  drainWebhooks(limit = 10): WebhookEntry[] {
    return this.webhookQueue.splice(0, limit);
  }

  /** Peek at webhook queue size without draining. */
  webhookCount(): number {
    return this.webhookQueue.length;
  }

  // -------------------------------------------------------------------------
  // Request handling
  // -------------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || "/", `http://${this.config.host}`);
    const method = (req.method || "GET").toUpperCase();
    const pathname = url.pathname;

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // --- Public endpoints (no auth) ---
    if (method === "GET" && pathname === "/health") {
      this.sendJson(res, 200, { status: "ok", uptime: this.startedAt });
      return;
    }

    // --- Auth-gated endpoints ---
    if (this.config.token && !this.checkAuth(req)) {
      this.sendJson(res, 401, { error: "Unauthorized — set Bearer token" });
      return;
    }

    // Route
    if (method === "GET" && pathname === "/v1/status") {
      this.handleStatus(res);
    } else if (method === "GET" && pathname === "/v1/webhooks") {
      this.handleDrainWebhooks(res, url);
    } else if (method === "POST" && pathname === "/v1/webhook") {
      this.handleIncomingWebhook(req, res);
    } else if (method === "GET" && pathname === "/v1/skills") {
      this.handleListSkills(res);
    } else {
      this.sendJson(res, 404, {
        error: "Not found",
        endpoints: [
          "GET  /health",
          "GET  /v1/status",
          "GET  /v1/skills",
          "POST /v1/webhook",
          "GET  /v1/webhooks",
        ],
      });
    }
  }

  // --- Endpoint handlers ---

  private handleStatus(res: http.ServerResponse) {
    const identity = this.status.getIdentity();
    const memStats = this.status.getMemoryStats();
    const config = this.status.getConfig();

    this.sendJson(res, 200, {
      agent: {
        identity,
        workspace: this.workspace,
        startedAt: this.startedAt,
      },
      memory: memStats,
      http: {
        port: this.config.port,
        host: this.config.host,
        webhookQueueSize: this.webhookQueue.length,
      },
      config: {
        memoryBackend: config.memory?.backend ?? "builtin",
        citations: config.memory?.citations ?? "auto",
      },
    });
  }

  private handleListSkills(res: http.ServerResponse) {
    const skillsDir = path.join(this.workspace, "skills");
    const skills: Array<{ name: string; description: string }> = [];

    try {
      if (fs.existsSync(skillsDir)) {
        for (const entry of fs.readdirSync(skillsDir, {
          withFileTypes: true,
        })) {
          if (!entry.isDirectory()) continue;
          const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
          try {
            const content = fs.readFileSync(skillFile, "utf-8");
            // Extract description from frontmatter
            const match = content.match(
              /^---\s*\n[\s\S]*?description:\s*(.+?)\n[\s\S]*?---/m
            );
            skills.push({
              name: entry.name,
              description: match?.[1]?.trim() ?? "(no description)",
            });
          } catch {
            skills.push({ name: entry.name, description: "(unreadable)" });
          }
        }
      }
    } catch {
      // skills dir doesn't exist or isn't readable
    }

    this.sendJson(res, 200, { skills, count: skills.length });
  }

  private handleDrainWebhooks(
    res: http.ServerResponse,
    url: URL
  ) {
    const limit = Math.min(
      Number(url.searchParams.get("limit")) || 10,
      100
    );
    const entries = this.drainWebhooks(limit);
    this.sendJson(res, 200, { entries, remaining: this.webhookQueue.length });
  }

  private handleIncomingWebhook(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");

      const entry: WebhookEntry = {
        id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        method: req.method || "POST",
        path: req.url || "/v1/webhook",
        headers: {
          "content-type": req.headers["content-type"],
          "x-webhook-source": req.headers["x-webhook-source"] as string,
        },
        body: body.slice(0, 64_000), // cap body at 64KB
      };

      // Cap queue at 1000 entries
      if (this.webhookQueue.length >= 1000) {
        this.webhookQueue.shift();
      }
      this.webhookQueue.push(entry);

      this.sendJson(res, 202, {
        accepted: true,
        id: entry.id,
        queueSize: this.webhookQueue.length,
      });
    });
  }

  // --- Helpers ---

  private checkAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!auth) return false;
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    return token === this.config.token;
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    data: unknown
  ) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(statusCode, {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
