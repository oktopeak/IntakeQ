import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockIntakeGet, mockIntakePost, mockIntakePut, mockAppendAuditLog } = vi.hoisted(() => ({
  mockIntakeGet: vi.fn(),
  mockIntakePost: vi.fn(),
  mockIntakePut: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/intakeClient.js", () => ({
  intakeGet: mockIntakeGet,
  intakePost: mockIntakePost,
  intakePut: mockIntakePut,
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

import { registerAppointmentTools } from "../appointments.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerAppointmentTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_APPOINTMENT = { Id: "appt-1", Status: "Confirmed", ClientId: 10 };

describe("list_appointments", () => {
  it("happy path — fetches with clientId filter", async () => {
    mockIntakeGet.mockResolvedValue([MOCK_APPOINTMENT]);
    const result = await handlers["list_appointments"]({ clientId: "10", page: 1 }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/appointments", expect.objectContaining({ client: "10" }));
    expect(result.content[0].text).toContain("appt-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_appointments", outcome: "success", result_count: 1 })
    );
  });

  it("happy path — fetches with startDate and endDate", async () => {
    mockIntakeGet.mockResolvedValue([MOCK_APPOINTMENT]);
    await handlers["list_appointments"]({ startDate: "2026-01-01", endDate: "2026-01-31", page: 1 });
    expect(mockIntakeGet).toHaveBeenCalledWith("/appointments", expect.objectContaining({ startDate: "2026-01-01", endDate: "2026-01-31" }));
  });

  it("validation — returns error when none of clientId/startDate/endDate provided", async () => {
    const result = await handlers["list_appointments"]({ page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/At least one of/);
    expect(mockIntakeGet).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_appointments", outcome: "error", error_message: "At least one of clientId, startDate, or endDate is required" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_appointments"]({ clientId: "10", page: 1 }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("server error"));
    const result = await handlers["list_appointments"]({ startDate: "2026-01-01", page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "server error" }));
  });
});

describe("get_appointment", () => {
  it("happy path — fetches appointment by ID", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_APPOINTMENT);
    const result = await handlers["get_appointment"]({ appointment_id: "appt-1" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/appointments/appt-1");
    expect(result.content[0].text).toContain("appt-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["get_appointment"]({ appointment_id: "missing" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("timeout"));
    const result = await handlers["get_appointment"]({ appointment_id: "appt-1" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
});

describe("create_appointment", () => {
  const CREATE_ARGS = {
    PractitionerId: "prac-1",
    ClientId: 10,
    ServiceId: "svc-1",
    LocationId: "loc-1",
    Status: "Confirmed",
    UtcDateTime: 1700000000000,
    SendClientEmailNotification: true,
    ReminderType: "Email",
  };

  it("happy path — posts to /appointments with all required fields", async () => {
    mockIntakePost.mockResolvedValue({ Id: "new-appt" });
    const result = await handlers["create_appointment"](CREATE_ARGS) as any;
    expect(mockIntakePost).toHaveBeenCalledWith("/appointments", expect.objectContaining({
      PractitionerId: "prac-1",
      ClientId: 10,
      ServiceId: "svc-1",
    }));
    expect(result.content[0].text).toContain("new-appt");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", client_id: "10" }));
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakePost.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["create_appointment"](CREATE_ARGS) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakePost.mockRejectedValue(new Error("bad request"));
    const result = await handlers["create_appointment"](CREATE_ARGS) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "bad request" }));
  });
});

describe("update_appointment", () => {
  const UPDATE_ARGS = { Id: "appt-1", UtcDateTime: 1700000000000 };

  it("happy path — puts to /appointments with Id and UtcDateTime", async () => {
    mockIntakePut.mockResolvedValue({ Id: "appt-1", Status: "Confirmed" });
    const result = await handlers["update_appointment"](UPDATE_ARGS) as any;
    expect(mockIntakePut).toHaveBeenCalledWith("/appointments", expect.objectContaining({ Id: "appt-1", UtcDateTime: 1700000000000 }));
    expect(result.content[0].text).toContain("appt-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("happy path — optional fields are included when provided", async () => {
    mockIntakePut.mockResolvedValue({});
    await handlers["update_appointment"]({ ...UPDATE_ARGS, Status: "Cancelled", ServiceId: "svc-2" });
    expect(mockIntakePut).toHaveBeenCalledWith("/appointments", expect.objectContaining({ Status: "Cancelled", ServiceId: "svc-2" }));
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakePut.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["update_appointment"](UPDATE_ARGS) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakePut.mockRejectedValue(new Error("conflict"));
    const result = await handlers["update_appointment"](UPDATE_ARGS) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "conflict" }));
  });
});
