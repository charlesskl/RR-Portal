import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { userApi, type UserRow } from '../api/users';
import { deptApi } from '../api/depts';
import { ALL_ROLES } from '../auth/permissions';
import type { Dept } from '../api/types';
import { palette } from '../theme';

/* 用户管理（仅管理员可见，路由由 RequireRole 守卫）。
   建号 / 改资料 / 重置密码 / 停用启用；不做物理删除，停用=isActive:false。 */

const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });
const dash = <span style={{ color: palette.inkSoft }}>—</span>;

// 表单一行：左标签右控件。定义在模块顶层（不能放组件内部，否则每次渲染重建会让输入框失焦）
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: palette.inkSoft, marginBottom: 6 }}>
        {label} {required && <span style={{ color: palette.bad }}>*</span>}
      </div>
      {children}
    </div>
  );
}

export default function UsersPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null); // 'new'=新建, UserRow=编辑
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);

  const load = () => {
    setLoading(true);
    userApi.list().then(setRows).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    deptApi.list().then(setDepts);
  }, []);

  const deptName = (id: number) => depts.find((d) => d.deptId === id)?.deptName ?? id;

  // 停用/启用：复用 update 接口翻转 isActive
  const toggleActive = async (r: UserRow) => {
    await userApi.update(r.userId, { displayName: r.displayName, role: r.role ?? null, deptId: r.deptId, isActive: !r.isActive });
    message.success(r.isActive ? '已停用' : '已启用');
    load();
  };

  const columns: ColumnsType<UserRow> = [
    { title: '用户名', dataIndex: 'username', onHeaderCell: hcell, render: (v) => <b>{v}</b> },
    { title: '显示名', dataIndex: 'displayName', onHeaderCell: hcell },
    { title: '角色', dataIndex: 'role', onHeaderCell: hcell, render: (v) => (v ? <Tag color="blue">{v}</Tag> : dash) },
    { title: '部门', dataIndex: 'deptId', onHeaderCell: hcell, render: deptName },
    {
      title: '状态',
      dataIndex: 'isActive',
      onHeaderCell: hcell,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 220,
      onHeaderCell: hcell,
      render: (_, r) => (
        <Space size={10}>
          <a onClick={() => setEditing(r)}>编辑</a>
          <a onClick={() => setPwdTarget(r)}>重置密码</a>
          <a style={{ color: r.isActive ? palette.bad : palette.ok }} onClick={() => toggleActive(r)}>
            {r.isActive ? '停用' : '启用'}
          </a>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>用户管理</div>

      <div
        style={{
          background: palette.raised,
          border: `1px solid ${palette.line}`,
          borderRadius: 18,
          boxShadow: '0 2px 8px rgba(31,99,216,0.05)',
          padding: '22px 24px',
          marginTop: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
            新建用户
          </Button>
        </div>

        <Table<UserRow>
          rowKey="userId"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个用户` }}
        />
      </div>

      <UserFormDrawer editing={editing} depts={depts} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      <ResetPwdModal target={pwdTarget} onClose={() => setPwdTarget(null)} />
    </div>
  );
}

/* —— 新建 / 编辑 用户 —— */
function UserFormDrawer({
  editing,
  depts,
  onClose,
  onDone,
}: {
  editing: UserRow | 'new' | null;
  depts: Dept[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const isNew = editing === 'new';
  const open = editing !== null;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<string>();
  const [deptId, setDeptId] = useState<number>();
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // 打开时回填：新建=清空；编辑=带入该用户(用户名只读、不带密码)
  useEffect(() => {
    if (editing === null) return;
    if (editing === 'new') {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setRole(undefined);
      setDeptId(undefined);
      setIsActive(true);
    } else {
      setUsername(editing.username);
      setPassword('');
      setDisplayName(editing.displayName);
      setRole(editing.role ?? undefined);
      setDeptId(editing.deptId);
      setIsActive(editing.isActive);
    }
  }, [editing]);

  const save = async () => {
    if (isNew && !username.trim()) return message.warning('请填用户名');
    if (isNew && !password.trim()) return message.warning('请填初始密码');
    if (!displayName.trim()) return message.warning('请填显示名');
    if (!role) return message.warning('请选角色');
    if (!deptId) return message.warning('请选部门');
    setSaving(true);
    try {
      if (isNew) {
        await userApi.create({ username: username.trim(), password: password.trim(), displayName: displayName.trim(), role, deptId });
        message.success('已创建');
      } else {
        await userApi.update((editing as UserRow).userId, { displayName: displayName.trim(), role, deptId, isActive });
        message.success('已保存');
      }
      onDone();
    } catch {
      /* unwrap 已弹错误提示 */
    } finally {
      setSaving(false);
    }
  };

  const deptOpts = depts.map((d) => ({ value: d.deptId, label: d.deptName }));
  const roleOpts = ALL_ROLES.map((r) => ({ value: r, label: r }));

  return (
    <Drawer
      title={isNew ? '新建用户' : `编辑用户 · ${username}`}
      width={460}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </Space>
      }
    >
      <Field label="用户名" required={isNew}>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!isNew} placeholder="登录账号" />
      </Field>

      {isNew && (
        <Field label="初始密码" required>
          <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} placeholder="登录用初始密码" />
        </Field>
      )}

      <Field label="显示名" required>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="姓名/昵称" />
      </Field>

      <Field label="角色" required>
        <Select value={role} onChange={setRole} options={roleOpts} style={{ width: '100%' }} placeholder="选择角色" />
      </Field>

      <Field label="部门" required>
        <Select value={deptId} onChange={setDeptId} options={deptOpts} style={{ width: '100%' }} placeholder="选择部门" />
      </Field>

      {!isNew && (
        <Field label="状态">
          <Space>
            <Switch checked={isActive} onChange={setIsActive} />
            <span style={{ color: palette.inkSoft }}>{isActive ? '启用' : '停用'}</span>
          </Space>
        </Field>
      )}
    </Drawer>
  );
}

/* —— 重置密码 —— */
function ResetPwdModal({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const { message } = App.useApp();
  const [pwd, setPwd] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPwd('');
  }, [target]);

  const ok = async () => {
    if (!pwd.trim()) return message.warning('请填新密码');
    setSaving(true);
    try {
      await userApi.resetPassword(target!.userId, pwd.trim());
      message.success('密码已重置');
      onClose();
    } catch {
      /* unwrap 已弹错误提示 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`重置密码 · ${target?.username ?? ''}`}
      open={!!target}
      onCancel={onClose}
      onOk={ok}
      confirmLoading={saving}
      okText="重置"
      cancelText="取消"
      destroyOnHidden
    >
      <div style={{ color: palette.inkSoft, marginBottom: 8 }}>给该用户设置一个新的登录密码:</div>
      <Input.Password value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="输入新密码" onPressEnter={ok} />
    </Modal>
  );
}
