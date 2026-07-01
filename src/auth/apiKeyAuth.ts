import { intakeGet, IntakeApiError } from "../utils/intakeClient.js";

export interface VerifyResult {
  valid: boolean;
  detail: string;
  practitioner_count?: number;
}

export async function verifyApiKey(): Promise<VerifyResult> {
  try {
    const data = await intakeGet("/practitioners");
    const count = Array.isArray(data) ? data.length : 0;
    return {
      valid: true,
      detail: `Connected. Found ${count} practitioner(s).`,
      practitioner_count: count,
    };
  } catch (err: unknown) {
    if (err instanceof IntakeApiError && (err.statusCode === 401 || err.statusCode === 403)) {
      return { valid: false, detail: "API key rejected (401/403)." };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, detail: message };
  }
}
