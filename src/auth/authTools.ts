import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveApiKey, clearApiKey } from "./keyStorage.js";
import { verifyApiKey } from "./apiKeyAuth.js";
import { appendAuditLog } from "../utils/auditLog.js";
import { getSessionContext } from "../utils/sessionContext.js";

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    "set_api_key",
    {
      description: "Store your IntakeQ API key and verify connectivity",
      inputSchema: {
        api_key: z.string().min(1).describe("IntakeQ API key from Settings → Integrations → Developer API"),
      },
    },
    async ({ api_key }) => {
      // Store to session context if in HTTP mode
      getSessionContext()?.storeApiKey(api_key);

      // Persist to encrypted disk
      await saveApiKey(api_key);

      // Verify the key works
      const result = await verifyApiKey();

      // Audit-log — key value MUST be redacted
      await appendAuditLog({
        tool: "set_api_key",
        args: { api_key: "[REDACTED]" },
        outcome: result.valid ? "success" : "error",
        ...(result.valid ? {} : { error_message: result.detail }),
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ stored: true, verified: result.valid, detail: result.detail }),
        }],
      };
    }
  );

  server.registerTool(
    "auth_status",
    {
      description: "Check whether the connector is authenticated with IntakeQ",
    },
    async () => {
      const result = await verifyApiKey();

      await appendAuditLog({
        tool: "auth_status",
        args: {},
        outcome: result.valid ? "success" : "error",
        ...(result.valid ? {} : { error_message: result.detail }),
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            connected: result.valid,
            detail: result.detail,
            practitioner_count: result.practitioner_count,
          }),
        }],
      };
    }
  );

  server.registerTool(
    "clear_api_key",
    {
      description: "Clear the stored IntakeQ API key",
    },
    async () => {
      getSessionContext()?.clearApiKey();
      await clearApiKey();

      await appendAuditLog({
        tool: "clear_api_key",
        args: {},
        outcome: "success",
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ cleared: true }),
        }],
      };
    }
  );
}
