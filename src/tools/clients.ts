import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerClientTools(server: McpServer): void {
  server.registerTool(
    "list_clients",
    {
      description: "Search/list clients in the connected IntakeQ account. Returns up to 100 results per page.\n\nResponse field reference:\n  BillingType: 0=Unknown, 1=SelfPay, 2=Insurance\n  LinkedClientRelationshipType: 0=None, 1=Parent, 2=Child, 3=Spouse, 4=Sibling, 5=Other, 6=Partner",
      inputSchema: {
        search: z.string().optional().describe("Name or email search term"),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
      },
    },
    async (args) => {
      const { search, page } = args;
      try {
        const params: Record<string, string | number | boolean> = { page };
        if (search) params["search"] = search;

        const data = await intakeGet("/clients", params);
        await appendAuditLog({
          tool: "list_clients",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_clients", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_clients", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_client",
    {
      description: "Get a single client by ID (includes full profile).\n\nResponse field reference:\n  BillingType: 0=Unknown, 1=SelfPay, 2=Insurance\n  LinkedClientRelationshipType: 0=None, 1=Parent, 2=Child, 3=Spouse, 4=Sibling, 5=Other, 6=Partner",
      inputSchema: {
        client_id: z.string().min(1).describe("The IntakeQ client ID"),
      },
    },
    async (args) => {
      const { client_id } = args;
      try {
        const data = await intakeGet("/clients", { search: client_id, includeProfile: true });
        await appendAuditLog({
          tool: "get_client",
          args,
          outcome: "success",
          result_count: 1,
          client_id: client_id.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_client", args, outcome: "success", client_id: client_id.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "get_client", args, outcome: "error", error_message: err.message, client_id: client_id.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
