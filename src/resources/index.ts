import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyApiKey } from "../auth/apiKeyAuth.js";

export function registerResources(server: McpServer): void {
  server.registerResource(
    "compliance-notice",
    "intakeq://compliance-notice",
    {
      title: "IntakeQ HIPAA Compliance Notice",
      description: "Explains what the connector does, what it logs, and the BAA requirement",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: `IntakeQ MCP Connector — HIPAA Compliance Notice

This connector gives Claude read and limited write access to your IntakeQ/PracticeQ account.

Every interaction — including PHI retrieved and actions taken — is logged to an append-only audit file on this machine (~/.intakeq-mcp/audit.log) in compliance with HIPAA §164.312(b) (Audit Controls). The audit log can be exported at any time using the audit_export tool.

This connector stores no PHI content (form answers, notes, clinical data). It brokers authenticated API calls to IntakeQ and logs an access trail of identifiers and metadata required by §164.312(b).

Before connecting to real patient data:
1. IntakeQ/PracticeQ includes a BAA — sign it via Settings before going live.
2. Anthropic enterprise tier is required: obtain a BAA + Zero Data Retention agreement.
   With hosted Claude + MCP, PHI goes to Anthropic for inference. The defensible posture
   is training-disabled + ZDR under enterprise + BAA, not data locality.
3. The connector stores no PHI content; the access trail logged locally contains only identifiers and metadata required by §164.312(b).`,
      }],
    })
  );

  server.registerResource(
    "auth-status",
    "intakeq://auth-status",
    {
      title: "IntakeQ Auth Status",
      description: "Live authentication status — whether an API key is stored and verified",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = await verifyApiKey();
      const payload = {
        authenticated: result.valid,
        detail: result.detail,
      };
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
