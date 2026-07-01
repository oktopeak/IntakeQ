import { vi, describe, it, expect, beforeEach } from "vitest";

const { MockEntry, mockGetPassword, mockSetPassword } = vi.hoisted(() => {
  const mockGetPassword = vi.fn();
  const mockSetPassword = vi.fn();
  const MockEntry = vi.fn().mockImplementation(function () {
    return { getPassword: mockGetPassword, setPassword: mockSetPassword };
  });
  return { MockEntry, mockGetPassword, mockSetPassword };
});

vi.mock("@napi-rs/keyring", () => ({ Entry: MockEntry }));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

// Imports resolved after mocks are registered
import fs from "fs/promises";
import { getEncryptionKey, saveApiKey, loadApiKey, clearApiKey } from "../keyStorage.js";

const mockMkdir = vi.mocked(fs.mkdir);
const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockUnlink = vi.mocked(fs.unlink);

const VALID_KEY_HEX = "ab".repeat(32); // 64 hex chars = 32 bytes
const ENOENT = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });

// Helper: make MockEntry throw on construction (simulates "keychain unavailable")
function makeKeychainUnavailable() {
  MockEntry.mockImplementationOnce(function () {
    throw new Error("keychain unavailable");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default Entry implementation after clearAllMocks resets mockImplementation
  MockEntry.mockImplementation(function () {
    return { getPassword: mockGetPassword, setPassword: mockSetPassword };
  });
  // Restore default fs/promises mock implementations
  mockMkdir.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue("" as any);
  mockWriteFile.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

// ─── Tier 1: OS keychain ─────────────────────────────────────────────────────

describe("Tier 1 — OS keychain", () => {
  it("returns existing key from keychain without generating a new one", async () => {
    mockGetPassword.mockReturnValue(VALID_KEY_HEX);
    const key = await getEncryptionKey();
    expect(mockSetPassword).not.toHaveBeenCalled();
    expect(key).toEqual(Buffer.from(VALID_KEY_HEX, "hex"));
  });

  it("generates and saves a new key when keychain entry is empty", async () => {
    mockGetPassword.mockReturnValue(null);
    const key = await getEncryptionKey();
    expect(mockSetPassword).toHaveBeenCalledOnce();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });
});

// ─── Tier 2: File fallback ───────────────────────────────────────────────────

describe("Tier 2 — file fallback", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("creates directory with mode 0o700 before accessing key file", async () => {
    makeKeychainUnavailable();
    mockReadFile.mockResolvedValue(VALID_KEY_HEX as any);
    await getEncryptionKey();
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining(".intakeq-mcp"),
      { recursive: true, mode: 0o700 },
    );
  });

  it("reads and returns an existing enc-key.hex file", async () => {
    makeKeychainUnavailable();
    mockReadFile.mockResolvedValue(VALID_KEY_HEX as any);
    const key = await getEncryptionKey();
    expect(key).toEqual(Buffer.from(VALID_KEY_HEX, "hex"));
  });

  it("generates and writes a new enc-key.hex with mode 0o600 when none exists", async () => {
    makeKeychainUnavailable();
    mockReadFile.mockRejectedValueOnce(ENOENT);
    const key = await getEncryptionKey();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("enc-key.hex"),
      expect.any(String),
      { mode: 0o600 },
    );
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });
});

// ─── saveApiKey / loadApiKey round-trip ──────────────────────────────────────

describe("saveApiKey → loadApiKey round-trip", () => {
  it("decrypted value matches the original API key", async () => {
    mockGetPassword.mockReturnValue(VALID_KEY_HEX);

    // Capture what saveApiKey writes to disk
    let savedBuffer: Buffer | undefined;
    mockWriteFile.mockImplementation(async (_path: any, data: any, _opts: any) => {
      if (Buffer.isBuffer(data)) {
        savedBuffer = data;
      }
    });

    const originalKey = "test-api-key-12345";
    await saveApiKey(originalKey);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("api-key.enc"),
      expect.any(Buffer),
      { mode: 0o600 },
    );
    expect(savedBuffer).toBeDefined();

    // Replay the saved buffer on readFile so loadApiKey can decrypt it
    mockReadFile.mockResolvedValueOnce(savedBuffer as any);

    const loaded = await loadApiKey();
    expect(loaded).toBe(originalKey);
  });
});

// ─── clearApiKey ─────────────────────────────────────────────────────────────

describe("clearApiKey", () => {
  it("calls unlink on the API key file", async () => {
    await clearApiKey();
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining("api-key.enc"));
  });

  it("silently swallows ENOENT when file does not exist", async () => {
    mockUnlink.mockRejectedValueOnce(ENOENT);
    await expect(clearApiKey()).resolves.toBeUndefined();
  });

  it("rethrows non-ENOENT errors", async () => {
    const permErr = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    mockUnlink.mockRejectedValueOnce(permErr);
    await expect(clearApiKey()).rejects.toThrow("EPERM");
  });
});

// ─── Corrupt / tampered enc file ─────────────────────────────────────────────

describe("loadApiKey — corrupt or tampered file", () => {
  it("returns null without throwing when decryption fails", async () => {
    mockGetPassword.mockReturnValue(VALID_KEY_HEX);

    // Provide garbage data that will fail AES-GCM auth tag verification
    const garbage = Buffer.alloc(64, 0xff);
    mockReadFile.mockResolvedValueOnce(garbage as any);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadApiKey();
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("decryption failed"));
  });
});
