import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerPractitionerTools(server: McpServer): void {
  server.registerTool(
    "list_practitioners",
    {
      description: "List all practitioners in the IntakeQ account. Call this before create_appointment to find a valid PractitionerId.",
      inputSchema: {},
    },
    async (args) => {
      try {
        const data = await intakeGet("/practitioners");
        await appendAuditLog({
          tool: "list_practitioners",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_practitioners", args, outcome: "error", error_message: err.message });
          return { content: [{ type: "text", text: "Not found." }], isError: true };
        }
        await appendAuditLog({ tool: "list_practitioners", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_services",
    {
      description: "List services configured in the IntakeQ account. Call this before create_appointment to find a valid ServiceId.",
      inputSchema: {
        practitionerEmail: z.string().email().optional().describe("Filter by practitioner email"),
      },
    },
    async (args) => {
      try {
        const data = await intakeGet("/appointments/settings") as Record<string, unknown[]>;
        const services: unknown[] = data.Services ?? [];
        await appendAuditLog({
          tool: "list_services",
          args,
          outcome: "success",
          result_count: services.length,
        });
        return { content: [{ type: "text", text: JSON.stringify(services, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_services", args, outcome: "error", error_message: err.message });
          return { content: [{ type: "text", text: "Not found." }], isError: true };
        }
        await appendAuditLog({ tool: "list_services", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_locations",
    {
      description: "List locations configured in the IntakeQ account. Call this before create_appointment to find a valid LocationId.",
      inputSchema: {},
    },
    async (args) => {
      try {
        const data = await intakeGet("/appointments/settings") as Record<string, unknown[]>;
        const locations: unknown[] = data.Locations ?? [];
        await appendAuditLog({
          tool: "list_locations",
          args,
          outcome: "success",
          result_count: locations.length,
        });
        return { content: [{ type: "text", text: JSON.stringify(locations, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_locations", args, outcome: "error", error_message: err.message });
          return { content: [{ type: "text", text: "Not found." }], isError: true };
        }
        await appendAuditLog({ tool: "list_locations", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
