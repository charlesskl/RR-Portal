let config = {};

// 加载配置
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
    renderList('workshops', 'list-workshops');
    renderList('customers', 'list-customers');
    renderList('supervisors', 'list-supervisors');
  } catch (err) {
    console.error('加载配置失败:', err);
    showToast('加载配置失败: ' + err.message, 'danger');
  }
}

// 渲染列表
function renderList(type, containerId) {
  const ul = document.getElementById(containerId);
  ul.innerHTML = '';

  const items = config[type] || [];
  if (items.length === 0) {
    ul.innerHTML = '<li class="list-group-item text-muted small">暂无数据</li>';
    return;
  }

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center px-0';
    li.innerHTML = `
      <span>${item}</span>
      <button class="btn btn-outline-danger btn-sm" onclick="removeItem('${type}', ${index})" title="删除">
        <i class="bi bi-trash"></i>
      </button>
    `;
    ul.appendChild(li);
  });
}

// 添加条目
async function addItem(type) {
  const input = document.getElementById(`input-${type}`);
  const value = input.value.trim();

  if (!value) {
    showToast('请输入名称', 'warning');
    input.focus();
    return;
  }

  const items = config[type] || [];
  if (items.includes(value)) {
    showToast('该项目已存在', 'warning');
    input.focus();
    return;
  }

  items.push(value);
  config[type] = items;

  const ok = await saveConfig();
  if (ok) {
    input.value = '';
    renderList(type, `list-${type}`);
    showToast('添加成功');
  } else {
    // 回滚
    items.pop();
  }
}

// 删除条目
async function removeItem(type, index) {
  if (!confirm('确定删除?')) return;

  const items = config[type] || [];
  const removed = items.splice(index, 1);
  config[type] = items;

  const ok = await saveConfig();
  if (ok) {
    renderList(type, `list-${type}`);
    showToast('删除成功');
  } else {
    // 回滚
    items.splice(index, 0, ...removed);
  }
}

// 保存配置到后端
async function saveConfig() {
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workshops: config.workshops,
        customers: config.customers,
        supervisors: config.supervisors,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error('保存配置失败:', err);
    showToast('保存失败: ' + err.message, 'danger');
    return false;
  }
}

// Toast 提示
function showToast(message, type = 'success') {
  const toastEl = document.getElementById('toastMsg');
  const toastText = document.getElementById('toastText');

  // 更新样式
  toastEl.className = toastEl.className
    .replace(/text-bg-\w+/, `text-bg-${type}`);

  toastText.textContent = message;

  const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 });
  toast.show();
}

// 支持输入框回车触发添加
['workshops', 'customers', 'supervisors'].forEach(type => {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById(`input-${type}`);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addItem(type);
      });
    }
  });
});

// 页面加载时自动拉取配置
loadConfig();
