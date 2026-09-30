import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

const clientId = "9d2ed8af-07ba-4c18-916d-b0caf22a2766";

function createEnv(overrides: Record<string, unknown> = {}) {
  const assets = Object.assign(vi.fn(), {
    fetch: vi.fn().mockResolvedValue(new Response("asset")),
    connect: vi.fn(),
  }) as Fetcher;

  return {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-3-flash-preview",
    AI_RATE_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    } as RateLimit,
    ASSETS: assets,
    ...overrides,
  };
}

function createRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://example.com",
      "Sec-Fetch-Site": "same-origin",
      "X-Client-Id": clientId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function callWorker(request: Request, env = createEnv()): Promise<Response> {
  return worker.fetch(
    request as Parameters<typeof worker.fetch>[0],
    env as Parameters<typeof worker.fetch>[1],
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuickBill Worker API", () => {
  it("rejects cross-origin requests", async () => {
    const response = await callWorker(createRequest(
      "/api/analyze-structure",
      { base64Data: "abc", mimeType: "application/pdf" },
      { Origin: "https://attacker.example" },
    ));

    expect(response.status).toBe(403);
  });

  it("enforces the per-client rate limit", async () => {
    const response = await callWorker(
      createRequest("/api/analyze-structure", {
        base64Data: "abc",
        mimeType: "application/pdf",
      }),
      createEnv({
        AI_RATE_LIMITER: {
          limit: vi.fn().mockResolvedValue({ success: false }),
        } as RateLimit,
      }),
    );

    expect(response.status).toBe(429);
  });

  it("rejects unsupported file types", async () => {
    const response = await callWorker(createRequest("/api/analyze-structure", {
      base64Data: "abc",
      mimeType: "text/plain",
    }));

    expect(response.status).toBe(400);
  });

  it("returns structured analysis data", async () => {
    const geminiFetch = vi.fn().mockResolvedValue(Response.json({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({
            headers: ["品名", "數量", "小計"],
            suggestedMapping: {
              name: "品名",
              quantity: "數量",
              unitPrice: null,
              subtotal: "小計",
            },
          }) }],
        },
      }],
    }));
    vi.stubGlobal("fetch", geminiFetch);

    const response = await callWorker(createRequest("/api/analyze-structure", {
      base64Data: "abc",
      mimeType: "application/pdf",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { headers: ["品名", "數量", "小計"] },
    });
  });

  it("requires a complete mapping for extraction", async () => {
    const response = await callWorker(createRequest("/api/extract-billing", {
      base64Data: "abc",
      mimeType: "application/pdf",
      mapping: { name: "品名" },
    }));

    expect(response.status).toBe(400);
  });
});
