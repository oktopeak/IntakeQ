import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, intakePost, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerIntakeFormTools(server: McpServer): void {
  server.registerTool(
    "list_intake_forms",
    {
      description: "List intake form submissions. PHI — every call is audit-logged.",
      inputSchema: {
        clientId: z.string().optional().describe("Filter by client ID"),
        client: z.string().optional().describe("Filter by client name or email"),
        startDate: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
        all: z.boolean().optional().describe("Return all forms (not just submitted)"),
        updatedSince: z.string().optional().describe("Filter by last updated date (YYYY-MM-DD)"),
      },
    },
    async (args) => {
      const { clientId, client, startDate, endDate, page, all, updatedSince } = args;

      if (!clientId && !client && !startDate && !endDate) {
        await appendAuditLog({
          tool: "list_intake_forms",
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
        if (startDate) params["startDate"] = startDate;
        if (endDate) params["endDate"] = endDate;
        if (all !== undefined) params["all"] = all;
        if (updatedSince) params["updatedSince"] = updatedSince;

        const data = await intakeGet("/intakes/summary", params);
        await appendAuditLog({
          tool: "list_intake_forms",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
          client_id: clientId?.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_intake_forms", args, outcome: "success", client_id: clientId?.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_intake_forms", args, outcome: "error", error_message: err.message, client_id: clientId?.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_form",
    {
      description: "Get a single intake form submission by ID. PHI — every call is audit-logged.",
      inputSchema: {
        form_id: z.string().min(1).describe("The IntakeQ intake form ID"),
      },
    },
    async (args) => {
      const { form_id } = args;
      try {
        const data = await intakeGet(`/intakes/${form_id}`);
        await appendAuditLog({
          tool: "get_form",
          args,
          outcome: "success",
          result_count: 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_form", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "get_form", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_questionnaire_templates",
    {
      description: "List all questionnaire templates available in the IntakeQ account",
      inputSchema: {},
    },
    async (args) => {
      try {
        const data = await intakeGet("/questionnaires");
        await appendAuditLog({
          tool: "list_questionnaire_templates",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_questionnaire_templates", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_questionnaire_templates", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "send_intake_form",
    {
      description: "Send an intake form to a client. Provide QuestionnaireId plus either ClientId or (ClientName and ClientEmail).",
      inputSchema: {
        QuestionnaireId: z.string().min(1).describe("The questionnaire/template ID to send"),
        ClientId: z.string().optional().describe("Client ID (use this OR ClientName+ClientEmail)"),
        ClientName: z.string().optional().describe("Client full name (required if ClientId not provided)"),
        ClientEmail: z.string().email().optional().describe("Client email (required if ClientId not provided)"),
      },
    },
    async (args) => {
      const { QuestionnaireId, ClientId, ClientName, ClientEmail } = args;

      if (!ClientId && (!ClientName || !ClientEmail)) {
        await appendAuditLog({
          tool: "send_intake_form",
          args,
          outcome: "error",
          error_message: "Missing client identification: provide ClientId or ClientName+ClientEmail",
        });
        return {
          content: [{ type: "text", text: "Error: Provide either ClientId or both ClientName and ClientEmail." }],
          isError: true,
        };
      }

      try {
        const body: Record<string, unknown> = { QuestionnaireId };
        if (ClientId) {
          body["ClientId"] = ClientId;
        } else {
          body["ClientName"] = ClientName;
          body["ClientEmail"] = ClientEmail;
        }

        const data = await intakePost("/intakes/send", body);
        await appendAuditLog({
          tool: "send_intake_form",
          args,
          outcome: "success",
          client_id: ClientId?.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "send_intake_form", args, outcome: "success", client_id: ClientId?.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "send_intake_form", args, outcome: "error", error_message: err.message, client_id: ClientId?.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
