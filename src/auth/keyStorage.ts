import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Entry } from "@napi-rs/keyring";

const KEY_DIR = path.join(os.homedir(), ".intakeq-mcp");
const KEY_FILE = path.join(KEY_DIR, "api-key.enc");
const ENC_KEY_FILE = path.join(KEY_DIR, "enc-key.hex");

const ALGORITHM = "aes-256-gcm";
const KEYCHAIN_SERVICE = "intakeq-mcp";
const KEYCHAIN_ACCOUNT = "encryption-key";

export async function getEncryptionKey(): Promise<Buffer> {
  // 1. OS keychain (macOS / Windows Credential Manager / desktop Linux)
  try {
    const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    let keyHex = entry.getPassword();
    if (!keyHex) {
      keyHex = crypto.randomBytes(32).toString("hex");
      entry.setPassword(keyHex);
      console.error("[keyStorage] Generated encryption key and saved to OS keychain.");
    }
    return Buffer.from(keyHex, "hex");
  } catch (keychainErr: any) {
    console.error(`[keyStorage] Keychain unavailable (${keychainErr.message}), using file fallback.`);
  }

  // 2. File fallback: ~/.intakeq-mcp/enc-key.hex (mode 0600) — WSL2 / headless Linux
  await fs.mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
  try {
    return Buffer.from((await fs.readFile(ENC_KEY_FILE, "utf8")).trim(), "hex");
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
  const keyHex = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(ENC_KEY_FILE, keyHex, { mode: 0o600 });
  console.error("[keyStorage] OS keychain unavailable. Generated encryption key at ~/.intakeq-mcp/enc-key.hex (mode 0600).");
  return Buffer.from(keyHex, "hex");
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await fs.mkdir(KEY_DIR, { recursive: true, mode: 0o700 });

  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  await fs.writeFile(KEY_FILE, combined, { mode: 0o600 });
}

export async function loadApiKey(): Promise<string | null> {
  let combined: Buffer;
  try {
    combined = await fs.readFile(KEY_FILE);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  try {
    const key = await getEncryptionKey();
    const iv = combined.subarray(0, 16);
    const authTag = combined.subarray(16, 32);
    const encrypted = combined.subarray(32);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err: any) {
    console.error(
      `[keyStorage] WARNING: API key file exists but decryption failed. ` +
      `Detail: ${err.message}`
    );
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    await fs.unlink(KEY_FILE);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err; // ENOENT = already gone, that's fine
  }
}
