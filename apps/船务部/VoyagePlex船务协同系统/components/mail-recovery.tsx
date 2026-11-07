"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readMailScope, sameMailScope, readFailedMailPage, recoverySelection, recoveryResults, recoveryError, type FailedMailPage, type RecoveryResult, type MailScope } from "@/lib/mail-recovery";
import styles from "./mail-recovery.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function MailRecovery() {
  const [data, setData] = useState<FailedMailPage>();
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [denied, setDenied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const resultScope = useRef<MailScope | null>(null);

  const load = useCallback(async (page = 1, preserveMessage = false) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setData(undefined); setSelected([]); setConfirming(false);
    if (!preserveMessage) setError("");
    const scope = readMailScope(document.cookie);
    if (resultScope.current && !sameMailScope(resultScope.current, scope)) setResults([]);
    if (scope.company === "Huadeng" && scope.ownerId === null) {
      setResults([]); setError("请先在上方选择一位人员的邮箱，再查看历史失败邮件。"); setLoading(false); return;
    }
    try {
      const response = await fetch(`${basePath}/api/imports/email/mailbox/failed?page=${page}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (response.status === 401 || response.status === 403) { setDenied(true); setResults([]); }
      if (!response.ok) throw new Error(recoveryError(response.status));
      const value = readFailedMailPage(await response.json(), scope, page);
      if (!sameMailScope(scope, readMailScope(document.cookie))) { setResults([]); throw new Error("所选邮箱已变化，请刷新页面后重试。"); }
      if (!controller.signal.aborted && mounted.current) { setData(value); setDenied(false); }
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current) setError(reason instanceof Error ? reason.message : "无法读取失败邮件，请重新读取。");
    } finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
  }, []);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; request.current?.abort(); }; }, [load]);

  async function retry() {
    if (!data || busy.current || !confirming || denied) return;
    if (!sameMailScope(data, readMailScope(document.cookie))) { setResults([]); setSelected([]); setConfirming(false); setData(undefined); setError("所选邮箱已变化，请刷新页面后重试。"); return; }
    let chosen;
    try { chosen = recoverySelection(data.items, selected); } catch (reason) { setSelected([]); setConfirming(false); setError(reason instanceof Error ? reason.message : "请刷新列表后重新选择。"); return; }
    resultScope.current = data;
    busy.current = true; setWorking(true); setConfirming(false); setSelected([]); setError(""); setResults([]);
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(`${basePath}/api/imports/email/mailbox/retry-failed`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: chosen.map(item => item.id) }),
        cache: "no-store", signal: controller.signal,
      });
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403) { setDenied(true); setData(undefined); setResults([]); throw new Error(recoveryError(response.status)); }
      if (!sameMailScope(data, readMailScope(document.cookie))) { setData(undefined); throw new Error("所选邮箱已变化，请刷新页面核对刚才的补信结果。"); }
      if (!response.ok) throw new Error(recoveryError(response.status));
      const result = recoveryResults(chosen, await response.json());
      if (!mounted.current) return;
      if (!sameMailScope(data, readMailScope(document.cookie))) { setResults([]); throw new Error("所选邮箱已变化，请刷新页面核对刚才的补信结果。"); }
      setResults(result);
      await load(1, true);
    } catch (reason) {
      if (!mounted.current) return;
      setData(undefined);
      setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "请求已中断，补信结果尚未确认。请刷新列表核对后再操作。");
    } finally { window.clearTimeout(timer); busy.current = false; if (mounted.current) setWorking(false); }
  }

  function choose(id: number, checked: boolean) {
    setConfirming(false);
    setSelected(previous => checked ? previous.length < 5 && !previous.includes(id) ? [...previous, id] : previous : previous.filter(value => value !== id));
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <section className={`panel ${styles.panel}`} aria-labelledby="mail-recovery-heading" aria-busy={loading || working}>
    <div className={styles.heading}><div><h2 id="mail-recovery-heading">历史失败邮件补信</h2><p>选择未处理的失败邮件重新读取，每次最多 5 封。</p></div><button className="ghost-button" disabled={loading || working} onClick={() => void load()}><RefreshCw size={16}/>刷新列表</button></div>
    <p className={styles.explanation}>补信保留原同步断点。读取成功后回到邮件工作台核对；走柜任务仍需另行确认。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {results.length > 0 && <section className={styles.results} aria-label="本次补信结果" role="status"><h3>本次补信结果</h3><ul>{results.map(item => <li key={item.id}><span>#{item.id} · {item.subject || "无主题"}</span><strong className={item.outcome === "recovered" ? styles.success : styles.failure}>{item.outcome === "recovered" ? "已读取，待工作台核对" : "仍读取失败，原记录保留"}</strong></li>)}</ul><Link href="/mail/workbench">前往邮件工作台核对</Link></section>}
    {working && <p role="status" className={styles.state}>正在逐封读取，请等待结果。</p>}
    {loading ? <p role="status" className={styles.state}>正在读取失败邮件列表…</p> : data && <>
      <div className={styles.summary}><strong>{data.company === "Huadeng" ? "华登" : "兴信"} · {data.address || "未配置邮箱"}</strong><span>失败记录 {data.total} 封 · 已选 {selected.length}/5</span></div>
      {data.items.length ? <ul className={styles.list} aria-label="历史失败邮件">{data.items.map(item => <li key={item.id} className={selected.includes(item.id) ? styles.selected : ""}>
        <input type="checkbox" aria-label={`选择邮件 ${item.id}`} checked={selected.includes(item.id)} disabled={working || denied || !item.canRetry || (selected.length >= 5 && !selected.includes(item.id))} onChange={event => choose(item.id, event.target.checked)}/>
        <div><strong>{item.mailSubject || "无主题"}</strong><p>#{item.id} · {item.mailReceivedAt ? new Date(item.mailReceivedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "收件时间待核对"}{item.mailboxUid ? ` · UID ${item.mailboxUid}` : ""}</p><small>{item.reason || (item.canRetry ? "提交时将再次核对邮件状态与邮箱身份" : "暂不符合重试条件")}</small></div>
        <span className={`status ${item.canRetry ? "warn" : ""}`}>{item.canRetry ? "待重试" : "需核对"}</span>
      </li>)}</ul> : <p className={styles.state}>{data.total ? "本页已无失败记录，请返回上一页或刷新列表。" : "此邮箱没有已记录的失败邮件。若仍缺邮件，请核对收件日期与同步状态。"}</p>}
      <div className={styles.footer}><nav aria-label="失败邮件分页"><button disabled={working || data.page <= 1} onClick={() => void load(data.page - 1)}>上一页</button><span>第 {data.page} / {pages} 页</span><button disabled={working || data.page >= pages} onClick={() => void load(data.page + 1)}>下一页</button></nav><button className="primary-button" disabled={working || denied || selected.length === 0} onClick={() => setConfirming(true)}>重试所选 {selected.length || ""} 封</button></div>
      {confirming && <div className={styles.confirm} role="group" aria-label="确认补信"><p>确认从 <b>{data.address}</b> 重新读取所选 {selected.length} 封邮件？</p><p>不会自动确认业务任务。未成功的邮件保留原记录，稍后可再核对。</p><div><button className="ghost-button" onClick={() => setConfirming(false)}>取消</button><button className="primary-button" onClick={() => void retry()}>确认重试</button></div></div>}
    </>}
  </section>;
}
