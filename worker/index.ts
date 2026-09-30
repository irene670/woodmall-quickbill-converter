import type { HeaderMapping } from "../types";

const MAX_BASE64_LENGTH = 15_000_000;
const CLIENT_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

interface Env {
  ASSETS: Fetcher;
  AI_RATE_LIMITER: RateLimit;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

type ApiRequest = {
  base64Data?: unknown;
  mimeType?: unknown;
  mapping?: unknown;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

const analysisSchema = {
  type: "OBJECT",
  properties: {
    headers: {
      type: "ARRAY",
      description: "List of all column headers found in the document table",
      items: { type: "STRING" },
    },
    suggestedMapping: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", nullable: true },
        quantity: { type: "STRING", nullable: true },
        unitPrice: { type: "STRING", nullable: true },
        subtotal: { type: "STRING", nullable: true },
      },
      required: ["name", "quantity", "unitPrice", "subtotal"],
    },
  },
  required: ["headers", "suggestedMapping"],
};

const billingSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Product or service name" },
          quantity: { type: "NUMBER", description: "Quantity" },
          unitPrice: { type: "NUMBER", description: "Unit price exactly as shown" },
          subtotal: { type: "NUMBER", description: "Line subtotal exactly as shown" },
        },
        required: ["name", "quantity", "unitPrice", "subtotal"],
      },
    },
  },
  required: ["items"],
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const expectedOrigin = new URL(request.url).origin;

  return (!origin || origin === expectedOrigin)
    && (!fetchSite || fetchSite === "same-origin");
}

function isHeaderMapping(value: unknown): value is HeaderMapping {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["name", "quantity", "unitPrice", "subtotal"].every((key) =>
    record[key] === null || typeof record[key] === "string"
  );
}

async function readRequest(request: Request, env: Env): Promise<ApiRequest | Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return json({ error: "不允許的請求來源。" }, 403);
  }

  const clientId = request.headers.get("X-Client-Id") || "";
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return json({ error: "瀏覽器識別資訊無效，請重新整理頁面。" }, 400);
  }

  const { success } = await env.AI_RATE_LIMITER.limit({ key: clientId });
  if (!success) {
    return json({ error: "AI 處理次數過多，請稍候一分鐘再試。" }, 429);
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BASE64_LENGTH + 10_000) {
    return json({ error: "檔案太大，請縮小後再試。" }, 413);
  }

  let body: ApiRequest;
  try {
    body = await request.json() as ApiRequest;
  } catch {
    return json({ error: "請求格式錯誤。" }, 400);
  }

  if (typeof body.base64Data !== "string"
    || body.base64Data.length === 0
    || body.base64Data.length > MAX_BASE64_LENGTH) {
    return json({ error: "檔案內容無效或超過大小限制。" }, 400);
  }

  if (typeof body.mimeType !== "string" || !ALLOWED_MIME_TYPES.has(body.mimeType)) {
    return json({ error: "僅支援 PDF、XLS 與 XLSX 檔案。" }, 400);
  }

  return body;
}

async function callGemini(
  env: Env,
  body: ApiRequest,
  prompt: string,
  responseSchema: object,
): Promise<Response> {
  const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: body.mimeType, data: body.base64Data } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    },
  );

  const payload = await response.json() as GeminiResponse;
  if (!response.ok) {
    console.error(JSON.stringify({
      event: "gemini_error",
      status: response.status,
      message: payload.error?.message || "unknown",
    }));
    return json({ error: "Gemini 服務未回應，請稍後再試。" }, 502);
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  if (!text) {
    return json({ error: "Gemini 沒有傳回處理結果。" }, 502);
  }

  try {
    return json({ data: JSON.parse(text) });
  } catch {
    return json({ error: "Gemini 傳回的資料格式不正確。" }, 502);
  }
}

function buildExtractionPrompt(mapping: HeaderMapping): string {
  return `
Analyze this document (invoice, receipt, or order list) and extract its line items.
Extract all numbers exactly as they appear in the mapped columns. Do not add or remove tax.

Use this column mapping:
- Product name: ${mapping.name ? `column "${mapping.name}"` : "auto-detect, otherwise empty string"}
- Quantity: ${mapping.quantity ? `column "${mapping.quantity}"` : "auto-detect, otherwise 0"}
- Unit price: ${mapping.unitPrice ? `column "${mapping.unitPrice}"` : "return 0"}
- Subtotal: ${mapping.subtotal ? `column "${mapping.subtotal}"` : "return 0"}

Return JSON matching the supplied schema.`;
}

async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await readRequest(request, env);
  if (body instanceof Response) return body;

  if (pathname === "/api/analyze-structure") {
    return callGemini(
      env,
      body,
      `Scan the document's main table. List every column header, then suggest which header corresponds to product name, quantity, unit price, and subtotal. Use null when a field is absent. Return JSON matching the supplied schema.`,
      analysisSchema,
    );
  }

  if (!isHeaderMapping(body.mapping)) {
    return json({ error: "欄位對應設定無效。" }, 400);
  }

  return callGemini(env, body, buildExtractionPrompt(body.mapping), billingSchema);
}

function withStaticSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "same-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set("X-Frame-Options", "DENY");
  return secured;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze-structure" || url.pathname === "/api/extract-billing") {
      try {
        return await handleApi(request, env, url.pathname);
      } catch (error) {
        console.error(JSON.stringify({
          event: "unhandled_error",
          message: error instanceof Error ? error.message : "unknown",
        }));
        return json({ error: "服務暫時無法使用。" }, 500);
      }
    }

    return withStaticSecurityHeaders(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;
