# @oktopeak/intakeq-mcp

IntakeQ/PracticeQ MCP connector for Claude. Gives Claude access to your
IntakeQ scheduling, intake forms, treatment notes, invoices, and client records
through the [Model Context Protocol](https://modelcontextprotocol.io/).

Every PHI read and write is logged locally in compliance with HIPAA §164.312(b).

---

## ⚠️ Before you connect this to real patient data

Two things must be in place before PHI flows through this connector:

1. **IntakeQ BAA** — IntakeQ/PracticeQ includes a Business Associate Agreement.
   Sign it in your IntakeQ account (Settings → HIPAA) before going live.
   This is one of IntakeQ's strengths: the BAA is self-serve and included in all plans.

2. **Anthropic enterprise tier with ZDR** — With hosted Claude + MCP, PHI goes to
   Anthropic for inference. The defensible claim is **training-disabled + Zero Data
   Retention under enterprise + BAA** — not data locality. "Access" (the model
   processed it) is the exposure, not just retention.
   Sign up for Anthropic enterprise and request a BAA before using this with real patients.

**What this connector does:**
- Brokers authenticated calls to the IntakeQ REST API
- Logs every PHI read and write to `~/.intakeq-mcp/audit.log` (HIPAA §164.312(b))
- Stores your API key encrypted (AES-256-GCM) locally — no PHI content stored (audit entries contain only access-trail identifiers)

---

## Installation

```bash
npm install -g @oktopeak/intakeq-mcp
```

## Claude Desktop configuration

```json
{
  "mcpServers": {
    "intakeq": {
      "command": "intakeq-mcp"
    }
  }
}
```

## Authentication

Generate your API key in IntakeQ: **Settings → Integrations → Developer API**

Then tell Claude:
> "Set my IntakeQ API key to [your-key]"

Or use the MCP tool directly: `set_api_key`

## Tools

| Tool | Description | R/W |
|------|-------------|-----|
| `set_api_key` | Store IntakeQ API key | W |
| `auth_status` | Verify API connection | R |
| `clear_api_key` | Remove stored key | W |
| `list_clients` | Search/list clients | R |
| `get_client` | Single client profile | R |
| `list_practitioners` | All practitioners in the account | R |
| `list_services` | Services configured in the account | R |
| `list_locations` | Locations configured in the account | R |
| `list_appointments` | Appointments by client/date | R |
| `get_appointment` | Single appointment | R |
| `create_appointment` | Book appointment | W |
| `update_appointment` | Reschedule/update | W |
| `list_intake_forms` | Submitted intake forms | R |
| `get_form` | Full form with answers | R |
| `list_questionnaire_templates` | Available form templates | R |
| `send_intake_form` | Send form to client | W |
| `list_notes` | Treatment notes (read-only in IntakeQ API) | R |
| `get_note` | Full note | R |
| `list_invoices` | Client invoices | R |
| `get_invoice` | Single invoice | R |
| `list_files` | Client file metadata | R |
| `audit_export` | Export HIPAA audit trail | R |

> **Tip:** call `list_practitioners`, `list_services`, and `list_locations` before `create_appointment` to obtain valid IDs required by that tool.

## MCP Resources

| Resource URI | Description |
|---|---|
| `intakeq://compliance-notice` | HIPAA compliance notice — BAA requirements and what the connector logs |
| `intakeq://auth-status` | Live authentication status (JSON) |

## HIPAA Audit Log

Every PHI read and write is appended to `~/.intakeq-mcp/audit.log` (JSONL format).
Each entry records: timestamp, session ID, machine IP, tool name, arguments (sanitized),
outcome, practitioner ID, client ID, and result count.

Export the audit log at any time: ask Claude to run `audit_export`.

**Audit logging is fail-open.** If the log file can't be written (disk full, permissions),
the tool call still completes rather than blocking clinical work — the failure is written
to stderr with an `[audit-log-failure]` prefix so it can be monitored/alerted on. If you
need a hard guarantee that PHI access is never left unlogged, monitor process stderr for
that prefix in your deployment.

## HTTP transport

The server runs in **stdio mode** by default. To run as an HTTP server (e.g. for multi-user or remote deployments):

```bash
MCP_API_KEY=your-secret TRANSPORT=http PORT=3000 intakeq-mcp
```

The MCP endpoint is at `/mcp`, gated by a required Bearer token (`MCP_API_KEY`). **The
server refuses to start in HTTP mode without `MCP_API_KEY` set**, since an unauthenticated
endpoint would expose every PHI tool to anyone who can reach the port. To explicitly opt
into an unauthenticated endpoint for local development only, set `MCP_ALLOW_NO_AUTH=true` —
never do this with real patient data.

HTTP transport does not terminate TLS itself. Run it behind a reverse proxy (nginx, Caddy,
your cloud provider's load balancer, etc.) that terminates HTTPS — otherwise the Bearer
token and all PHI in transit are sent in plaintext on the network.

Each HTTP session maintains its own API key in memory — the `set_api_key` tool scopes the key to the session and never writes it to the shared disk file. Sessions are garbage-collected after 24 hours.

Health check: `GET /health` → `{ "ok": true, "sessions": <count> }`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `INTAKEQ_API_KEY` | — | Fallback API key for CI / headless use (prefer the `set_api_key` tool) |
| `INTAKEQ_API_BASE` | `https://intakeq.com/api/v1` | Override the IntakeQ API base URL |
| `TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | `3000` | HTTP server port (HTTP mode only) |
| `MCP_BASE_URL` | `http://127.0.0.1:3000` | Base URL printed in HTTP startup logs |
| `MCP_API_KEY` | — | Bearer token to gate the HTTP `/mcp` endpoint. **Required** in HTTP mode unless `MCP_ALLOW_NO_AUTH=true` |
| `MCP_ALLOW_NO_AUTH` | — | Set to `true` to explicitly allow HTTP mode without `MCP_API_KEY` (local dev only) |

## Rate limiting

IntakeQ enforces ~10 requests/minute. The connector retries automatically on HTTP 429 (up to 3 attempts, with back-off delays of 10 s / 20 s / 30 s). After 3 failures the error is surfaced rather than hanging indefinitely.

## Not yet covered

- Insurance claims / CMS-1500 write
- Webhooks
- Bulk operations
- Creating treatment notes (not available in IntakeQ API)
