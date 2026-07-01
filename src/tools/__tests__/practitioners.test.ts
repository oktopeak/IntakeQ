import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockIntakeGet, mockAppendAuditLog } = vi.hoisted(() => ({
  mockIntakeGet: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/intakeClient.js", () => ({
  intakeGet: mockIntakeGet,
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

import { registerPractitionerTools } from "../practitioners.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerPractitionerTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_PRACTITIONER = { Id: "prac-1", Name: "Dr. Jane Smith", Email: "jane@clinic.com" };
const MOCK_SERVICE = { Id: "svc-1", Name: "Initial Consult", Duration: 60, Price: 150 };
const MOCK_LOCATION = { Id: "loc-1", Name: "Main Office" };

describe("list_practitioners", () => {
  it("happy path — calls intakeGet and returns data", async () => {
    mockIntakeGet.mockResolvedValue([MOCK_PRACTITIONER]);

    const result = await handlers["list_practitioners"]({}) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/practitioners");
    expect(result.content[0].text).toContain("Dr. Jane Smith");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_practitioners", outcome: "success", result_count: 1 })
    );
  });

  it("404 — returns 'Not found.' and logs error", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));

    const result = await handlers["list_practitioners"]({}) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_practitioners", outcome: "error" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("network failure"));

    const result = await handlers["list_practitioners"]({}) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_practitioners", outcome: "error", error_message: "network failure" })
    );
  });
});

describe("list_services", () => {
  it("happy path — calls /appointments/settings and returns Services array", async () => {
    mockIntakeGet.mockResolvedValue({ Services: [MOCK_SERVICE], Locations: [], Practitioners: [] });

    const result = await handlers["list_services"]({}) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/appointments/settings");
    expect(result.content[0].text).toContain("Initial Consult");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_services", outcome: "success", result_count: 1 })
    );
  });

  it("happy path — returns empty array when Services is missing", async () => {
    mockIntakeGet.mockResolvedValue({});

    const result = await handlers["list_services"]({}) as any;
    expect(result.content[0].text).toBe("[]");
    expect(result.isError).toBeUndefined();
  });

  it("404 — returns 'Not found.' with isError and logs error", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));

    const result = await handlers["list_services"]({}) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_services", outcome: "error" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("timeout"));

    const result = await handlers["list_services"]({}) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_services", outcome: "error", error_message: "timeout" })
    );
  });
});

describe("list_locations", () => {
  it("happy path — calls /appointments/settings and returns Locations array", async () => {
    mockIntakeGet.mockResolvedValue({ Services: [], Locations: [MOCK_LOCATION], Practitioners: [] });

    const result = await handlers["list_locations"]({}) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/appointments/settings");
    expect(result.content[0].text).toContain("Main Office");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_locations", outcome: "success", result_count: 1 })
    );
  });

  it("happy path — returns empty array when Locations is missing", async () => {
    mockIntakeGet.mockResolvedValue({});

    const result = await handlers["list_locations"]({}) as any;
    expect(result.content[0].text).toBe("[]");
    expect(result.isError).toBeUndefined();
  });

  it("404 — returns 'Not found.' with isError and logs error", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));

    const result = await handlers["list_locations"]({}) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_locations", outcome: "error" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("server error"));

    const result = await handlers["list_locations"]({}) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_locations", outcome: "error", error_message: "server error" })
    );
  });
});
