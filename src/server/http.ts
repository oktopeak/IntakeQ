import express from "express";
import { readFileSync } from "fs";
import { randomUUID, timingSafeEqual } from "crypto";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAuthTools } from "../auth/authTools.js";
import { registerClientTools } from "../tools/clients.js";
import { registerPractitionerTools } from "../tools/practitioners.js";
import { registerAppointmentTools } from "../tools/appointments.js";
import { registerIntakeFormTools } from "../tools/intakeForms.js";
import { registerNoteTools } from "../tools/notes.js";
import { registerInvoiceTools } from "../tools/invoices.js";
import { registerFileTools } from "../tools/files.js";
import { registerAuditExportTool } from "../tools/auditExport.js";
import { registerResources } from "../resources/index.js";
import { sessionStorage, SessionContext } from "../utils/sessionContext.js";

interface SessionRecord {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer | null;
  apiKey: string | null;
  createdAt: number;
}

const sessions = new Map<string, SessionRecord>();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "intakeq-mcp", version: pkg.version });
  registerAuthTools(server);
  registerClientTools(server);
  registerPractitionerTools(server);
  registerAppointmentTools(server);
  registerIntakeFormTools(server);
  registerNoteTools(server);
  registerInvoiceTools(server);
  registerFileTools(server);
  registerAuditExportTool(server);
  registerResources(server);
  return server;
}

function makeSessionContext(sessionId: string, record: SessionRecord): SessionContext {
  return {
    sessionId,
    getApiKey: () => record.apiKey,
    storeApiKey: (key: string) => { record.apiKey = key; },
    clearApiKey: () => { record.apiKey = null; },
  };
}

// Stale session GC: remove sessions older than 24 hours
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, rec] of sessions) {
    if (rec.createdAt < cutoff) {
      rec.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000).unref();

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key = process.env.MCP_API_KEY;
  if (!key) { next(); return; }
  const auth = req.headers.authorization ?? "";
  if (!safeEquals(auth, `Bearer ${key}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

app.all("/mcp", requireApiKey, express.json(), async (req, res) => {
  try {
    const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!incomingSessionId) {
      // New connection: allocate record and create transport
      const record: SessionRecord = {
        transport: null!,
        mcpServer: null,
        apiKey: null,
        createdAt: Date.now(),
      };

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (sessionId) => {
          record.mcpServer = createMcpServer();
          sessions.set(sessionId, record);
          await record.mcpServer.connect(transport);
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        },
      });
      record.transport = transport;

      // Use a temporary placeholder context for the initialize request.
      // No tools run during initialization, so getApiKey is never called.
      const tempCtx: SessionContext = {
        sessionId: "",
        getApiKey: () => null,
        storeApiKey: () => {},
        clearApiKey: () => {},
      };

      await sessionStorage.run(tempCtx, () =>
        transport.handleRequest(req, res, req.body)
      );
    } else {
      // Existing session: route to correct transport
      const record = sessions.get(incomingSessionId);
      if (!record) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const ctx = makeSessionContext(incomingSessionId, record);
      await sessionStorage.run(ctx, () =>
        record.transport.handleRequest(req, res, req.body)
      );
    }
  } catch (err: any) {
    console.error("[http] /mcp error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export async function startHttpServer(): Promise<void> {
  if (!process.env.MCP_API_KEY && process.env.MCP_ALLOW_NO_AUTH !== "true") {
    throw new Error(
      "Refusing to start HTTP transport: MCP_API_KEY is not set. This connector brokers " +
      "access to PHI, so the /mcp endpoint must not be exposed unauthenticated. Set " +
      "MCP_API_KEY, or set MCP_ALLOW_NO_AUTH=true to explicitly opt into an unauthenticated " +
      "endpoint (local development only — never for real patient data)."
    );
  }
  if (!process.env.MCP_API_KEY) {
    console.error(
      "[http] WARNING: MCP_API_KEY is not set and MCP_ALLOW_NO_AUTH=true — the /mcp endpoint " +
      "is UNAUTHENTICATED. Anyone who can reach this port can access PHI tools. Do not use " +
      "this configuration with real patient data."
    );
  }

  const port = parseInt(process.env.PORT ?? "3000", 10);
  return new Promise((resolve) => {
    app.listen(port, () => {
      const baseUrl = (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${port}`).trim();
      console.error(`[http] IntakeQ MCP server listening on port ${port}`);
      console.error(`[http] MCP endpoint : ${baseUrl}/mcp`);
      console.error(`[http] Health check : ${baseUrl}/health`);
      resolve();
    });
  });
}
