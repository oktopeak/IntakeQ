import { getSessionContext } from "./sessionContext.js";
import { loadApiKey } from "../auth/keyStorage.js";

async function resolveApiKey(): Promise<string> {
  const ctx = getSessionContext();
  if (ctx) {
    // HTTP mode: session-scoped auth. Do not fall through to the shared disk
    // file — that would leak one session's persisted key to another session.
    const key = ctx.getApiKey();
    if (key) return key;
    const envKey = process.env.INTAKEQ_API_KEY;
    if (envKey) return envKey;
    throw new Error("IntakeQ API key not set for this session. Use the set_api_key tool.");
  }
  // stdio mode: env var → disk → throw
  const envKey = process.env.INTAKEQ_API_KEY;
  if (envKey) return envKey;
  const stored = await loadApiKey();
  if (stored) return stored;
  throw new Error("IntakeQ API key not set. Use the set_api_key tool.");
}

export class IntakeApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "IntakeApiError";
  }
}

export function getIntakeBaseUrl(): string {
  return process.env.INTAKEQ_API_BASE?.replace(/\/$/, "") ?? "https://intakeq.com/api/v1";
}

// Fixed-delay (not jittered/exponential) backoff, intentionally simple: this
// is a single-tenant local server making one IntakeQ call at a time, so there's
// no thundering-herd risk to justify jitter. Thresholds are hardcoded to
// IntakeQ's documented limits rather than env-configurable, since they reflect
// the vendor's actual API limits, not a deployment choice.
const RETRY_DELAYS_MS = [10000, 20000, 30000]; // IntakeQ: 10 req/min limit

async function intakeFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, init);

    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining !== null && parseInt(remaining) < 5)
      console.error(`[rate-limit] Warning: only ${remaining} requests remaining`);

    if (res.status === 429) {
      if (attempt < RETRY_DELAYS_MS.length) {
        const retryAfter = res.headers.get("Retry-After");
        const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
        const delay = Number.isFinite(parsed) ? parsed * 1000 : RETRY_DELAYS_MS[attempt];
        const limitKind = Number.isFinite(parsed) && parsed > 60 ? "daily" : "per-minute";
        console.error(`[rate-limit] 429 received (${limitKind} limit), retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        res.body?.cancel().catch(() => {});
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const retryAfter = res.headers.get("Retry-After");
      const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
      const limitKind = Number.isFinite(parsed) && parsed > 60 ? "daily (500 req/day)" : "per-minute (10 req/min)";
      throw new Error(`IntakeQ rate limit exceeded after 3 retries (${limitKind} limit hit).`);
    }

    if (!res.ok) {
      let msg: string;
      try {
        const text = await res.text();
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          msg = (typeof json.message === "string" ? json.message : null)
             ?? (typeof json.error === "string" ? json.error : null)
             ?? JSON.stringify(json);
        } catch {
          msg = text;
        }
      } catch {
        msg = "(could not read response body)";
      }
      throw new IntakeApiError(res.status, `IntakeQ API error ${res.status} on ${url}: ${msg}`);
    }

    return res;
  }
  throw new Error("IntakeQ API: unexpected retry loop exit");
}

export async function intakeGet(
  path: string,
  params?: Record<string, string | number | boolean>
): Promise<unknown> {
  const apiKey = await resolveApiKey();
  const url = new URL(`${getIntakeBaseUrl()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }
  const res = await intakeFetch(url.toString(), {
    headers: { "X-Auth-Key": apiKey, "Content-Type": "application/json" },
  });
  return res.json();
}

export async function intakePost(path: string, body: unknown): Promise<unknown> {
  const apiKey = await resolveApiKey();
  const url = new URL(`${getIntakeBaseUrl()}${path}`);
  const res = await intakeFetch(url.toString(), {
    method: "POST",
    headers: { "X-Auth-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function intakePut(path: string, body: unknown): Promise<unknown> {
  const apiKey = await resolveApiKey();
  const url = new URL(`${getIntakeBaseUrl()}${path}`);
  const res = await intakeFetch(url.toString(), {
    method: "PUT",
    headers: { "X-Auth-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : {};
}
