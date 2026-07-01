import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerFileTools(server: McpServer): void {
  server.registerTool(
    "list_files",
    {
      description:
        "List file metadata for a client. Returns references only (Id, FileName, DateCreated, Size, ContentType, FolderId). " +
        "Files are never downloaded — this tool returns metadata references only. clientId is mandatory.",
      inputSchema: {
        clientId: z.string().min(1).describe("Client ID (mandatory — the IntakeQ files API requires this)"),
      },
    },
    async (args) => {
      const { clientId } = args;
      try {
        const data = await intakeGet("/files", { clientId });
        await appendAuditLog({
          tool: "list_files",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
          client_id: clientId.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_files", args, outcome: "success", client_id: clientId.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_files", args, outcome: "error", error_message: err.message, client_id: clientId.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
