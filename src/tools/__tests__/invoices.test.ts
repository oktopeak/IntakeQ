import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockIntakeGet, mockAppendAuditLog } = vi.hoisted(() => ({
  mockIntakeGet: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/intakeClient.js", () => ({
  intakeGet: mockIntakeGet,
  intakePost: vi.fn(),
  intakePut: vi.fn(),
  IntakeApiError: class IntakeApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = "IntakeApiError";
    }
  },
}));

vi.mock("../../utils/auditLog.js", () => ({ appendAuditLog: mockAppendAuditLog }));

import { registerInvoiceTools } from "../invoices.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerInvoiceTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_INVOICES = [{ Id: "inv-1", ClientId: "42", Status: "Draft", Total: 150.0 }];
const MOCK_INVOICE = { Id: "inv-1", ClientId: "42", Status: "Draft", Total: 150.0, Items: [] };

describe("list_invoices", () => {
  it("happy path — calls /invoices with filters and returns data", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_INVOICES);
    const result = await handlers["list_invoices"]({ clientId: "42", page: 1 }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/invoices", expect.objectContaining({ clientId: "42", page: 1 }));
    expect(result.content[0].text).toContain("inv-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_invoices", outcome: "success", client_id: "42", result_count: 1 })
    );
  });

  it("happy path — passes date and status filters", async () => {
    mockIntakeGet.mockResolvedValue([]);
    await handlers["list_invoices"]({ startDate: "2026-01-01", endDate: "2026-01-31", status: "Paid", page: 1 });
    expect(mockIntakeGet).toHaveBeenCalledWith("/invoices", expect.objectContaining({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      status: "Paid",
    }));
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_invoices"]({ page: 1 }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("server error"));
    const result = await handlers["list_invoices"]({ page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_invoices", outcome: "error", error_message: "server error" })
    );
  });
});

describe("get_invoice", () => {
  it("happy path — calls /invoices/{id} and returns invoice", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_INVOICE);
    const result = await handlers["get_invoice"]({ invoice_id: "inv-1" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/invoices/inv-1");
    expect(result.content[0].text).toContain("inv-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_invoice", outcome: "success" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["get_invoice"]({ invoice_id: "missing" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("unauthorized"));
    const result = await handlers["get_invoice"]({ invoice_id: "inv-1" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_invoice", outcome: "error", error_message: "unauthorized" })
    );
  });
});
