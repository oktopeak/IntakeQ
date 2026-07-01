#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function main() {
  const mode = (process.env.TRANSPORT ?? "stdio").toLowerCase();

  if (mode === "stdio") {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { registerAuthTools } = await import("./auth/authTools.js");
    const { registerClientTools } = await import("./tools/clients.js");
    const { registerPractitionerTools } = await import("./tools/practitioners.js");
    const { registerAppointmentTools } = await import("./tools/appointments.js");
    const { registerIntakeFormTools } = await import("./tools/intakeForms.js");
    const { registerNoteTools } = await import("./tools/notes.js");
    const { registerInvoiceTools } = await import("./tools/invoices.js");
    const { registerFileTools } = await import("./tools/files.js");
    const { registerAuditExportTool } = await import("./tools/auditExport.js");
    const { registerResources } = await import("./resources/index.js");

    // No INTAKEQ_API_KEY validation at startup — user may set it via set_api_key tool
    const server = new McpServer({ name: "intakeq-mcp", version: pkg.version });
    registerAuthTools(server);
    registerClientTools(server);
    registerPractitionerTools(server);
    registerAppointmentTools(server);
    registerIntakeFormTools(server);
    registerNoteTools(server);
    registerInvoiceTools(server);
    registerFileTools(server);
    registerAuditExportTool(server);
    registerResources(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("IntakeQ MCP server running on stdio");
  } else {
    const { startHttpServer } = await import("./server/http.js");
    await startHttpServer();
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
