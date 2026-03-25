/**
 * 工程资料生成器 — Shared Frontend Utilities
 */

// API helper — fetch wrapper with JSON handling
async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  // For blob responses (Excel download), check content-type
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/zip') || ct.includes('spreadsheetml') || ct.includes('octet-stream')) {
    return res;  // Return raw response for blob handling
  }
  return res.json();
}

// Toast notification using Bootstrap toast
function showToast(message, type = 'success') {
  // Create toast container if not exists
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '1080';
    document.body.appendChild(container);
  }

  const bgClass = type === 'success' ? 'bg-success' : type === 'error' ? 'bg-danger' : 'bg-warning';
  const id = 'toast-' + Date.now();
  const html = `
    <div id="${id}" class="toast align-items-center text-white ${bgClass} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  container.insertAdjacentHTML('beforeend', html);
  const toastEl = document.getElementById(id);
  const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
  toast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// Format date string
function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 10);
}

// Debounce
function debounce(fn, ms = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Download file from POST response
async function downloadFromPost(url, filename) {
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error('Generate failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    showToast('Excel生成成功！');
  } catch (e) {
    showToast('生成失败: ' + e.message, 'error');
  }
}

// Confirm dialog
function confirmAction(message) {
  return confirm(message);
}
