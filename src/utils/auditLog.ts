import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { getSessionContext } from "./sessionContext.js";

const STDIO_SESSION_ID = randomUUID();

const AUDIT_DIR = path.join(os.homedir(), ".intakeq-mcp");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit.log");

const REDACTED_KEYS = new Set([
  "api_key",
  "access_token",
  "refresh_token",
  "client_secret",
  "password",
  "token",
  "encryption_key",
  "x-auth-key",
]);

function detectMachineIp(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
}
const MACHINE_IP: string | undefined = detectMachineIp();

export interface AuditEntry {
  timestamp: string;
  session_id: string;
  machine_ip?: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: "success" | "error";
  error_message?: string;
  intakeq_practitioner_id?: string;
  client_id?: string;
  result_count?: number;
}

export interface AuditLogFilter {
  date_from?: string;
  date_to?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
}

export interface ReadAuditLogResult {
  entries: AuditEntry[];
  total_matched: number;
  truncated: boolean;
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactArgs(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function appendAuditLog(
  entry: Omit<AuditEntry, "timestamp" | "session_id" | "machine_ip"> & {
    intakeq_practitioner_id?: string;
  }
): Promise<void> {
  try {
    await fs.mkdir(AUDIT_DIR, { recursive: true, mode: 0o700 });

    const ctx = getSessionContext();
    const session_id = ctx?.sessionId ?? STDIO_SESSION_ID;

    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      session_id,
      ...(MACHINE_IP !== undefined && { machine_ip: MACHINE_IP }),
      tool: entry.tool,
      args: redactArgs(entry.args),
      outcome: entry.outcome,
      ...(entry.error_message && { error_message: entry.error_message }),
      ...(entry.intakeq_practitioner_id && { intakeq_practitioner_id: entry.intakeq_practitioner_id }),
      ...(entry.client_id !== undefined && { client_id: entry.client_id }),
      ...(entry.result_count !== undefined && { result_count: entry.result_count }),
    };

    await fs.appendFile(AUDIT_FILE, JSON.stringify(full) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch (err: any) {
    // Deliberately fail open: a broken audit log (e.g. disk full, permissions)
    // must not block clinical tool calls. The failure is surfaced with a
    // dedicated, greppable prefix so it can be alerted on operationally —
    // see README "Audit logging is fail-open" for the tradeoff.
    console.error(`[audit-log-failure] Failed to write audit log entry for tool "${entry.tool}": ${err.message}`);
  }
}

export async function readAuditLog(filter: AuditLogFilter = {}): Promise<ReadAuditLogResult> {
  const limit = Math.max(1, Math.min(filter.limit ?? 500, 1000));
  const offset = filter.offset ?? 0;

  let raw: string;
  try {
    raw = await fs.readFile(AUDIT_FILE, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return { entries: [], total_matched: 0, truncated: false };
    throw err;
  }

  const matched: AuditEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry: Partial<AuditEntry>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (filter.date_from && (!entry.timestamp || entry.timestamp.slice(0, 10) < filter.date_from)) continue;
    if (filter.date_to && (!entry.timestamp || entry.timestamp.slice(0, 10) > filter.date_to)) continue;
    if (filter.client_id !== undefined && entry.client_id !== filter.client_id) continue;
    matched.push(entry as AuditEntry);
  }

  const total_matched = matched.length;
  const page = matched.slice(offset, offset + limit);
  return { entries: page, total_matched, truncated: offset + page.length < total_matched };
}
