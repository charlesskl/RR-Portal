// 子路径部署时，Vite 的 BASE_URL 形如 "/qa-weekly-report/"；本地开发时是 "/"。
// 拼接出 API 前缀，让所有请求自动带上子路径。
const BASE_URL = import.meta.env.BASE_URL || '/';
const trimmed = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
const BASE = `${trimmed}/api`;

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export async function uploadFile(file, customerId, stage = '') {
  const fd = new FormData();
  fd.append('file', file);
  if (customerId) fd.append('customerId', customerId);
  if (stage) fd.append('stage', stage);
  return handle(await fetch(`${BASE}/upload`, { method: 'POST', body: fd }));
}

export async function listReports(customerId) {
  const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
  return handle(await fetch(`${BASE}/reports${qs}`));
}

export async function getReport(id) {
  return handle(await fetch(`${BASE}/reports/${id}`));
}

export async function deleteReport(id) {
  return handle(await fetch(`${BASE}/reports/${id}`, { method: 'DELETE' }));
}

export async function getAllWeeks() {
  return handle(await fetch(`${BASE}/reports/weeks/all`));
}

export async function getWeekly(weekKey, customerId) {
  const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
  return handle(await fetch(`${BASE}/reports/weekly/${weekKey}${qs}`));
}

export async function getMatrix(weeks = 8) {
  return handle(await fetch(`${BASE}/reports/matrix?weeks=${weeks}`));
}

export async function listCustomers() {
  return handle(await fetch(`${BASE}/customers`));
}

export async function createCustomer(name) {
  return handle(await fetch(`${BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }));
}

export async function deleteCustomer(id) {
  return handle(await fetch(`${BASE}/customers/${id}`, { method: 'DELETE' }));
}

export async function listProducts(customerId = '', query = '') {
  const params = new URLSearchParams();
  if (customerId) params.set('customerId', customerId);
  if (query) params.set('q', query);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return handle(await fetch(`${BASE}/products${qs}`));
}

export async function getProduct(productNo) {
  return handle(await fetch(`${BASE}/products/${encodeURIComponent(productNo)}`));
}

export function exportWeeklyUrl(weekKey, customerId) {
  const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
  return `${BASE}/reports/weekly/${weekKey}/export${qs}`;
}
