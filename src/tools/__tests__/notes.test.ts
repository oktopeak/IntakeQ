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

import { registerNoteTools } from "../notes.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerNoteTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_NOTES_SUMMARY = [{ Id: "note-1", ClientId: "42", Status: "Completed" }];
const MOCK_NOTE = { Id: "note-1", ClientId: "42", Content: "Clinical note content" };

describe("list_notes", () => {
  it("happy path — calls /notes/summary and audit-logs PHI access", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_NOTES_SUMMARY);
    const result = await handlers["list_notes"]({ clientId: "42", page: 1 }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/notes/summary", expect.objectContaining({ clientId: "42", page: 1 }));
    expect(result.content[0].text).toContain("note-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_notes", outcome: "success", client_id: "42", result_count: 1 })
    );
  });

  it("happy path — passes all filters when provided", async () => {
    mockIntakeGet.mockResolvedValue([]);
    await handlers["list_notes"]({ status: "Completed", startDate: "2026-01-01", endDate: "2026-01-31", page: 1 });
    expect(mockIntakeGet).toHaveBeenCalledWith("/notes/summary", expect.objectContaining({
      status: "Completed",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    }));
  });

  it("validation — returns error when no filter is provided", async () => {
    const result = await handlers["list_notes"]({ page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/At least one of clientId/);
    expect(mockIntakeGet).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_notes", outcome: "error", error_message: "At least one of clientId, client, startDate, or endDate is required" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_notes"]({ clientId: "42", page: 1 }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("network failure"));
    const result = await handlers["list_notes"]({ clientId: "42", page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_notes", outcome: "error", error_message: "network failure" })
    );
  });
});

describe("get_note", () => {
  it("happy path — calls /notes/{id} and audit-logs PHI access", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_NOTE);
    const result = await handlers["get_note"]({ note_id: "note-1" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/notes/note-1");
    expect(result.content[0].text).toContain("note-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_note", outcome: "success" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["get_note"]({ note_id: "missing" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("timeout"));
    const result = await handlers["get_note"]({ note_id: "note-1" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_note", outcome: "error", error_message: "timeout" })
    );
  });
});
