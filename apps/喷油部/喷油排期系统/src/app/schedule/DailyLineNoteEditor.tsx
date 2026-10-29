"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { invalidateClientCache } from "@/lib/clientCache";

export type DailyLineNote = { lineId: number; date: string; text: string; version: number };

export default function DailyLineNoteEditor({ date, lineId, name, note, canEdit, onSaved }: {
  date: string; lineId: number; name: string; note?: DailyLineNote; canEdit: boolean;
  onSaved: (note: DailyLineNote) => void;
}) {
  const [text, setText] = useState(note?.text ?? "");
  const [base, setBase] = useState({ text: note?.text ?? "", version: note?.version ?? 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = text !== base.text;
  useEffect(() => {
    const incoming = { text: note?.text ?? "", version: note?.version ?? 0 };
    if (incoming.version < base.version || (incoming.version === base.version && incoming.text === base.text)) return;
    // A refreshed server value must not discard a draft or advance its CAS version.
    if (dirty) { setError("备注已被其他人更新，请刷新后重新编辑"); return; }
    setText(incoming.text); setBase(incoming); setError(""); setSaved(false);
  }, [note?.text, note?.version, base.text, base.version, dirty]);
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await apiFetch("/api/schedule/line-notes", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, lineId, text, version: base.version }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) invalidateClientCache("/api/schedule");
        throw new Error(body.error || "备注保存失败");
      }
      invalidateClientCache("/api/schedule");
      onSaved(body); setText(body.text); setBase({ text: body.text, version: body.version }); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "备注保存失败"); }
    finally { setBusy(false); }
  }
  return <div className="sc-line-note">
    {canEdit ? <>
      <textarea aria-label={`${date} ${name} 备注`} placeholder="备注" rows={Math.min(6, Math.max(1, text.split("\n").length))} maxLength={2000}
        value={text} disabled={busy} onChange={e => { setText(e.target.value); setSaved(false); }} />
      {dirty && <button type="button" disabled={busy} onClick={save}>{busy ? "保存中…" : "保存备注"}</button>}
      {saved && !dirty && <span role="status">已保存</span>}
      {error && <span role="alert" aria-label="拉别备注错误">{error}</span>}
    </> : <div className="sc-line-note-text">备注：{note?.text || "—"}</div>}
  </div>;
}
