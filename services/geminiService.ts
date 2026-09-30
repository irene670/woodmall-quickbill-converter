import { BillingData, HeaderMapping, StructureAnalysisResult } from "../types";

const CLIENT_ID_KEY = "quickbill-converter-client-id";

function getClientId(): string {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const clientId = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null) as
    | { data?: unknown; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "AI 服務暫時無法使用，請稍後再試。");
  }

  return payload?.data as T;
}

export async function analyzeDocumentStructure(
  base64Data: string,
  mimeType: string,
): Promise<StructureAnalysisResult> {
  return callApi<StructureAnalysisResult>("/api/analyze-structure", {
    base64Data,
    mimeType,
  });
}

export async function extractBillingData(
  base64Data: string,
  mimeType: string,
  mapping?: HeaderMapping,
): Promise<BillingData> {
  return callApi<BillingData>("/api/extract-billing", {
    base64Data,
    mimeType,
    mapping,
  });
}
