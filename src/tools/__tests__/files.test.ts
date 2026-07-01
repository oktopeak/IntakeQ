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

import { registerFileTools } from "../files.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerFileTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_FILES = [
  { Id: "file-1", FileName: "consent.pdf", DateCreated: "2026-01-01", Size: 12345, ContentType: "application/pdf", FolderId: null },
  { Id: "file-2", FileName: "photo.jpg", DateCreated: "2026-01-02", Size: 54321, ContentType: "image/jpeg", FolderId: "folder-1" },
];

describe("list_files", () => {
  it("happy path — calls /files with clientId and returns metadata", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_FILES);
    const result = await handlers["list_files"]({ clientId: "42" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/files", { clientId: "42" });
    expect(result.content[0].text).toContain("consent.pdf");
    expect(result.content[0].text).toContain("photo.jpg");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_files", outcome: "success", client_id: "42", result_count: 2 })
    );
  });

  it("happy path — result_count reflects array length", async () => {
    mockIntakeGet.mockResolvedValue([MOCK_FILES[0]]);
    await handlers["list_files"]({ clientId: "99" });
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result_count: 1, client_id: "99" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_files"]({ clientId: "42" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", client_id: "42" })
    );
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("forbidden"));
    const result = await handlers["list_files"]({ clientId: "42" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error:/);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_files", outcome: "error", error_message: "forbidden", client_id: "42" })
    );
  });
});
