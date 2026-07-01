import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

// Notes are read-only in the IntakeQ API — create_note is not available.

export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    "list_notes",
    {
      description: "List clinical notes. PHI — every call is audit-logged. Notes are read-only in IntakeQ.",
      inputSchema: {
        clientId: z.string().optional().describe("Filter by client ID"),
        client: z.string().optional().describe("Filter by client name or email"),
        status: z.string().optional().describe("Filter by note status"),
        startDate: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
        updatedSince: z.string().optional().describe("Filter by last updated date (YYYY-MM-DD)"),
      },
    },
    async (args) => {
      const { clientId, client, status, startDate, endDate, page, updatedSince } = args;

      if (!clientId && !client && !startDate && !endDate) {
        await appendAuditLog({
          tool: "list_notes",
          args,
          outcome: "error",
          error_message: "At least one of clientId, client, startDate, or endDate is required",
        });
        return {
          content: [{ type: "text", text: "Error: At least one of clientId, client, startDate, or endDate is required." }],
          isError: true,
        };
      }

      try {
        const params: Record<string, string | number | boolean> = { page };
        if (clientId) params["clientId"] = clientId;
        if (client) params["client"] = client;
        if (status) params["status"] = status;
        if (startDate) params["startDate"] = startDate;
        if (endDate) params["endDate"] = endDate;
        if (updatedSince) params["updatedSince"] = updatedSince;

        const data = await intakeGet("/notes/summary", params);
        await appendAuditLog({
          tool: "list_notes",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
          client_id: clientId?.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_notes", args, outcome: "success", client_id: clientId?.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_notes", args, outcome: "error", error_message: err.message, client_id: clientId?.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_note",
    {
      description: "Get a single clinical note by ID. PHI — every call is audit-logged.",
      inputSchema: {
        note_id: z.string().min(1).describe("The IntakeQ note ID"),
      },
    },
    async (args) => {
      const { note_id } = args;
      try {
        const data = await intakeGet(`/notes/${note_id}`);
        await appendAuditLog({
          tool: "get_note",
          args,
          outcome: "success",
          result_count: 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_note", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "get_note", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
