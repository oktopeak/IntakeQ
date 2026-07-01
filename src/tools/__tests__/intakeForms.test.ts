import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const { mockIntakeGet, mockIntakePost, mockAppendAuditLog } = vi.hoisted(() => ({
  mockIntakeGet: vi.fn(),
  mockIntakePost: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/intakeClient.js", () => ({
  intakeGet: mockIntakeGet,
  intakePost: mockIntakePost,
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

import { registerIntakeFormTools } from "../intakeForms.js";

const handlers: Record<string, Function> = {};
const fakeServer = {
  registerTool: (name: string, _schema: unknown, handler: Function) => {
    handlers[name] = handler;
  },
};

beforeAll(() => {
  registerIntakeFormTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendAuditLog.mockResolvedValue(undefined);
});

const MOCK_FORM_SUMMARY = [{ Id: "form-1", Name: "New Patient Intake", Status: "Submitted" }];
const MOCK_FORM = { Id: "form-1", ClientId: "42", Answers: [] };
const MOCK_QUESTIONNAIRES = [{ Id: "q-1", Name: "New Patient" }];

describe("list_intake_forms", () => {
  it("happy path — calls /intakes/summary and audit-logs PHI access", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_FORM_SUMMARY);
    const result = await handlers["list_intake_forms"]({ clientId: "42", page: 1 }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/intakes/summary", expect.objectContaining({ clientId: "42", page: 1 }));
    expect(result.content[0].text).toContain("form-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_intake_forms", outcome: "success", client_id: "42", result_count: 1 })
    );
  });

  it("validation — returns error when no filter is provided", async () => {
    const result = await handlers["list_intake_forms"]({ page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/At least one of clientId/);
    expect(mockIntakeGet).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_intake_forms", outcome: "error", error_message: "At least one of clientId, client, startDate, or endDate is required" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_intake_forms"]({ clientId: "42", page: 1 }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("server error"));
    const result = await handlers["list_intake_forms"]({ clientId: "42", page: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "server error" }));
  });
});

describe("get_form", () => {
  it("happy path — calls /intakes/{id} and audit-logs PHI access", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_FORM);
    const result = await handlers["get_form"]({ form_id: "form-1" }) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/intakes/form-1");
    expect(result.content[0].text).toContain("form-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_form", outcome: "success" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["get_form"]({ form_id: "missing" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("timeout"));
    const result = await handlers["get_form"]({ form_id: "form-1" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "timeout" }));
  });
});

describe("list_questionnaire_templates", () => {
  it("happy path — calls /questionnaires and returns templates", async () => {
    mockIntakeGet.mockResolvedValue(MOCK_QUESTIONNAIRES);
    const result = await handlers["list_questionnaire_templates"]({}) as any;
    expect(mockIntakeGet).toHaveBeenCalledWith("/questionnaires");
    expect(result.content[0].text).toContain("q-1");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "list_questionnaire_templates", outcome: "success", result_count: 1 })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakeGet.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["list_questionnaire_templates"]({}) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakeGet.mockRejectedValue(new Error("network failure"));
    const result = await handlers["list_questionnaire_templates"]({}) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
});

describe("send_intake_form", () => {
  it("happy path — posts to /intakes/send with ClientId", async () => {
    mockIntakePost.mockResolvedValue({ success: true });
    const result = await handlers["send_intake_form"]({ QuestionnaireId: "q-1", ClientId: "42" }) as any;
    expect(mockIntakePost).toHaveBeenCalledWith("/intakes/send", expect.objectContaining({ QuestionnaireId: "q-1", ClientId: "42" }));
    expect(result.content[0].text).toContain("success");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "send_intake_form", outcome: "success", client_id: "42" })
    );
  });

  it("happy path — posts with ClientName and ClientEmail when no ClientId", async () => {
    mockIntakePost.mockResolvedValue({ success: true });
    await handlers["send_intake_form"]({ QuestionnaireId: "q-1", ClientName: "Jane Doe", ClientEmail: "jane@example.com" });
    expect(mockIntakePost).toHaveBeenCalledWith("/intakes/send", expect.objectContaining({ ClientName: "Jane Doe", ClientEmail: "jane@example.com" }));
  });

  it("validation — returns error when ClientId and ClientName/ClientEmail are both missing", async () => {
    const result = await handlers["send_intake_form"]({ QuestionnaireId: "q-1" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/ClientId or both ClientName and ClientEmail/);
    expect(mockIntakePost).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "send_intake_form", outcome: "error", error_message: "Missing client identification: provide ClientId or ClientName+ClientEmail" })
    );
  });

  it("404 — returns 'Not found.' and logs success", async () => {
    const { IntakeApiError } = await import("../../utils/intakeClient.js");
    mockIntakePost.mockRejectedValue(new IntakeApiError(404, "not found"));
    const result = await handlers["send_intake_form"]({ QuestionnaireId: "q-1", ClientId: "42" }) as any;
    expect(result.content[0].text).toBe("Not found.");
    expect(result.isError).toBeUndefined();
  });

  it("error path — returns isError and logs error", async () => {
    mockIntakePost.mockRejectedValue(new Error("send failed"));
    const result = await handlers["send_intake_form"]({ QuestionnaireId: "q-1", ClientId: "42" }) as any;
    expect(result.isError).toBe(true);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", error_message: "send failed" }));
  });
});
