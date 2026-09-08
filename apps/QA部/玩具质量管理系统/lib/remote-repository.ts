// Remote repository: implements the same ComplaintRepository interface as the
// localStorage version, but talks to the ToyQMS backend over HTTP.
import type { CAPInput, CAPRecord, ComplaintRecord, ComplaintUpdate, ComplaintWorkflowStatus, ImportSummary, IssueTypeDefinition, LocalDataBackup, SeriesDefinition, TranslationImportRow, TranslationImportSummary, TranslationUpdate } from "./types";
import type { ComplaintRepository } from "./repository";
import { apiFetch } from "./backend";

export class RemoteComplaintRepository implements ComplaintRepository {
  getAll(): Promise<ComplaintRecord[]> { return apiFetch("/complaints"); }

  async importNew(records: ComplaintRecord[], summary: ImportSummary): Promise<number> {
    const result = await apiFetch<{ imported: number }>("/complaints/import", { method: "POST", body: { records, summary } });
    return result.imported;
  }

  getImportHistory(): Promise<ImportSummary[]> { return apiFetch("/import-history"); }
  getIssueTypes(): Promise<string[]> { return apiFetch("/issue-types"); }
  getIssueTypeDefinitions(): Promise<IssueTypeDefinition[]> { return apiFetch("/issue-type-definitions"); }

  saveIssueType(name: string): Promise<string[]> {
    return apiFetch("/issue-types", { method: "POST", body: { name } });
  }

  async updateIssueTypeChineseName(name: string, chineseName: string): Promise<void> {
    await apiFetch("/issue-types/chinese-name", { method: "PUT", body: { name, chineseName } });
  }

  getSeriesDefinitions(): Promise<{ primary: SeriesDefinition[]; secondary: SeriesDefinition[] }> {
    return apiFetch("/series-definitions");
  }

  async updateSeriesChineseName(kind: "primary" | "secondary", name: string, chineseName: string, primarySeriesName?: string | null): Promise<void> {
    await apiFetch("/series-definitions/chinese-name", { method: "PUT", body: { kind, name, chineseName, primarySeriesName: primarySeriesName ?? null } });
  }

  async updateComplaintIssue(id: string, issueType: string | null): Promise<void> {
    await apiFetch(`/complaints/${id}/issue`, { method: "PATCH", body: { issueType } });
  }

  async updateComplaint(id: string, changes: ComplaintUpdate): Promise<void> {
    await apiFetch(`/complaints/${id}`, { method: "PATCH", body: changes });
  }

  updateComplaintStatuses(ids: string[], status: ComplaintWorkflowStatus): Promise<{ updated: number; skipped: number }> {
    return apiFetch("/complaints/status", { method: "POST", body: { ids, status } });
  }

  async updateComplaintTranslation(id: string, changes: TranslationUpdate): Promise<void> {
    await apiFetch(`/complaints/${id}/translation`, { method: "PATCH", body: changes });
  }

  importTranslations(rows: TranslationImportRow[], invalidRows: number): Promise<TranslationImportSummary> {
    return apiFetch("/translations/import", { method: "POST", body: { rows, invalidRows } });
  }

  async confirmTranslations(ids: string[]): Promise<number> {
    const result = await apiFetch<{ confirmed: number }>("/translations/confirm", { method: "POST", body: { ids } });
    return result.confirmed;
  }

  async resetOfflineTranslations(): Promise<number> {
    const result = await apiFetch<{ reset: number }>("/translations/reset-offline", { method: "POST", body: {} });
    return result.reset;
  }

  async deleteComplaints(ids: string[]): Promise<number> {
    const result = await apiFetch<{ deleted: number }>("/complaints/delete", { method: "POST", body: { ids } });
    return result.deleted;
  }

  getCAPs(): Promise<CAPRecord[]> { return apiFetch("/caps"); }

  saveCAP(input: CAPInput, id?: string): Promise<CAPRecord> {
    return apiFetch("/caps", { method: "PUT", body: { input, id: id ?? null } });
  }

  async deleteCAP(id: string): Promise<void> {
    await apiFetch(`/caps/${id}`, { method: "DELETE" });
  }

  exportLocalData(): Promise<LocalDataBackup> { return apiFetch("/backup"); }

  async restoreLocalData(backup: LocalDataBackup): Promise<void> {
    await apiFetch("/backup/restore", { method: "POST", body: backup });
  }

  async clear(): Promise<void> {
    await apiFetch("/clear", { method: "POST", body: {} });
  }
}
