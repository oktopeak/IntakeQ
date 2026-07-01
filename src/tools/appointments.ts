import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { intakeGet, intakePost, intakePut, IntakeApiError } from "../utils/intakeClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerAppointmentTools(server: McpServer): void {
  server.registerTool(
    "list_appointments",
    {
      description: "List appointments. At least one of clientId, startDate, or endDate must be provided.",
      inputSchema: {
        clientId: z.string().optional().describe("Filter by client ID"),
        startDate: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
        endDate: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
        status: z.string().optional().describe("Filter by appointment status"),
        practitionerEmail: z.string().optional().describe("Filter by practitioner email"),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)"),
      },
    },
    async (args) => {
      const { clientId, startDate, endDate, status, practitionerEmail, page } = args;

      if (!clientId && !startDate && !endDate) {
        await appendAuditLog({
          tool: "list_appointments",
          args,
          outcome: "error",
          error_message: "At least one of clientId, startDate, or endDate is required",
        });
        return {
          content: [{ type: "text", text: "Error: At least one of clientId, startDate, or endDate is required." }],
          isError: true,
        };
      }

      try {
        const params: Record<string, string | number | boolean> = { page };
        if (clientId) params["client"] = clientId;
        if (startDate) params["startDate"] = startDate;
        if (endDate) params["endDate"] = endDate;
        if (status) params["status"] = status;
        if (practitionerEmail) params["practitionerEmail"] = practitionerEmail;

        const data = await intakeGet("/appointments", params);
        await appendAuditLog({
          tool: "list_appointments",
          args,
          outcome: "success",
          result_count: Array.isArray(data) ? data.length : 1,
          client_id: clientId?.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "list_appointments", args, outcome: "success", client_id: clientId?.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "list_appointments", args, outcome: "error", error_message: err.message, client_id: clientId?.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_appointment",
    {
      description: "Get a single appointment by ID",
      inputSchema: {
        appointment_id: z.string().min(1).describe("The IntakeQ appointment ID"),
      },
    },
    async (args) => {
      const { appointment_id } = args;
      try {
        const data = await intakeGet(`/appointments/${appointment_id}`);
        await appendAuditLog({
          tool: "get_appointment",
          args,
          outcome: "success",
          result_count: 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_appointment", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "get_appointment", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_appointment",
    {
      description: "Create a new appointment in IntakeQ. All fields are required.",
      inputSchema: {
        PractitionerId: z.string().min(1).describe("Practitioner ID"),
        ClientId: z.number().int().describe("Client ID (integer)"),
        ServiceId: z.string().min(1).describe("Service ID"),
        LocationId: z.string().min(1).describe("Location ID"),
        Status: z.string().min(1).describe("Appointment status"),
        UtcDateTime: z.number().int().describe("UTC date/time in Unix milliseconds"),
        SendClientEmailNotification: z.boolean().describe("Whether to send client email notification"),
        ReminderType: z.string().min(1).describe("Reminder type"),
      },
    },
    async (args) => {
      const { PractitionerId, ClientId, ServiceId, LocationId, Status, UtcDateTime, SendClientEmailNotification, ReminderType } = args;
      try {
        const body = { PractitionerId, ClientId, ServiceId, LocationId, Status, UtcDateTime, SendClientEmailNotification, ReminderType };
        const data = await intakePost("/appointments", body);
        await appendAuditLog({
          tool: "create_appointment",
          args,
          outcome: "success",
          client_id: ClientId.toString(),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "create_appointment", args, outcome: "success", client_id: ClientId.toString() });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "create_appointment", args, outcome: "error", error_message: err.message, client_id: ClientId.toString() });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_appointment",
    {
      description: "Update an existing appointment via PUT. Id and UtcDateTime are required. Cannot change client or practitioner.",
      inputSchema: {
        Id: z.string().min(1).describe("Appointment ID (required)"),
        UtcDateTime: z.number().int().describe("New UTC date/time in Unix milliseconds (required)"),
        ServiceId: z.string().optional().describe("Service ID"),
        LocationId: z.string().optional().describe("Location ID"),
        Status: z.string().optional().describe("Appointment status"),
        SendClientEmailNotification: z.boolean().optional().describe("Whether to send client email notification"),
        ReminderType: z.string().optional().describe("Reminder type"),
      },
    },
    async (args) => {
      const { Id, UtcDateTime, ServiceId, LocationId, Status, SendClientEmailNotification, ReminderType } = args;
      try {
        const body: Record<string, unknown> = { Id, UtcDateTime };
        if (ServiceId !== undefined) body["ServiceId"] = ServiceId;
        if (LocationId !== undefined) body["LocationId"] = LocationId;
        if (Status !== undefined) body["Status"] = Status;
        if (SendClientEmailNotification !== undefined) body["SendClientEmailNotification"] = SendClientEmailNotification;
        if (ReminderType !== undefined) body["ReminderType"] = ReminderType;

        const data = await intakePut("/appointments", body);
        const clientId = (data as Record<string, unknown>)["ClientId"];
        await appendAuditLog({
          tool: "update_appointment",
          args,
          outcome: "success",
          client_id: clientId != null ? String(clientId) : undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        if (err instanceof IntakeApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "update_appointment", args, outcome: "success" });
          return { content: [{ type: "text", text: "Not found." }] };
        }
        await appendAuditLog({ tool: "update_appointment", args, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
