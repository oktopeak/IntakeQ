import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendAuditLog, readAuditLog } from "../utils/auditLog.js";

export function registerAuditExportTool(server: McpServer): void {
  server.registerTool(
    "audit_export",
    {
      description:
        "Export the local HIPAA §164.312(b) audit log. Every read and write of PHI is recorded here. Use date_from/date_to to filter by date range, client_id to filter by patient. Supports pagination via limit/offset.",
      inputSchema: {
        date_from: z.string().optional()
          .describe("ISO date string (YYYY-MM-DD) — inclusive start"),
        date_to: z.string().optional()
          .describe("ISO date string (YYYY-MM-DD) — inclusive end"),
        client_id: z.string().optional()
          .describe("Filter by IntakeQ client ID"),
        limit: z.number().int().min(1).max(1000).optional().default(500)
          .describe("Maximum entries to return (1–1000)."),
        offset: z.number().int().min(0).optional().default(0)
          .describe("Zero-based offset for pagination."),
      },
    },
    async ({ date_from, date_to, client_id, limit, offset }) => {
      try {
        const result = await readAuditLog({ date_from, date_to, client_id, limit, offset });

        await appendAuditLog({
          tool: "audit_export",
          args: { date_from, date_to, client_id, limit, offset },
          outcome: "success",
          result_count: result.entries.length,
        });

        const summary: Record<string, unknown> = {
          total_matched: result.total_matched,
          returned: result.entries.length,
          offset,
          truncated: result.truncated,
        };
        if (result.truncated) {
          summary.next_offset = offset + result.entries.length;
          summary.note = `Results truncated. Use offset=${offset + result.entries.length} to retrieve next page.`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ summary, entries: result.entries }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "audit_export",
          args: { date_from, date_to, client_id, limit, offset },
          outcome: "error",
          error_message: err.message,
        });
        return {
          content: [{ type: "text" as const, text: `Failed to export audit log: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
