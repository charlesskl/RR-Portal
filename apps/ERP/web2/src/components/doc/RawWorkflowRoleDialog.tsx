import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountApi } from "@/api/endpoints";
import type { RawWorkflowPosition } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { PickerDialog } from "./PickerDialog";

const roles: [RawWorkflowPosition, string][] = [
  ["06-clerk", "啤机部文员"], ["06-supervisor", "啤机部主管"], ["06-manager", "啤机部经理"],
  ["05-warehouse", "原料仓仓管"], ["05-manager", "原料仓经理"],
];

export function RawWorkflowRoleDialog({ account, onClose }: { account: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can, loading: permissionsLoading } = usePerms();
  const [position, setPosition] = useState<RawWorkflowPosition | "">("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    accountApi.rawWorkflowRole(account).then(role => {
      if (generation.current === request) { setPosition(role.positionCode ?? ""); setLoaded(true); }
    }).catch(e => {
      if (generation.current === request) setError(e instanceof Error ? e.message : "原料岗位加载失败");
    }).finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current += 1; };
  }, [account, retry]);
  const save = async () => {
    if (loading || saving || !loaded || permissionsLoading || !can("账号管理", "保存")) return;
    const request = generation.current;
    setSaving(true); setError("");
    try {
      await accountApi.saveRawWorkflowRole(account, position || null);
      void qc.invalidateQueries({ queryKey: ["raw-stock-issue", "access"] });
      void qc.invalidateQueries({ queryKey: ["employee-picker", "raw-issue-maker"] });
      if (request === generation.current) onClose();
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : "保存原料岗位失败");
    } finally { if (request === generation.current) setSaving(false); }
  };
  return <PickerDialog open title={`原料流程岗位 · ${account}`} onClose={() => { if (!saving) onClose(); }} footer={<>
    <button type="button" className="f-btn px-4" disabled={saving} onClick={onClose}>取消</button>
    <button type="button" className="f-btn f-btn-cyan px-4" disabled={loading || saving || !loaded || permissionsLoading || !can("账号管理", "保存")} onClick={() => void save()}>{saving ? "保存中…" : "保存岗位"}</button>
  </>}>
    <p className="mb-4 text-sm text-[#5f6b7d]">岗位仅限定原料流程职责，仍需相应菜单权限。未绑定账号保持空，不自动授予菜单权限。</p>
    {loading ? <p role="status">正在读取岗位…</p> : <label className="block"><span className="f-label">原料流程岗位</span><select aria-label="原料流程岗位" className="f-input mt-2" disabled={saving || !loaded} value={position} onChange={e => setPosition(e.target.value as RawWorkflowPosition | "")}><option value="">未绑定</option>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {error && <p role="alert" className="mt-3 text-sm text-[#dc2626]">{error}{!loaded && <button type="button" className="f-btn ml-2 px-3" disabled={saving} onClick={() => { setLoading(true); setLoaded(false); setError(""); setRetry(v => v + 1); }}>重新读取</button>}</p>}
  </PickerDialog>;
}
