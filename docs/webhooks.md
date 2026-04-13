# Webhooks — External Systems Talking to Your Agent

The HTTP bridge exposes `POST /v1/webhook` so any external system can send events to the agent. Events are queued and the agent processes them on its next idle turn.

## How it works

```
External system  →  POST /v1/webhook  →  Queue (up to 1000)  →  Agent reads via MCP
```

1. External system sends a JSON POST to `http://localhost:18790/v1/webhook`
2. The bridge queues it with a timestamp, ID, and source headers
3. The agent reads queued events via `chat_inbox_read` MCP tool (or `GET /v1/webhooks`)
4. The agent processes the event — responds, logs to memory, takes action

## Sending a webhook

```sh
curl -X POST http://localhost:18790/v1/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Source: github" \
  -d '{"event": "push", "repo": "my-app", "branch": "main", "commits": 3}'
```

If auth is configured, add the token:

```sh
curl -X POST http://localhost:18790/v1/webhook \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"event": "alert", "service": "api", "status": "down"}'
```

## Response

```json
{
  "accepted": true,
  "id": "wh_1776025820614_wzid9g",
  "queueSize": 1
}
```

Status `202 Accepted` means the event is queued. The agent will process it when idle.

## Use cases

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/notify-agent.yml
- name: Notify agent
  run: |
    curl -X POST http://your-host:18790/v1/webhook \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${{ secrets.AGENT_TOKEN }}" \
      -d '{"event": "deploy", "status": "${{ job.status }}", "repo": "${{ github.repository }}"}'
```

The agent receives the event and can: summarize, notify via WhatsApp, log to memory, or take corrective action.

### Cloudflare Worker

```js
export default {
  async scheduled(event, env) {
    await fetch("http://your-host:18790/v1/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.AGENT_TOKEN,
      },
      body: JSON.stringify({ event: "cron", task: "daily-report" }),
    });
  }
};
```

### Monitoring / Uptime

```sh
# From your monitoring system
curl -X POST http://localhost:18790/v1/webhook \
  -d '{"event": "alert", "service": "api-gateway", "status": "timeout", "duration_ms": 30000}'
```

### IoT / Sensors

```sh
# From a Raspberry Pi or sensor
curl -X POST http://localhost:18790/v1/webhook \
  -d '{"event": "sensor", "device": "greenhouse", "temperature": 38.5, "humidity": 72}'
```

## Queue limits

- Max 1000 events in the queue. Oldest dropped when full.
- Max 64KB per event body.
- Events are lost if Claude Code restarts (in-memory queue).

## Draining the queue

The agent reads events via MCP tool:

```
chat_inbox_read(limit=10)
```

Or via HTTP:

```sh
curl http://localhost:18790/v1/webhooks?limit=10
```

Draining removes events from the queue. Unread events stay until drained or Claude Code restarts.

## Prerequisites

- HTTP bridge enabled: `agent_config(action='set', key='http.enabled', value='true')`
- If sending from outside localhost, configure `http.host: "0.0.0.0"` and set a token for security.
