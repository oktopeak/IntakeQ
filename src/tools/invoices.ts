import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool(
    "list_invoices",
    {
      description: "List invoices from the connected IntakeQ account",
      inputSchema: {
        clientId: z.number().int().optional().describe("Filter by client integer ID (ClientIdNumber, not the GUID)"),
        startDate: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
        lastUpdatedStartDate: z.string().optional().describe("Return invoices changed after this date (YYYY-MM-DD)"),
        lastUpdatedEndDate: z.string().optional().describe("Return invoices changed before this date (YYYY-MM-DD)"),
        status: z.string().optional().describe("Filter by status: Draft, Scheduled, Unpaid, Paid, PastDue, Refunded, Forgiven, Canceled"),
        practitionerEmail: z.string().optional().describe("Filter by practitioner email"),
        number: z.number().int().optional().describe("Filter by invoice number"),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
      },
    },
    async (args) => {
      const { clientId, startDate, endDate, lastUpdatedStartDate, lastUpdatedEndDate, status, practitionerEmail, number, page } = args;
      try {
        const params: Record<string, string | number | boolean> = { page };
        if (clientId) params["clientId"] = clientId;
        if (startDate) params["startDate"] = startDate;
        if (endDate) params["endDate"] = endDate;
        if (lastUpdatedStartDate) params["lastUpdatedStartDate"] = lastUpdatedStartDate;
        if (lastUpdatedEndDate) params["lastUpdatedEndDate"] = lastUpdatedEndDate;
        if (status) params["status"] = status;
        if (practitionerEmail) params["practitionerEmail"] = practitionerEmail;
        if (number) params["number"] = number;

        const data = await intakeGet("/invoices", params);
        await appendAuditLog({
          tool: "list_invoices",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
          client_id: clientId?.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_invoices", args, outcome: "success", client_id: clientId?.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_invoices", args, outcome: "error", error_message: err.message, client_id: clientId?.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_invoice",
    {
      description: "Get a single invoice by ID",
      inputSchema: {
        invoice_id: z.string().min(1).describe("The IntakeQ invoice ID"),
      },
    },
    async (args) => {
      const { invoice_id } = args;
      try {
        const data = await intakeGet(`/invoices/${invoice_id}`);
        await appendAuditLog({
          tool: "get_invoice",
          args,
          outcome: "success",
          result_count: 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_invoice", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "get_invoice", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
