// Client helpers for the AI (Moonshot/Kimi) endpoints. All AI output is a
// draft: translations land as 待审核 and classification suggestions are only
// persisted after human confirmation.
import { apiFetch } from "./backend";

export interface AiStatus {
  configured: boolean;
}

export interface AiTranslateResult {
  translated: number;
  failed: number;
  skipped: number;
}

export interface AiClassificationSuggestion {
  id: string;
  issueType?: string | null;
  confidence?: number;
  reason?: string;
  error?: string;
}

export function getAiStatus(): Promise<AiStatus> {
  return apiFetch("/ai/status");
}

export function requestAiTranslation(ids: string[]): Promise<AiTranslateResult> {
  return apiFetch("/ai/translate", { method: "POST", body: { ids } });
}

export function requestAiClassification(ids: string[]): Promise<{ suggestions: AiClassificationSuggestion[] }> {
  return apiFetch("/ai/classify", { method: "POST", body: { ids } });
}
