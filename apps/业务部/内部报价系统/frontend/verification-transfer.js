(async () => {
  const host = document.getElementById('verification-transfer');
  try {
    const response = await fetch('./api/auth/me');
    const me = await response.json();
    if (!response.ok || !me.perms?.['账号管理']?.can_admin) return;
  } catch { return; }
  host.hidden = false;
  host.innerHTML = '<h3>导入客户核价资料</h3><input type="file" accept=".json,.jsonl,.gz" aria-label="选择客户核价导入包"><button data-preview>预览导入</button><div data-result role="status"></div>';
  const result = host.querySelector('[data-result]');
  const preview = host.querySelector('[data-preview]');
  const input = host.querySelector('input');
  let plan, file;
  async function send(apply) {
    const data = new FormData();
    data.append('file', file);
    if (apply) { data.append('apply', '1'); data.append('token', plan.token); }
    const response = await fetch('./api/verification-transfer', { method: 'POST', body: data });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || '导入失败');
    return body;
  }
  input.onchange = () => { plan = null; result.textContent = ''; };
  preview.onclick = async () => {
    file = input.files[0];
    if (!file) { result.textContent = '请选择导入包'; return; }
    if (file.size > 49 * 1024 * 1024) { result.textContent = '导入文件最大支持 49 MiB；请压缩为 .gz 后重试'; return; }
    preview.disabled = true;
    try {
      plan = await send(false);
      const customers = new Map();
      plan.items.forEach(row => customers.set(row.customer, (customers.get(row.customer) || 0) + 1));
      result.textContent = `共 ${plan.count} 张，新增 ${plan.new_count} 张，已导入 ${plan.existing_count} 张。已有不同资料不会覆盖。客户：${[...customers].map(([name,count]) => name + ' ' + count + ' 张').join('；')}`;
      if (!plan.new_count) return;
      const button = document.createElement('button');
      button.textContent = '确认导入';
      result.appendChild(button);
      button.onclick = async () => {
        button.disabled = true; preview.disabled = true; input.disabled = true;
        try {
          const saved = await send(true);
          result.textContent = `已导入 ${saved.count} 张，跳过已导入 ${saved.already_imported} 张。刷新任务清单后查看。`;
        } catch (error) { result.textContent = error.message; }
        finally { preview.disabled = false; input.disabled = false; }
      };
    } catch (error) { result.textContent = error.message; }
    finally { preview.disabled = false; }
  };
})();
