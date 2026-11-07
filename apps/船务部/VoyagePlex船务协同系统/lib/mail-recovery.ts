export type MailScope = { company: "Xingxin" | "Huadeng"; ownerId: number | null };
export type FailedMail = { id: number; mailSubject: string; mailReceivedAt: string; mailboxUid: number | null; canRetry: boolean; reason: string };
export type FailedMailPage = MailScope & { address: string; page: number; pageSize: number; total: number; items: FailedMail[] };
export type RecoveryResult = { id: number; subject: string; outcome: "recovered" | "failed" | "unknown" };

export function readMailScope(cookie: string): MailScope {
  const values = new Map(cookie.split(";").map(part => { const index = part.indexOf("="); return [part.slice(0, index).trim(), part.slice(index + 1).trim()]; }));
  const company = values.get("voyageplex_company") === "Huadeng" ? "Huadeng" : "Xingxin";
  const owner = Number(values.get("voyageplex_mail_owner"));
  return { company, ownerId: company === "Huadeng" && Number.isSafeInteger(owner) && owner > 0 ? owner : null };
}

export function sameMailScope(left: MailScope, right: MailScope) {
  return left.company === right.company && left.ownerId === right.ownerId;
}

export function readFailedMailPage(value: unknown, scope: MailScope, page: number): FailedMailPage {
  if (!value || typeof value !== "object") throw new Error("列表返回不完整，请重新读取。");
  const data = value as FailedMailPage;
  if (!sameMailScope(scope, data)) throw new Error("所选邮箱已变化，请刷新页面后重试。");
  if (typeof data.address !== "string" || data.address.length > 320 || !Array.isArray(data.items) || data.items.length > 20 ||
      data.pageSize !== 20 || data.page !== page || !Number.isSafeInteger(data.total) || data.total < data.items.length ||
      new Set(data.items.map(item => item?.id)).size !== data.items.length || data.items.some(item =>
        !item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.canRetry !== "boolean" ||
        typeof item.mailSubject !== "string" || item.mailSubject.length > 240 || typeof item.reason !== "string" || item.reason.length > 500 ||
        typeof item.mailReceivedAt !== "string" || item.mailReceivedAt.length > 80 ||
        (item.mailboxUid !== null && (!Number.isSafeInteger(item.mailboxUid) || item.mailboxUid <= 0)))) {
    throw new Error("列表返回不完整，请重新读取。");
  }
  return data;
}

export function recoverySelection(items: FailedMail[], selected: number[]) {
  if (selected.length < 1 || selected.length > 5 || new Set(selected).size !== selected.length) throw new Error("请选择 1 至 5 封失败邮件。");
  return selected.map(id => {
    const item = items.find(value => value.id === id && value.canRetry);
    if (!item) throw new Error("邮件状态已变化，请刷新列表后重新选择。");
    return item;
  });
}

// A 200 response alone is not evidence that any particular mail was recovered.
export function recoveryResults(selected: FailedMail[], value: unknown): RecoveryResult[] {
  if (!value || typeof value !== "object") throw new Error("补信结果不完整，请刷新列表核对。");
  const result = value as Record<string, unknown>;
  const ids = result.recoveredItemIds;
  if (!Array.isArray(ids) || !ids.every(id => Number.isSafeInteger(id) && selected.some(item => item.id === id)) ||
      new Set(ids).size !== ids.length || result.requested !== selected.length || result.recovered !== ids.length ||
      result.stillFailed !== selected.length - ids.length) throw new Error("补信结果不完整，请刷新列表核对。");
  return selected.map(item => ({ id: item.id, subject: item.mailSubject, outcome: ids.includes(item.id) ? "recovered" : "failed" }));
}

export function recoveryError(status: number) {
  if (status === 401) return "登录已过期，请重新登录管理员账号。";
  if (status === 403) return "当前账号没有历史补信权限，请使用管理员账号。";
  if (status === 429) return "邮箱正在处理其他请求，请稍后刷新列表再重试。";
  if ([400, 404, 409].includes(status)) return "邮箱绑定或邮件状态不符合重试条件，请刷新列表重新核对；持续失败请联系管理员查看日志。";
  return "未能确认补信结果。请刷新列表核对后再操作，不要重复提交。";
}
