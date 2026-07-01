import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../sessionContext.js", () => ({
  getSessionContext: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../auth/keyStorage.js", () => ({
  loadApiKey: vi.fn().mockResolvedValue(null),
}));

import { intakeGet, intakePost, intakePut, IntakeApiError, getIntakeBaseUrl } from "../intakeClient.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("intakeClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.INTAKEQ_API_KEY = "test-key";
    delete process.env.INTAKEQ_API_BASE;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  describe("getIntakeBaseUrl", () => {
    it("defaults to the IntakeQ production base URL", () => {
      expect(getIntakeBaseUrl()).toBe("https://intakeq.com/api/v1");
    });

    it("honors INTAKEQ_API_BASE override, stripping a trailing slash", () => {
      process.env.INTAKEQ_API_BASE = "https://staging.example.com/api/v1/";
      expect(getIntakeBaseUrl()).toBe("https://staging.example.com/api/v1");
    });
  });

  describe("intakeGet", () => {
    it("sends the X-Auth-Key header and serializes query params", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await intakeGet("/clients", { page: 1, search: "Jane" });

      expect(result).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://intakeq.com/api/v1/clients?page=1&search=Jane");
      expect(init.headers).toMatchObject({ "X-Auth-Key": "test-key", "Content-Type": "application/json" });
    });

    it("throws IntakeApiError with the parsed message on a non-429 error status", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Client not found" }), { status: 404 })
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        await intakeGet("/clients/999");
        expect.unreachable("intakeGet should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IntakeApiError);
        expect((err as IntakeApiError).statusCode).toBe(404);
        expect((err as Error).message).toContain("Client not found");
      }
    });

    it("falls back to the raw response text when the error body is not JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(intakeGet("/clients")).rejects.toThrow(/Internal Server Error/);
    });

    it("retries on 429, honoring the Retry-After header, then succeeds", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "5" } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      const promise = intakeGet("/clients");
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting retries on sustained 429s", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);

      const promise = intakeGet("/clients");
      const assertion = expect(promise).rejects.toThrow(/rate limit exceeded/i);
      await vi.advanceTimersByTimeAsync(10000);
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("intakePost", () => {
    it("sends a JSON body via POST and returns the parsed response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "1" }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await intakePost("/appointments", { ClientId: "1" });

      expect(result).toEqual({ id: "1" });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ ClientId: "1" }));
    });
  });

  describe("intakePut", () => {
    it("returns the parsed JSON when the response body is non-empty", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await intakePut("/appointments/1", { Status: "Confirmed" });
      expect(result).toEqual({ updated: true });
    });

    it("returns an empty object when the response body is empty", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await intakePut("/appointments/1", {});
      expect(result).toEqual({});
    });
  });
});
