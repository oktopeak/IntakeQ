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

import { registerClientTools } from "../clients.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerClientTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

describe("list_clients", () => {
  it("happy path — calls intakeGet with page and returns data", async () => {
    const mockData = [{ Id: "1", Name: "John Doe" }];
    mockIntakeGet.mockResolvedValue(mockData);

    const result = await handlers["list_clients"]({ page: 1 }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/clients", expect.objectContaining({ page: 1 }));
    expect(result.content[0].text).toContain("John Doe");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_clients", outcome: "success", result_count: 1 })
    );
  });

  it("happy path — passes search param when provided", async () => {
    mockIntakeGet.mockResolvedValue([]);
    await handlers["list_clients"]({ search: "Jane", page: 1 });
    expect(mockIntakeGet).toHaveBeenCalledWith("/clients", expect.objectContaining({ search: "Jane", page: 1 }));
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));

    const result = await handlers["list_clients"]({ page: 1 }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_clients", outcome: "success" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("network failure"));

    const result = await handlers["list_clients"]({ page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_clients", outcome: "error", error_message: "network failure" })
    );
  });
});

describe("get_client", () => {
  it("happy path — calls intakeGet with search and includeProfile", async () => {
    const mockData = [{ Id: "42", Name: "Jane Smith" }];
    mockIntakeGet.mockResolvedValue(mockData);

    const result = await handlers["get_client"]({ client_id: "42" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/clients", { search: "42", includeProfile: true });
    expect(result.content[0].text).toContain("Jane Smith");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_client", outcome: "success", client_id: "42" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));

    const result = await handlers["get_client"]({ client_id: "99" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_client", outcome: "success", client_id: "99" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("timeout"));

    const result = await handlers["get_client"]({ client_id: "42" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_client", outcome: "error", error_message: "timeout" })
    );
  });
});
