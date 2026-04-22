/* Shared utilities */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCurrency(val, currency = 'HK$', decimals = 2) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return `${currency} ${formatNumber(n, decimals)}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Make a table cell editable on double-click.
 * @param {HTMLTableCellElement} td
 * @param {Object} options
 * @param {string} options.type - 'text' | 'number' | 'select'
 * @param {string[]} [options.choices] - for type='select'
 * @param {*} options.value - initial value
 * @param {Function} options.onSave - called with new value on save
 */
function makeEditable(td, options) {
  const { type = 'text', choices = [], value, onSave } = options;

  td.classList.add('editable');

  td.addEventListener('dblclick', () => {
    if (td.classList.contains('editing')) return;
    td.classList.add('editing');

    let input;
    if (type === 'select') {
      input = document.createElement('select');
      choices.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === String(value)) opt.selected = true;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = type === 'number' ? 'number' : 'text';
      input.step = 'any';
      input.value = value !== null && value !== undefined ? value : '';
    }

    const original = td.innerHTML;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    if (input.select) input.select();

    const save = () => {
      const newVal = type === 'number' ? (input.value === '' ? null : parseFloat(input.value)) : input.value;
      td.classList.remove('editing');
      onSave(newVal);
    };

    const cancel = () => {
      td.classList.remove('editing');
      td.innerHTML = original;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', save);
  });
}

function showToast(msg, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:6px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = `padding:8px 14px;border-radius:5px;font-size:12px;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.2);
    background:${type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#4a90d9'}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
