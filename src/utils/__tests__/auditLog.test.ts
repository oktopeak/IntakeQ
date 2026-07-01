import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockReadFile, mockAppendFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockAppendFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs/promises", () => ({
  default: {
    readFile: mockReadFile,
    appendFile: mockAppendFile,
    mkdir: mockMkdir,
  },
}));

vi.mock("os", () => ({
  default: {
    homedir: () => "/tmp/test-home",
    networkInterfaces: () => ({
      eth0: [{ family: "IPv4", internal: false, address: "10.0.0.1" }],
    }),
  },
}));

vi.mock("../sessionContext.js", () => ({
  getSessionContext: vi.fn().mockReturnValue(undefined),
}));

import { readAuditLog, appendAuditLog } from "../auditLog.js";
import { getSessionContext } from "../sessionContext.js";

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: "2024-06-15T12:00:00.000Z",
    session_id: "sess-1",
    tool: "list_clients",
    args: {},
    outcome: "success",
    ...overrides,
  };
}

function toJSONL(...entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  (getSessionContext as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
});

describe("appendAuditLog", () => {
  it("writes a JSONL line with correct fields", async () => {
    await appendAuditLog({
      tool: "get_client",
      args: { client_id: "abc123" },
      outcome: "success",
      result_count: 1,
    });

    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath, data, fileOpts] = mockAppendFile.mock.calls[0];
    expect(filePath).toContain("audit.log");
    expect(fileOpts).toEqual({ encoding: "utf8", mode: 0o600 });
    const written = JSON.parse((data as string).trim());
    expect(written.tool).toBe("get_client");
    expect(written.outcome).toBe("success");
    expect(written.result_count).toBe(1);
    expect(written.timestamp).toBeDefined();
    expect(written.session_id).toBeDefined();
    expect(written.machine_ip).toBe("10.0.0.1");
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining(".intakeq-mcp"),
      { recursive: true, mode: 0o700 },
    );
  });

  it("includes intakeq_practitioner_id when provided", async () => {
    await appendAuditLog({
      tool: "get_client",
      args: {},
      outcome: "success",
      intakeq_practitioner_id: "prac-99",
    });

    const [, data] = mockAppendFile.mock.calls[0];
    const written = JSON.parse((data as string).trim());
    expect(written.intakeq_practitioner_id).toBe("prac-99");
  });

  it("redacts api_key and token keys in args", async () => {
    await appendAuditLog({
      tool: "create_intake",
      args: {
        api_key: "secret-key",
        token: "bearer-token",
        name: "John Doe",
        nested: { "x-auth-key": "hidden", safe: true },
      },
      outcome: "success",
    });

    const [, data] = mockAppendFile.mock.calls[0];
    const written = JSON.parse((data as string).trim());
    expect(written.args.api_key).toBe("[REDACTED]");
    expect(written.args.token).toBe("[REDACTED]");
    expect(written.args.name).toBe("John Doe");
    expect(written.args.nested["x-auth-key"]).toBe("[REDACTED]");
    expect(written.args.nested.safe).toBe(true);
  });

  it("swallows write errors — appendAuditLog does not throw when appendFile fails", async () => {
    mockAppendFile.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(
      appendAuditLog({ tool: "get_client", args: {}, outcome: "error" })
    ).resolves.toBeUndefined();
  });

  it("uses session_id from sessionContext when available", async () => {
    (getSessionContext as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: "http-session-42",
      getApiKey: () => null,
      storeApiKey: () => {},
      clearApiKey: () => {},
    });

    await appendAuditLog({ tool: "list_forms", args: {}, outcome: "success" });

    const [, data] = mockAppendFile.mock.calls[0];
    const written = JSON.parse((data as string).trim());
    expect(written.session_id).toBe("http-session-42");
  });
});

describe("readAuditLog", () => {
  it("returns empty result when audit file does not exist", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await readAuditLog();
    expect(result).toEqual({ entries: [], total_matched: 0, truncated: false });
  });

  it("returns empty result for empty file", async () => {
    mockReadFile.mockResolvedValue("");
    const result = await readAuditLog();
    expect(result).toEqual({ entries: [], total_matched: 0, truncated: false });
  });

  it("returns all entries when no filter is applied", async () => {
    mockReadFile.mockResolvedValue(toJSONL(makeEntry(), makeEntry(), makeEntry()));
    const result = await readAuditLog();
    expect(result.entries).toHaveLength(3);
    expect(result.total_matched).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("filters by date_from (inclusive)", async () => {
    mockReadFile.mockResolvedValue(toJSONL(
      makeEntry({ timestamp: "2024-01-01T00:00:00.000Z" }),
      makeEntry({ timestamp: "2024-06-15T00:00:00.000Z" }),
      makeEntry({ timestamp: "2025-01-01T00:00:00.000Z" }),
    ));
    const result = await readAuditLog({ date_from: "2024-06-01" });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].timestamp).toContain("2024-06-15");
    expect(result.total_matched).toBe(2);
  });

  it("filters by date_to (inclusive)", async () => {
    mockReadFile.mockResolvedValue(toJSONL(
      makeEntry({ timestamp: "2024-01-01T00:00:00.000Z" }),
      makeEntry({ timestamp: "2024-06-15T00:00:00.000Z" }),
      makeEntry({ timestamp: "2025-01-01T00:00:00.000Z" }),
    ));
    const result = await readAuditLog({ date_to: "2024-12-31" });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1].timestamp).toContain("2024-06-15");
    expect(result.total_matched).toBe(2);
  });

  it("filters by client_id (exact match)", async () => {
    mockReadFile.mockResolvedValue(toJSONL(
      makeEntry({ client_id: "client-1" }),
      makeEntry({ client_id: "client-2" }),
      makeEntry({ client_id: "client-1" }),
    ));
    const result = await readAuditLog({ client_id: "client-1" });
    expect(result.entries).toHaveLength(2);
    expect(result.total_matched).toBe(2);
  });

  it("paginates with limit", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry({ tool: `tool_${i}` }));
    mockReadFile.mockResolvedValue(toJSONL(...entries));
    const result = await readAuditLog({ limit: 2 });
    expect(result.entries).toHaveLength(2);
    expect(result.total_matched).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("paginates with offset", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry({ tool: `tool_${i}` }));
    mockReadFile.mockResolvedValue(toJSONL(...entries));
    const result = await readAuditLog({ limit: 2, offset: 2 });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].tool).toBe("tool_2");
    expect(result.total_matched).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("does not set truncated on the last page", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry({ tool: `tool_${i}` }));
    mockReadFile.mockResolvedValue(toJSONL(...entries));
    const result = await readAuditLog({ limit: 2, offset: 4 });
    expect(result.entries).toHaveLength(1);
    expect(result.total_matched).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("skips malformed JSON lines silently", async () => {
    const good = makeEntry();
    const jsonl = [JSON.stringify(good), "not valid json {{", JSON.stringify(good)].join("\n");
    mockReadFile.mockResolvedValue(jsonl);
    const result = await readAuditLog();
    expect(result.entries).toHaveLength(2);
  });

  it("includes old entries that are missing session_id without error", async () => {
    const oldEntry = { timestamp: "2024-01-01T00:00:00.000Z", tool: "list_clients", args: {}, outcome: "success" };
    mockReadFile.mockResolvedValue(JSON.stringify(oldEntry));
    const result = await readAuditLog();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].tool).toBe("list_clients");
  });
});
