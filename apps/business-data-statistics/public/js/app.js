// ==========================================
// 生产经营数据系统 - Vue 3 前端应用
// ==========================================

// ===== 部门配置 =====
const DEPT_CONFIG = {
  beer: { key: 'beer', name: '啤机部', uniqueFields: [
    { field: 'total_machines', label: '总台数', shortLabel: '总台数', editable: true, type: 'integer' },
    { field: 'running_machines', label: '开机台数', shortLabel: '开机台数', editable: true, type: 'integer' },
    { field: 'run_hours', label: '开机时间', shortLabel: '开机时间', editable: true, type: 'number' },
    { field: 'machine_rate', label: '开机率', shortLabel: '开机率', editable: false, type: 'ratio', calculated: true, formula: '开机台数 / 总台数' },
    { field: 'misc_workers', label: '杂工人数', shortLabel: '杂工人数', editable: true, type: 'integer' },
    { field: 'gate_workers', label: '批水口人数', shortLabel: '水口人数', editable: true, type: 'integer' },
    { field: 'output_tax_incl', label: '不含税产值', shortLabel: '不含税值', editable: false, type: 'number', calculated: true, formula: '产值/天 / 1.13' },
    { field: 'avg_output_per_machine', label: '每台机平均产值', shortLabel: '台均产值', editable: false, type: 'number', calculated: true, formula: '产值/天 / 开机台数' },
    { field: 'misc_worker_wage', label: '杂工工资/天', shortLabel: '杂工工资', editable: true, type: 'number' },
    { field: 'wage_ratio', label: '总工资占产值%', shortLabel: '工资占比', editable: false, type: 'ratio', calculated: true, formula: '(员工工资+管工工资+杂工工资) / 产值/天' },
    { field: 'avg_balance_per_machine', label: '平均每台结余', shortLabel: '台均结余', editable: false, type: 'number', calculated: true, formula: '结余金额 / 开机台数' },
    { field: 'machine_repair', label: '机器维修', shortLabel: '机器维修', editable: true, type: 'number' },
    { field: 'mold_repair', label: '模具维修', shortLabel: '模具维修', editable: true, type: 'number' },
    { field: 'mold_cost_ratio', label: '模具维修占产值比%', shortLabel: '模修占比', editable: false, type: 'ratio', calculated: true, formula: '模具维修 / 产值/天' },
    { field: 'materials', label: '物料', shortLabel: '物料', editable: true, type: 'number' },
    { field: 'material_supplement', label: '原料补料', shortLabel: '原料补料', editable: true, type: 'number' },
    { field: 'gate_processing_fee', label: '批水口加工费', shortLabel: '水口加工', editable: true, type: 'number' },
    { field: 'gate_cost_ratio', label: '批水口费用占产值比%', shortLabel: '水口占比', editable: false, type: 'ratio', calculated: true, formula: '批水口加工费 / 产值/天' },
    { field: 'assembly_gate_parts_fee', label: '装配批水口配件费', shortLabel: '水口配件', editable: true, type: 'number' },
    { field: 'recoverable_gate_fee', label: '可回收批水口费', shortLabel: '回收水口', editable: true, type: 'number' },
  ]},
  print: { key: 'print', name: '印喷部', uniqueFields: [
    { field: 'pad_total_machines', label: '移印机总台数', shortLabel: '移印台数', editable: true, type: 'integer' },
    { field: 'pad_running_machines', label: '移印开机台数', shortLabel: '移印开机', editable: true, type: 'integer' },
    { field: 'pad_machine_rate', label: '移印开机率', shortLabel: '移印机率', editable: false, type: 'ratio', calculated: true, formula: '移印开机台数 / 移印总台数' },
    { field: 'spray_total_machines', label: '喷油机总台数', shortLabel: '喷油台数', editable: true, type: 'integer' },
    { field: 'spray_running_machines', label: '喷油开机台数', shortLabel: '喷油开机', editable: true, type: 'integer' },
    { field: 'spray_machine_rate', label: '喷油开机率', shortLabel: '喷油机率', editable: false, type: 'ratio', calculated: true, formula: '喷油开机台数 / 喷油总台数' },
    { field: 'misc_workers', label: '杂工人数', shortLabel: '杂工人数', editable: true, type: 'integer' },
    { field: 'work_hours', label: '员工工时', shortLabel: '员工工时', editable: true, type: 'number' },
    { field: 'total_hours', label: '总工时', shortLabel: '总工时', editable: true, type: 'number' },
    { field: 'avg_output_per_worker', label: '员工人均产值', shortLabel: '人均产值', editable: false, type: 'number', calculated: true, formula: '产值/天 / 员工人数' },
    { field: 'wage_ratio', label: '总工资占产值%', shortLabel: '工资占比', editable: false, type: 'ratio', calculated: true, formula: '(员工工资+管工工资) / 产值/天' },
    { field: 'repair_fee', label: '维修费', shortLabel: '维修费', editable: true, type: 'number' },
    { field: 'materials', label: '物料（原子灰、胶头、油墨、喷码溶剂）', shortLabel: '物料', editable: true, type: 'number' },
    { field: 'oil_water_amount', label: '油水金额', shortLabel: '油水金额', editable: true, type: 'number' },
    { field: 'subsidy', label: '补贴', shortLabel: '补贴', editable: true, type: 'number' },
    { field: 'no_output_wage', label: '无产值工资', shortLabel: '无产值资', editable: true, type: 'number' },
    { field: 'assembly_wage_paid', label: '付装配工资', shortLabel: '付装配资', editable: true, type: 'number' },
    { field: 'office_wage', label: '做办工资', shortLabel: '做办工资', editable: true, type: 'number' },
    { field: 'office_wage_ratio', label: '做办工资占比%', shortLabel: '做办占比', editable: false, type: 'ratio', calculated: true, formula: '做办工资 / 产值/天' },
    { field: 'recoverable_wage', label: '可收回工资', shortLabel: '回收工资', editable: true, type: 'number' },
    { field: 'dept_recoverable_wage', label: '车发部回收工资', shortLabel: '车发回收', editable: true, type: 'number' },
    { field: 'recoverable_indonesia_wage', label: '可收回印尼工资', shortLabel: '印尼工资', editable: true, type: 'number' },
    { field: 'recoverable_tool_fee', label: '可收回工具费', shortLabel: '回收工具', editable: true, type: 'number' },
    { field: 'non_recoverable_tool_fee', label: '不可回收工具费', shortLabel: '不回工具', editable: true, type: 'number' },
    { field: 'recoverable_paint', label: '可回收油漆金额', shortLabel: '回收油漆', editable: true, type: 'number' },
    { field: 'auto_mold_fee', label: '自动机模费', shortLabel: '自动模费', editable: true, type: 'number' },
    { field: 'mold_fee_ratio', label: '自动机模费占产值%', shortLabel: '自模占比', editable: false, type: 'ratio', calculated: true, formula: '自动机模费 / 产值/天' },
    { field: 'hunan_mold_fee', label: '发湖南模费', shortLabel: '湖南模费', editable: true, type: 'number' },
    { field: 'hunan_mold_ratio', label: '发湖南模费占产值%', shortLabel: '湖南模%', editable: false, type: 'ratio', calculated: true, formula: '发湖南模费 / 产值/天' },
    { field: 'indonesia_mold_fee', label: '发印尼模费', shortLabel: '印尼模费', editable: true, type: 'number' },
    { field: 'indonesia_mold_ratio', label: '发印尼模费占产值%', shortLabel: '印尼模%', editable: false, type: 'ratio', calculated: true, formula: '发印尼模费 / 产值/天' },
    { field: 'total_ratio', label: '结余%+自模费%', shortLabel: '余+模%', editable: false, type: 'ratio', calculated: true, formula: '结余% + 自动机模费占产值%' },
  ]},
  assembly: { key: 'assembly', name: '装配部', uniqueFields: [
    { field: 'avg_output_per_worker', label: '人均产值', shortLabel: '人均产值', editable: false, type: 'number', calculated: true, formula: '产值/天 / 员工人数' },
    { field: 'planned_wage_tax', label: '计划总工资含*1.13', shortLabel: '计划工资', editable: true, type: 'number' },
    { field: 'actual_wage', label: '实际总工资', shortLabel: '实际工资', editable: true, type: 'number' },
    { field: 'hunan_social_insurance', label: '湖南社保', shortLabel: '湖南社保', editable: true, type: 'number' },
    { field: 'hunan_tax', label: '湖南税收', shortLabel: '湖南税收', editable: true, type: 'number' },
    { field: 'workshop_repair', label: '车间维修费', shortLabel: '车间维修', editable: true, type: 'number' },
    { field: 'electrical_repair', label: '机电部维修费', shortLabel: '机电维修', editable: true, type: 'number' },
    { field: 'workshop_materials', label: '车间物料费', shortLabel: '车间物料', editable: true, type: 'number' },
    { field: 'stretch_film', label: '拉伸膜', shortLabel: '拉伸膜', editable: true, type: 'number' },
    { field: 'tape', label: '胶纸', shortLabel: '胶纸', editable: true, type: 'number' },
    { field: 'balance_minus_tape', label: '结余减胶纸', shortLabel: '余减胶纸', editable: false, type: 'number', calculated: true, formula: '结余金额 - 胶纸' },
    { field: 'balance_tape_ratio', label: '减胶纸后结余占计划工资%', shortLabel: '减纸占比', editable: false, type: 'ratio', calculated: true, formula: '(结余-胶纸) / 计划总工资' },
    { field: 'recoverable_electricity', label: '可回收电费', shortLabel: '回收电费', editable: true, type: 'number' },
    { field: 'workshop_tool_investment', label: '车间工具投资', shortLabel: '车间工投', editable: true, type: 'number' },
    { field: 'fixture_tool_investment', label: '夹具部工具投资', shortLabel: '夹具工投', editable: true, type: 'number' },
    { field: 'tool_invest_ratio', label: '工具投资占计划工资%', shortLabel: '工投占比', editable: false, type: 'ratio', calculated: true, formula: '(车间工具投资+夹具部工具投资) / 计划总工资' },
    { field: 'housing_subsidy', label: '外宿补贴', shortLabel: '外宿补贴', editable: true, type: 'number' },
    { field: 'supplement', label: '补料', shortLabel: '补料', editable: true, type: 'number' },
    { field: 'borrowed_worker_wage', label: '外借人员工资', shortLabel: '外借工资', editable: true, type: 'number' },
    { field: 'borrowed_wage_ratio', label: '外借人员工资占计划工资%', shortLabel: '外借占比', editable: false, type: 'ratio', calculated: true, formula: '外借人员工资 / 计划总工资' },
  ]}
};

// ===== 所有部门映射（含未来扩展） =====
const ALL_DEPARTMENTS = {
  beer: '啤机部', print: '印喷部', assembly: '装配部',
  electronic: '电子部', clothing: '车衣部',
  blister: '吸塑', bags_color: '胶袋/配色',
  fixture: '夹具部', roto_casting: '搪胶部',
  blowing: '吹气部'
};
// 三工结余模块的3个部门（数据锁定等仅限此范围）
const BALANCE_DEPARTMENTS = { beer: '啤机部', print: '印喷部', assembly: '装配部' };

// ===== 共享字段分组（shortLabel=表头简称，label=全称，双击表头显示全称+公式） =====
const SHARED_PEOPLE = [
  { field: 'supervisor_count', label: '管工人数', shortLabel: '管工人数', editable: true, type: 'integer' },
  { field: 'worker_count', label: '员工人数', shortLabel: '员工人数', editable: true, type: 'integer' },
];
const SHARED_OUTPUT = [
  { field: 'daily_output', label: '总产值/天', shortLabel: '产值/天', editable: true, type: 'number' },
];
const SHARED_WAGE = [
  { field: 'worker_wage', label: '员工工资/天', shortLabel: '员工工资', editable: true, type: 'number' },
  { field: 'supervisor_wage', label: '管工工资/天', shortLabel: '管工工资', editable: true, type: 'number' },
];
const SHARED_EXPENSE = [
  { field: 'rent', label: '房租', editable: true, type: 'number' },
  { field: 'utility_fee', label: '水电费', editable: true, type: 'number' },
  { field: 'tool_investment', label: '工具投资', editable: true, type: 'number' },
  { field: 'equipment', label: '设备', editable: true, type: 'number' },
  { field: 'renovation', label: '装修', editable: true, type: 'number' },
  { field: 'misc_fee', label: '杂费', editable: true, type: 'number' },
  { field: 'shipping_fee', label: '运费', editable: true, type: 'number' },
  { field: 'social_insurance', label: '社保', editable: true, type: 'number' },
  { field: 'tax', label: '税收', editable: true, type: 'number' },
];
const SHARED_BALANCE = [
  { field: 'balance', label: '结余金额', shortLabel: '结余金额', editable: false, type: 'number', calculated: true, formula: '产值/天 - 所有费用之和' },
  { field: 'balance_ratio', label: '结余%', shortLabel: '结余%', editable: false, type: 'ratio', calculated: true, formula: '结余金额 / 产值/天' },
];
// 保留 SHARED_COLUMNS 用于向后兼容
const SHARED_COLUMNS = [...SHARED_PEOPLE, ...SHARED_OUTPUT, ...SHARED_WAGE, ...SHARED_EXPENSE, ...SHARED_BALANCE];

const REMARK_COLUMN = { field: 'remark', label: '备注', editable: true, type: 'text' };

// 区域列表
const ALL_REGIONS = ['清溪', '河源', '湖南'];

// ===== 工具函数 =====
function formatAmount(num) {
  if (num === null || num === undefined || num === '') return '';
  const n = Number(num);
  if (isNaN(n)) return '';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRatio(ratio) {
  if (ratio === null || ratio === undefined || ratio === '') return '';
  const n = Number(ratio);
  if (isNaN(n)) return '';
  return (n * 100).toFixed(2) + '%';
}

function formatInteger(num) {
  if (num === null || num === undefined || num === '') return '';
  return String(Math.round(Number(num)));
}

function formatCellValue(value, type) {
  if (type === 'integer') return formatInteger(value);
  if (type === 'ratio') return formatRatio(value);
  if (type === 'number') return formatAmount(value);
  return value || '';
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return [formatDate(start), formatDate(end)];
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getMonthRange(offset = 0) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return [formatDate(start), formatDate(end)];
}

// getDeptColumns: 按逻辑分组拼接共有字段和独有字段
// 顺序：台数→人数→时间→产值→工资→共有费用→结余→独有费用→备注
const FIELD_GROUP_MACHINE = ['total_machines', 'running_machines', 'run_hours', 'machine_rate',
  'pad_total_machines', 'pad_running_machines', 'pad_machine_rate',
  'spray_total_machines', 'spray_running_machines', 'spray_machine_rate'];
const FIELD_GROUP_PEOPLE = ['misc_workers', 'gate_workers'];
const FIELD_GROUP_TIME = ['work_hours', 'total_hours'];
const FIELD_GROUP_OUTPUT = ['output_tax_incl', 'avg_output_per_machine', 'avg_output_per_worker'];
const FIELD_GROUP_WAGE = ['misc_worker_wage', 'wage_ratio', 'planned_wage_tax', 'actual_wage'];

function getDeptColumns(dept) {
  const config = DEPT_CONFIG[dept];
  if (!config) return [...SHARED_COLUMNS, REMARK_COLUMN];

  const unique = config.uniqueFields || [];

  // 按字段名分类到对应分组
  const groups = { machines: [], people: [], time: [], output: [], wage: [], afterBalance: [] };
  for (const f of unique) {
    if (FIELD_GROUP_MACHINE.includes(f.field)) groups.machines.push(f);
    else if (FIELD_GROUP_PEOPLE.includes(f.field)) groups.people.push(f);
    else if (FIELD_GROUP_TIME.includes(f.field)) groups.time.push(f);
    else if (FIELD_GROUP_OUTPUT.includes(f.field)) groups.output.push(f);
    else if (FIELD_GROUP_WAGE.includes(f.field)) groups.wage.push(f);
    else groups.afterBalance.push(f);
  }

  return [
    ...groups.machines,
    ...SHARED_PEOPLE, ...groups.people,
    ...groups.time,
    ...SHARED_OUTPUT, ...groups.output,
    ...SHARED_WAGE, ...groups.wage,
    ...SHARED_EXPENSE,
    ...SHARED_BALANCE,
    ...groups.afterBalance,
    REMARK_COLUMN
  ];
}

function getRoleName(role) {
  const map = { stats: '统计组', management: '管理层', entry: '录入员' };
  return map[role] || role;
}

// ===== 登录页组件 =====
const LoginPage = {
  template: `
    <div class="login-page">
      <div class="login-card">
        <h2>生产经营数据系统</h2>
        <p class="subtitle">Production Operations Data System</p>
        <el-form :model="form" @submit.prevent="handleLogin" label-width="0">
          <el-form-item>
            <el-input v-model="form.username" placeholder="用户名" prefix-icon="User" size="large" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="form.password" type="password" placeholder="密码" prefix-icon="Lock" size="large" show-password @keyup.enter="handleLogin" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" style="width:100%" size="large" :loading="loading" @click="handleLogin">
              登 录
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  `,
  data() {
    return {
      form: { username: '', password: '' },
      loading: false
    };
  },
  methods: {
    async handleLogin() {
      if (!this.form.username || !this.form.password) {
        ElementPlus.ElMessage.warning('请输入用户名和密码');
        return;
      }
      this.loading = true;
      try {
        const res = await API.post('/auth/login', this.form);
        API.setToken(res.token);
        localStorage.setItem('user', JSON.stringify(res.user));
        this.$root.user = res.user;
        this.$root.currentRoute = '/beer';
        window.location.hash = '#/beer';
        ElementPlus.ElMessage.success('登录成功');
      } catch (err) {
        ElementPlus.ElMessage.error(err.message || '登录失败');
      } finally {
        this.loading = false;
      }
    }
  }
};

// ===== 部门数据页组件 =====
const DeptRecordsPage = {
  props: ['dept'],
  template: `
    <div class="dept-records-page">
      <!-- 拖拽上传区 -->
      <div class="drag-upload" :class="{ dragging: isDragging }"
           @dragover.prevent="isDragging = true"
           @dragleave.prevent="isDragging = false"
           @drop.prevent="handleDrop"
           @click="triggerFileInput">
        <div class="upload-icon">📁</div>
        <div class="upload-text">拖入 Excel 文件导入数据，或点击上传</div>
        <input type="file" ref="fileInput" style="display:none" accept=".xlsx,.xls" @change="handleFileSelect" />
      </div>

      <!-- 工具栏 -->
      <div class="toolbar">
        <el-date-picker v-model="dateRange" type="daterange" range-separator="-"
          start-placeholder="开始" end-placeholder="结束" size="small"
          value-format="YYYY-MM-DD" format="MM/DD" @change="loadData" style="width:150px" />
        <div class="quick-btns">
          <button :class="{ active: quickRange === '7d' }" @click="setQuickRange('7d')">近7天</button>
          <button :class="{ active: quickRange === 'month' }" @click="setQuickRange('month')">本月</button>
          <button :class="{ active: quickRange === 'lastMonth' }" @click="setQuickRange('lastMonth')">上月</button>
        </div>
        <el-select v-model="workshopFilter" placeholder="全部车间" clearable size="small" style="width:110px" @change="loadData">
          <el-option v-for="w in workshopList" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" size="small" @click="showAddDialog">+ 新增</el-button>
        <el-button type="success" size="small" @click="handleExport">导出Excel</el-button>
        <el-button type="danger" size="small" :disabled="selectedRows.length === 0" @click="handleBatchDelete">批量删除</el-button>
      </div>

      <!-- 数据表格 -->
      <div class="data-table-wrapper">
        <el-table :data="tableData" border stripe height="500" style="width:100%"
                  @selection-change="handleSelectionChange" :row-key="row => row.id"
                  :header-cell-class-name="headerCellClass"
                  :row-class-name="getRowClass"
                  v-loading="loading" ref="dataTable">
          <el-table-column type="selection" width="40" fixed="left" />
          <el-table-column prop="record_date" label="日期" width="120" fixed="left">
            <template #default="{ row }">
              <el-date-picker
                v-if="editingDateRowId === row.id"
                v-model="row._editDate"
                type="date"
                size="small"
                value-format="YYYY-MM-DD"
                style="width:108px"
                @change="saveDate(row)"
                @blur="cancelEditDate(row)"
              />
              <span
                v-else
                @click="startEditDate(row)"
                style="cursor:pointer;display:block;padding:2px 4px"
              >{{ row.record_date ? row.record_date.substring(0, 10) : '' }}</span>
            </template>
          </el-table-column>
          <!-- BUG-02: prop 对齐后端 w.name AS workshop_name -->
          <el-table-column prop="workshop_name" label="车间" width="95" fixed="left">
            <template #default="{ row }">
              <el-select
                v-if="editingWorkshopRowId === row.id"
                v-model="row._editWorkshopId"
                size="small"
                style="width:83px"
                @change="saveWorkshop(row)"
                @blur="cancelEditWorkshop(row)"
              >
                <el-option v-for="w in workshopList" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
              <span
                v-else
                @click="startEditWorkshop(row)"
                style="cursor:pointer;display:block;padding:2px 4px"
              >{{ row.workshop_name }}</span>
            </template>
          </el-table-column>
          <el-table-column v-for="col in columns" :key="col.field" :prop="col.field"
                           :label="col.shortLabel || col.label"
                           :width="getColumnWidth(col)" :min-width="getColumnWidth(col)"
                           :class-name="getColumnClass(col)">
            <template #header>
              <span @dblclick.stop="showHeaderNote($event, col)" style="cursor:pointer;">
                {{ col.shortLabel || col.label }}
              </span>
            </template>
            <template #default="{ row }">
              <div v-if="isEditing(row.id, col.field) && col.editable" class="editing-cell-wrapper">
                <input :value="row[col.field]" @blur="saveCell(row, col.field, $event)"
                       @keyup.enter="$event.target.blur()"
                       @keyup.escape="cancelEdit"
                       @input="limitDecimals($event)"
                       autofocus />
              </div>
              <div v-else @click="startEdit(row, col)"
                   :class="getCellClasses(row, col)"
                   :style="{ cursor: col.editable ? 'text' : 'default', padding: '0 4px' }">
                <template v-if="col.field === 'balance'">
                  <span :class="{ 'amount-positive': Number(row.balance) >= 0, 'amount-negative': Number(row.balance) < 0 }">
                    {{ formatCellValue(row[col.field], col.type) }}
                  </span>
                </template>
                <template v-else>
                  {{ formatCellValue(row[col.field], col.type) }}
                </template>
              </div>
            </template>
          </el-table-column>
          <!-- ENTRY-03: 操作列 - 复制行按钮 -->
          <el-table-column label="操作" width="60" fixed="right" align="center">
            <template #default="{ row }">
              <el-tooltip content="复制此行数据为新行" placement="top" :show-after="500">
                <el-button type="primary" link size="small" @click="handleCopyRow(row)" title="复制此行">
                  复制
                </el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>

        <!-- 底部合计区（紧凑版） -->
        <div class="summary-footer" v-if="summaryData">
          <table style="width:100%; border-collapse:collapse;">
            <tr class="summary-header-row">
              <td style="width:40px"></td>
              <td style="width:50px"></td>
              <td style="width:110px">合计</td>
              <td style="width:80px">车间</td>
              <td v-for="col in columns" :key="'sh-'+col.field"
                  :class="col.calculated ? 'sh-calc' : ''"
                  :style="{ width: getColumnWidth(col) + 'px', textAlign: 'right' }">
                {{ col.shortLabel || col.label }}
              </td>
            </tr>
            <template v-for="(wsData, wsName) in summaryData.workshops" :key="'ws-'+wsName">
              <tr class="workshop-row">
                <td></td><td></td><td></td>
                <td>{{ wsName }}</td>
                <td v-for="col in columns" :key="'wd-'+wsName+'-'+col.field" style="text-align:right;">
                  {{ formatSummaryCell(wsData, col) }}
                </td>
              </tr>
            </template>
            <tr class="region-row" v-if="summaryData.regions">
              <td></td><td></td><td></td>
              <td>清溪合计</td>
              <td v-for="col in columns" :key="'qx-'+col.field" style="text-align:right;">
                {{ formatSummaryCell(summaryData.regions['清溪'], col) }}
              </td>
            </tr>
            <tr class="total-row">
              <td></td><td></td><td></td>
              <td>总合计</td>
              <td v-for="col in columns" :key="'tt-'+col.field" style="text-align:right;">
                {{ formatSummaryCell(summaryData.total, col) }}
              </td>
            </tr>
          </table>
        </div>
      </div>

      <!-- 新增记录迷你弹窗（只填日期和车间，创建后行内编辑） -->
      <el-dialog v-model="addDialogVisible" title="新增记录" width="320px" destroy-on-close>
        <el-form :model="addForm" label-width="60px" size="default">
          <el-form-item label="日期" required>
            <el-date-picker v-model="addForm.record_date" type="date" placeholder="选择日期"
                             value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
          <el-form-item label="车间" required>
            <el-select v-model="addForm.workshop_id" placeholder="选择车间" style="width:100%">
              <el-option v-for="w in workshopList" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="addDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleAdd" :loading="saving">确认创建</el-button>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      tableData: [],
      loading: false,
      saving: false,
      dateRange: getDefaultDateRange(),
      quickRange: '7d',
      workshopFilter: '',
      selectedRows: [],
      editingCell: { rowId: null, field: null },
      isDragging: false,
      addDialogVisible: false,
      addForm: {},
      newRowId: null,  // 最近新增的行ID，用于高亮显示
      summaryData: null,
      workshopList: [],
      editingDateRowId: null,     // 当前正在编辑日期的行 id
      editingWorkshopRowId: null  // 当前正在编辑车间的行 id
    };
  },
  computed: {
    columns() {
      return getDeptColumns(this.dept);
    },
    editableColumns() {
      return this.columns.filter(c => c.editable);
    }
  },
  watch: {
    dept: {
      handler() {
        this.resetState();
        this.loadWorkshops();
        this.loadData();
      },
      immediate: true
    }
  },
  methods: {
    formatCellValue,
    resetState() {
      this.tableData = [];
      this.selectedRows = [];
      this.editingCell = { rowId: null, field: null };
      this.dateRange = getDefaultDateRange();
      this.quickRange = '7d';
      this.workshopFilter = '';
      this.summaryData = null;
      this.workshopList = [];
    },
    // 三级排序：日期升序 → 车间 sort_order 升序 → id 升序（创建先后）
    sortRecords(records) {
      return [...records].sort((a, b) => {
        if (a.record_date < b.record_date) return -1;
        if (a.record_date > b.record_date) return 1;
        const wa = a.workshop_sort_order ?? 99;
        const wb = b.workshop_sort_order ?? 99;
        if (wa !== wb) return wa - wb;
        return a.id - b.id;
      });
    },
    startEditDate(row) {
      row._editDate = row.record_date;
      this.editingDateRowId = row.id;
    },
    async saveDate(row) {
      // 必填校验
      if (!row._editDate) {
        ElementPlus.ElMessage.warning('日期为必填项，不能清空');
        row._editDate = row.record_date;
        this.editingDateRowId = null;
        return;
      }
      // 值未变化，直接退出
      if (row._editDate === row.record_date) {
        this.editingDateRowId = null;
        return;
      }
      const oldDate = row.record_date;
      this.editingDateRowId = null;
      try {
        await API.put(`/${this.dept}/records/${row.id}`, { record_date: row._editDate });
        row.record_date = row._editDate;
        // 本地重排，行立即移到新日期对应位置
        this.tableData = this.sortRecords(this.tableData);
      } catch (err) {
        row.record_date = oldDate; // 失败恢复原值
        ElementPlus.ElMessage.error('保存日期失败: ' + (err.message || '未知错误'));
      }
    },
    cancelEditDate(row) {
      // 仅在未保存的情况下关闭编辑态（@change 已保存时，此处为 no-op）
      this.editingDateRowId = null;
    },
    startEditWorkshop(row) {
      row._editWorkshopId = row.workshop_id;
      this.editingWorkshopRowId = row.id;
    },
    async saveWorkshop(row) {
      // 必填校验
      if (!row._editWorkshopId) {
        ElementPlus.ElMessage.warning('车间为必填项，不能清空');
        row._editWorkshopId = row.workshop_id;
        this.editingWorkshopRowId = null;
        return;
      }
      // 值未变化，直接退出
      if (row._editWorkshopId === row.workshop_id) {
        this.editingWorkshopRowId = null;
        return;
      }
      const oldId = row.workshop_id;
      const oldName = row.workshop_name;
      const oldSortOrder = row.workshop_sort_order;
      this.editingWorkshopRowId = null;
      try {
        await API.put(`/${this.dept}/records/${row.id}`, { workshop_id: row._editWorkshopId });
        // PUT 接口不返回 workshop_name/sort_order，从本地 workshopList 查找
        const found = this.workshopList.find(w => w.id === row._editWorkshopId);
        if (found) {
          row.workshop_id = found.id;
          row.workshop_name = found.name;
          row.workshop_sort_order = found.sort_order ?? 99;
        }
        // 本地重排
        this.tableData = this.sortRecords(this.tableData);
      } catch (err) {
        row.workshop_id = oldId;
        row.workshop_name = oldName;
        row.workshop_sort_order = oldSortOrder;
        ElementPlus.ElMessage.error('保存车间失败: ' + (err.message || '未知错误'));
      }
    },
    cancelEditWorkshop(row) {
      this.editingWorkshopRowId = null;
    },
    async loadWorkshops() {
      try {
        const res = await API.get('/workshops', { department: this.dept });
        this.workshopList = (res.data || res || []).map(w => ({ id: w.id, name: w.name, region: w.region, company: w.company, sort_order: w.sort_order }));
      } catch (err) { console.error('Failed to load workshops', err); }
    },
    async loadData() {
      this.loading = true;
      try {
        const params = {};
        if (this.dateRange && this.dateRange[0]) {
          params.start_date = this.dateRange[0];
          params.end_date = this.dateRange[1];
        }
        if (this.workshopFilter) params.workshop_id = this.workshopFilter;

        const [recordsRes, summaryRes] = await Promise.all([
          API.get(`/${this.dept}/records`, params),
          API.get(`/${this.dept}/summary`, params)
        ]);

        this.tableData = this.sortRecords(recordsRes.data || recordsRes || []);
        // 将后端返回的扁平数组转换为合计表需要的结构
        const rawSummary = summaryRes.data || summaryRes || [];
        if (Array.isArray(rawSummary) && rawSummary.length > 0) {
          const workshops = {};
          const regions = {};
          const total = {};
          const numFields = this.columns.map(c => c.field);
          // 初始化 total
          numFields.forEach(f => { total[f] = 0; });
          // 按车间分组，按区域汇总
          for (const row of rawSummary) {
            workshops[row.workshop_name] = row;
            // 区域汇总（清溪/邵阳）
            const regionKey = row.region === '湖南' ? '邵阳' : row.region;
            if (!regions[regionKey]) {
              regions[regionKey] = {};
              numFields.forEach(f => { regions[regionKey][f] = 0; });
            }
            numFields.forEach(f => {
              regions[regionKey][f] += parseFloat(row[f]) || 0;
              total[f] += parseFloat(row[f]) || 0;
            });
          }
          // 计算区域和总合计的比例字段
          const calcRatios = (obj) => {
            if (obj.daily_output > 0) {
              obj.balance_ratio = obj.balance / obj.daily_output;
            }
            // 部门独有比例字段由columns中type=ratio的字段决定
            this.columns.forEach(col => {
              if (col.type === 'ratio' && col.formula) {
                // 比例字段不做累加，需要重新计算（暂用balance_ratio兜底）
              }
            });
          };
          Object.values(regions).forEach(calcRatios);
          calcRatios(total);
          this.summaryData = { workshops, regions, total };
        } else {
          this.summaryData = null;
        }
      } catch (err) {
        ElementPlus.ElMessage.error('加载数据失败: ' + (err.message || '未知错误'));
      } finally {
        this.loading = false;
      }
    },
    setQuickRange(type) {
      this.quickRange = type;
      if (type === '7d') {
        this.dateRange = getDefaultDateRange();
      } else if (type === 'month') {
        this.dateRange = getMonthRange(0);
      } else if (type === 'lastMonth') {
        this.dateRange = getMonthRange(-1);
      }
      this.loadData();
    },
    handleSelectionChange(rows) {
      this.selectedRows = rows;
    },
    getRowClass({ row }) {
      return row.id === this.newRowId ? 'new-row-highlight' : '';
    },
    // 表头样式：计算字段列加 th-calc 类
    headerCellClass({ column }) {
      const col = this.columns.find(c => c.field === column.property);
      return col && col.calculated ? 'th-calc' : '';
    },
    isEditing(rowId, field) {
      return this.editingCell.rowId === rowId && this.editingCell.field === field;
    },
    startEdit(row, col) {
      if (!col.editable) return;
      this.editingCell = { rowId: row.id, field: col.field };
      // autofocus 对动态创建的 input 无效，需手动聚焦
      this.$nextTick(() => {
        const input = this.$el.querySelector('.editing-cell-wrapper input');
        if (input) input.focus();
      });
    },
    cancelEdit() {
      this.editingCell = { rowId: null, field: null };
    },
    // 限制输入最多6位小数
    limitDecimals(event) {
      const v = event.target.value;
      const dotIdx = v.indexOf('.');
      if (dotIdx !== -1 && v.length - dotIdx - 1 > 6) {
        event.target.value = v.substring(0, dotIdx + 7);
      }
    },
    // 双击表头显示批注气泡
    showHeaderNote(event, col) {
      // 移除已有气泡
      document.querySelectorAll('.header-note-bubble').forEach(b => b.remove());
      // 构造内容
      let text = col.label;
      if (col.formula) text += '\n公式=' + col.formula;
      const bubble = document.createElement('div');
      bubble.className = 'header-note-bubble';
      let html = '<div class="note-full">' + col.label + '</div>';
      if (col.formula) html += '<div class="note-formula">公式=' + col.formula + '</div>';
      bubble.innerHTML = html;
      // 定位在表头下方
      const th = event.target.closest('th') || event.target;
      const rect = th.getBoundingClientRect();
      bubble.style.position = 'fixed';
      bubble.style.left = rect.left + 'px';
      bubble.style.top = (rect.bottom + 4) + 'px';
      document.body.appendChild(bubble);
      // 8秒后或点击其他地方消失
      const remove = () => { bubble.remove(); document.removeEventListener('click', remove); };
      setTimeout(remove, 8000);
      setTimeout(() => document.addEventListener('click', remove), 100);
    },
    async saveCell(row, field, event) {
      const value = event.target.value;
      this.editingCell = { rowId: null, field: null };
      if (String(row[field]) === String(value)) return;

      const oldValue = row[field];
      row[field] = value;
      try {
        await API.put(`/${this.dept}/records/${row.id}`, { [field]: value });
        await this.loadData();
      } catch (err) {
        row[field] = oldValue;
        ElementPlus.ElMessage.error('保存失败: ' + (err.message || '未知错误'));
      }
    },
    getColumnWidth(col) {
      if (col.field === 'remark') return 120;
      return 90;
    },
    getColumnClass(col) {
      if (col.calculated) return 'cell-calculated';
      if (col.editable) return 'cell-editable';
      return '';
    },
    getCellClasses(row, col) {
      const classes = [];
      if (col.field === 'balance') {
        classes.push('cell-balance');
        if (Number(row.balance) >= 0) classes.push('positive');
        else classes.push('negative');
      }
      return classes;
    },
    formatSummaryCell(data, col) {
      if (!data) return '';
      const val = data[col.field];
      if (col.type === 'ratio') return formatRatio(val);
      if (col.type === 'integer') return formatInteger(val);
      if (col.type === 'number') return formatAmount(val);
      return val || '';
    },
    showAddDialog() {
      // 迷你弹窗只需日期和车间，其他字段创建后行内编辑
      this.addForm = { record_date: formatDate(new Date()), workshop_id: '' };
      this.addDialogVisible = true;
    },
    async handleAdd() {
      if (!this.addForm.record_date || !this.addForm.workshop_id) {
        ElementPlus.ElMessage.warning('请填写日期和车间');
        return;
      }
      this.saving = true;
      try {
        // POST 只发日期和车间，后端会把数值字段默认为 0
        const res = await API.post(`/${this.dept}/records`, this.addForm);
        this.addDialogVisible = false;
        ElementPlus.ElMessage.success('新增成功');
        await this.loadData();
        // 自动进入新行第一个可编辑单元格的编辑模式
        const newId = res.data?.id;
        if (newId) {
          // 高亮新行，3秒后消除
          this.newRowId = newId;
          setTimeout(() => { this.newRowId = null; }, 4000); // 动画3秒，4秒后清除class
          const firstEditable = this.columns.find(c => c.editable);
          if (firstEditable) {
            this.editingCell = { rowId: newId, field: firstEditable.field };
            this.$nextTick(() => {
              const input = this.$el?.querySelector('.editing-cell-wrapper input');
              if (input) input.focus();
            });
          }
        }
      } catch (err) {
        ElementPlus.ElMessage.error('新增失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async handleBatchDelete() {
      if (this.selectedRows.length === 0) return;
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定要删除选中的 ${this.selectedRows.length} 条记录吗？`, '确认删除',
          { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
        );
        const ids = this.selectedRows.map(r => r.id);
        await API.del(`/${this.dept}/records/batch`, { ids });
        ElementPlus.ElMessage.success('删除成功');
        this.selectedRows = [];
        await this.loadData();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || '未知错误'));
        }
      }
    },
    // ENTRY-03: 一键复制行 - 创建与源行日期、车间、所有可编辑字段值相同的新记录
    async handleCopyRow(row) {
      // 收集源行的日期和车间（必填字段）
      const body = {
        record_date: row.record_date,
        workshop_id: row.workshop_id,
      };
      // 遍历可编辑列，复制数值（跳过 record_date 避免重复，跳过已设置的字段）
      for (const col of this.editableColumns) {
        if (col.field !== 'record_date' && body[col.field] === undefined) {
          body[col.field] = row[col.field] ?? 0;
        }
      }

      this.saving = true;
      try {
        const res = await API.post(`/${this.dept}/records`, body);
        ElementPlus.ElMessage.success('复制成功，已生成新行');
        await this.loadData();
        // 高亮新行，复用 newRowId 机制（3秒渐隐动画，4秒后清除class）
        const newId = res.data?.id;
        if (newId) {
          this.newRowId = newId;
          setTimeout(() => { this.newRowId = null; }, 4000);
        }
      } catch (err) {
        ElementPlus.ElMessage.error('复制失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async handleExport() {
      try {
        const params = {};
        if (this.dateRange && this.dateRange[0]) {
          params.start_date = this.dateRange[0];
          params.end_date = this.dateRange[1];
        }
        if (this.workshopFilter) params.workshop_id = this.workshopFilter;
        const deptName = DEPT_CONFIG[this.dept]?.name || this.dept;
        const filename = `${deptName}_${this.dateRange?.[0] || ''}_${this.dateRange?.[1] || ''}.xlsx`;
        await API.download(`/${this.dept}/export`, params, filename);
        ElementPlus.ElMessage.success('导出成功');
      } catch (err) {
        ElementPlus.ElMessage.error('导出失败: ' + (err.message || '未知错误'));
      }
    },
    handleDrop(e) {
      this.isDragging = false;
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.uploadFile(files[0]);
      }
    },
    triggerFileInput() {
      this.$refs.fileInput?.click();
    },
    handleFileSelect(e) {
      const file = e.target.files?.[0];
      if (file) {
        this.uploadFile(file);
        e.target.value = '';
      }
    },
    async uploadFile(file) {
      if (!file.name.match(/\.xlsx?$/i)) {
        ElementPlus.ElMessage.warning('请选择 Excel 文件（.xlsx 或 .xls）');
        return;
      }
      this.loading = true;
      try {
        const res = await API.upload(`/${this.dept}/import`, file);
        const msg = res.message || `导入成功，共 ${res.count || 0} 条`;
        ElementPlus.ElMessage.success(msg);
        // 导入成功后清除日期筛选，显示全部数据，避免导入的数据因日期范围被过滤掉
        this.dateRange = null;
        this.quickRange = '';
        await this.loadData();
      } catch (err) {
        ElementPlus.ElMessage.error('导入失败: ' + (err.message || '未知错误'));
      } finally {
        this.loading = false;
      }
    }
  }
};

// ===== 大车间汇总页组件（双视图：可视化看板 + 汇总表）=====
const SummaryPage = {
  template: `
    <div class="summary-page">
      <!-- 主视图Tab切换 -->
      <div class="main-tab-bar">
        <button class="main-tab-btn" :class="{ active: mainTab === 'dashboard' }" @click="switchMainTab('dashboard')">可视化看板</button>
        <button class="main-tab-btn" :class="{ active: mainTab === 'table' }" @click="switchMainTab('table')">汇总表</button>
      </div>

      <!-- ========== 可视化看板 ========== -->
      <div v-if="mainTab === 'dashboard'" v-loading="loading">
        <!-- 筛选栏 -->
        <div class="toolbar">
          <el-date-picker v-model="dashYear" type="year" placeholder="选择年份" size="small"
            value-format="YYYY" style="width:100px" @change="loadDashboard" />
          <el-select v-model="dashMonth" placeholder="全年" size="small" clearable style="width:100px" @change="loadDashboard">
            <el-option v-for="m in 12" :key="m" :label="m + '月'" :value="m" />
          </el-select>
        </div>

        <!-- 4个指标卡片 -->
        <div class="dashboard-cards">
          <div class="kpi-card">
            <div class="kpi-label">总产值</div>
            <div class="kpi-value">{{ fmtWan(dashData.cards.total_output) }}</div>
            <div class="kpi-change" v-if="dashData.cards.output_change !== null && dashData.cards.output_change !== undefined">
              <span :class="dashData.cards.output_change >= 0 ? 'change-up' : 'change-down'">
                {{ dashData.cards.output_change >= 0 ? '▲' : '▼' }} {{ Math.abs(dashData.cards.output_change * 100).toFixed(1) }}%
              </span>
              <span class="change-label">较{{ dashData.cards.prev_label }}</span>
            </div>
          </div>
          <div class="kpi-card card-expense">
            <div class="kpi-label">总费用</div>
            <div class="kpi-value">{{ fmtWan(dashData.cards.total_expense) }}</div>
            <div class="kpi-change" v-if="dashData.cards.expense_change !== null && dashData.cards.expense_change !== undefined">
              <span :class="dashData.cards.expense_change <= 0 ? 'change-up' : 'change-down'">
                {{ dashData.cards.expense_change >= 0 ? '▲' : '▼' }} {{ Math.abs(dashData.cards.expense_change * 100).toFixed(1) }}%
              </span>
              <span class="change-label">较{{ dashData.cards.prev_label }}</span>
            </div>
          </div>
          <div class="kpi-card card-balance">
            <div class="kpi-label">总结余</div>
            <div class="kpi-value">{{ fmtWan(dashData.cards.total_balance) }}</div>
            <div class="kpi-change" v-if="dashData.cards.balance_change !== null && dashData.cards.balance_change !== undefined">
              <span :class="dashData.cards.balance_change >= 0 ? 'change-up' : 'change-down'">
                {{ dashData.cards.balance_change >= 0 ? '▲' : '▼' }} {{ Math.abs(dashData.cards.balance_change * 100).toFixed(1) }}%
              </span>
              <span class="change-label">较{{ dashData.cards.prev_label }}</span>
            </div>
          </div>
          <div class="kpi-card card-ratio">
            <div class="kpi-label">平均结余率</div>
            <div class="kpi-value">{{ (dashData.cards.avg_ratio * 100).toFixed(1) }}%</div>
            <div class="kpi-change" v-if="dashData.cards.ratio_change !== null && dashData.cards.ratio_change !== undefined">
              <span :class="dashData.cards.ratio_change >= 0 ? 'change-up' : 'change-down'">
                {{ dashData.cards.ratio_change >= 0 ? '▲' : '▼' }} {{ Math.abs(dashData.cards.ratio_change * 100).toFixed(1) }}%
              </span>
              <span class="change-label">较{{ dashData.cards.prev_label }}</span>
            </div>
          </div>
        </div>

        <!-- 图表行：柱状图(60%) + 折线图(40%) -->
        <div class="chart-row">
          <div class="chart-box w60">
            <div class="chart-title">部门产值/费用/结余对比</div>
            <div ref="barChart" style="height:320px;"></div>
          </div>
          <div class="chart-box w40">
            <div class="chart-title">月度结余率趋势</div>
            <div ref="lineChart" style="height:320px;"></div>
          </div>
        </div>

        <!-- 堆叠图（全宽） -->
        <div class="chart-box" style="margin-bottom:16px;">
          <div class="chart-title">月度费用构成</div>
          <div ref="stackChart" style="height:320px;"></div>
        </div>
      </div>

      <!-- ========== 汇总表 ========== -->
      <div v-if="mainTab === 'table'" v-loading="loading">
        <!-- 筛选栏 -->
        <div class="toolbar">
          <el-date-picker v-model="tableMonth" type="month" placeholder="选择月份" size="small"
            value-format="YYYY-MM" @change="loadTableData" style="width:130px" />
          <el-button type="success" size="small" @click="handleTableExport">导出Excel</el-button>
        </div>

        <!-- 子Tab -->
        <div class="summary-tab-bar">
          <button class="summary-tab-btn" :class="{ active: tableTab === 'overview' }" @click="switchTableTab('overview')">总览</button>
          <button class="summary-tab-btn" :class="{ active: tableTab === 'beer' }" @click="switchTableTab('beer')">啤机部</button>
          <button class="summary-tab-btn" :class="{ active: tableTab === 'print' }" @click="switchTableTab('print')">印喷部</button>
          <button class="summary-tab-btn" :class="{ active: tableTab === 'assembly' }" @click="switchTableTab('assembly')">装配部</button>
        </div>

        <!-- 总览表格 -->
        <template v-if="tableTab === 'overview' && tableData.rows">
          <table class="summary-detail-table">
            <thead>
              <tr>
                <th style="text-align:left; width:100px;">分类</th>
                <th style="text-align:left; width:140px;">项目</th>
                <th>啤机部</th>
                <th>印喷部</th>
                <th>装配部</th>
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in tableData.rows" :key="idx"
                :class="{ 'total-row': row.field === '_expense_total', 'balance-row': row.category === '结余' }">
                <td class="cat-cell">{{ row.category }}</td>
                <td>{{ row.label }}</td>
                <td :class="balanceCls(row, 'beer')">{{ fmtCell(row, 'beer') }}</td>
                <td :class="balanceCls(row, 'print')">{{ fmtCell(row, 'print') }}</td>
                <td :class="balanceCls(row, 'assembly')">{{ fmtCell(row, 'assembly') }}</td>
                <td :class="balanceCls(row, 'total')" style="font-weight:600;">{{ fmtCell(row, 'total') }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- 部门明细表格 -->
        <template v-if="tableTab !== 'overview' && tableData.workshops">
          <table class="summary-detail-table">
            <thead>
              <tr>
                <th style="text-align:left; width:100px;">分类</th>
                <th style="text-align:left; width:140px;">项目</th>
                <th v-for="ws in tableData.workshops" :key="ws">{{ ws }}</th>
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in tableData.rows" :key="idx">
                <td class="cat-cell">{{ row.category }}</td>
                <td>{{ row.label }}</td>
                <td v-for="ws in tableData.workshops" :key="ws">{{ fmtVal(row.values[ws]) }}</td>
                <td style="font-weight:600;">{{ fmtVal(row.total) }}</td>
              </tr>
              <!-- 费用总计行 -->
              <tr class="total-row">
                <td class="cat-cell">合计</td>
                <td>费用总计</td>
                <td v-for="ws in tableData.workshops" :key="ws">{{ fmtVal(tableData.expense_total[ws]) }}</td>
                <td style="font-weight:600;">{{ fmtVal(tableData.expense_total.total) }}</td>
              </tr>
              <!-- 结余行 -->
              <tr class="balance-row">
                <td class="cat-cell">结余</td>
                <td>结余</td>
                <td v-for="ws in tableData.workshops" :key="ws" :class="tableData.balance[ws] >= 0 ? 'balance-positive' : 'balance-negative'">
                  {{ fmtVal(tableData.balance[ws]) }}
                </td>
                <td :class="tableData.balance.total >= 0 ? 'balance-positive' : 'balance-negative'" style="font-weight:600;">
                  {{ fmtVal(tableData.balance.total) }}
                </td>
              </tr>
              <!-- 结余率行 -->
              <tr class="balance-row">
                <td class="cat-cell">结余</td>
                <td>结余率</td>
                <td v-for="ws in tableData.workshops" :key="ws">{{ (tableData.balance_ratio[ws] * 100).toFixed(1) }}%</td>
                <td style="font-weight:600;">{{ (tableData.balance_ratio.total * 100).toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- 无数据提示 -->
        <div v-if="!tableData.rows && !tableData.workshops" style="text-align:center; padding:40px; color:#999;">
          暂无数据，请选择月份
        </div>
      </div>
    </div>
  `,
  data() {
    const now = new Date();
    return {
      // 主视图切换
      mainTab: 'dashboard',
      loading: false,
      // 看板数据
      dashYear: String(now.getFullYear()),
      dashMonth: null,
      dashData: { cards: { total_output: 0, total_expense: 0, total_balance: 0, avg_ratio: 0 }, departments: [], monthly_trend: [], expense_breakdown: [] },
      // 图表实例
      barChartInstance: null,
      lineChartInstance: null,
      stackChartInstance: null,
      // 汇总表数据
      tableMonth: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'),
      tableTab: 'overview',
      tableData: {}
    };
  },
  mounted() {
    this.loadDashboard();
    // 监听窗口resize，图表自适应
    this._resizeHandler = () => this.handleResize();
    window.addEventListener('resize', this._resizeHandler);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this._resizeHandler);
    // 销毁ECharts实例
    if (this.barChartInstance) this.barChartInstance.dispose();
    if (this.lineChartInstance) this.lineChartInstance.dispose();
    if (this.stackChartInstance) this.stackChartInstance.dispose();
  },
  methods: {
    formatAmount,
    formatRatio,
    // 金额格式化为"万"单位
    fmtWan(val) {
      if (!val || val === 0) return '0';
      if (Math.abs(val) >= 10000) return (val / 10000).toFixed(1) + '万';
      return val.toFixed(0);
    },
    // 汇总表单元格格式化
    fmtCell(row, key) {
      const val = row[key];
      if (val === null || val === undefined) return '—';
      if (row.field === 'balance_ratio') return (val * 100).toFixed(1) + '%';
      return this.fmtVal(val);
    },
    fmtVal(val) {
      if (val === null || val === undefined) return '—';
      if (typeof val !== 'number') return val;
      return val.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    },
    // 结余行颜色class
    balanceCls(row, key) {
      if (row.field !== 'balance') return '';
      const val = row[key];
      if (val === null || val === undefined) return '';
      return val >= 0 ? 'balance-positive' : 'balance-negative';
    },

    // ===== 主Tab切换 =====
    switchMainTab(tab) {
      this.mainTab = tab;
      if (tab === 'dashboard') {
        this.$nextTick(() => this.initCharts());
      } else if (tab === 'table') {
        this.loadTableData();
      }
    },

    // ===== 看板 =====
    async loadDashboard() {
      this.loading = true;
      try {
        const params = { year: this.dashYear };
        if (this.dashMonth) params.month = this.dashMonth;
        const res = await API.getSummaryDashboard(params);
        this.dashData = res.data;
        this.$nextTick(() => this.initCharts());
      } catch (err) {
        ElementPlus.ElMessage.error('加载看板数据失败: ' + (err.message || '未知错误'));
      } finally {
        this.loading = false;
      }
    },

    initCharts() {
      if (typeof echarts === 'undefined') return;
      const d = this.dashData;

      // === 柱状图：部门对比 ===
      if (this.$refs.barChart) {
        if (!this.barChartInstance) this.barChartInstance = echarts.init(this.$refs.barChart);
        this.barChartInstance.setOption({
          color: ['#7F41C0', '#E88EA0', '#57B894'],
          tooltip: { trigger: 'axis', valueFormatter: v => '¥' + (v / 10000).toFixed(1) + '万' },
          legend: { data: ['产值', '费用', '结余'] },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: { type: 'category', data: d.departments.map(dp => dp.label) },
          yAxis: { type: 'value', axisLabel: { formatter: v => (v / 10000) + '万' } },
          series: [
            { name: '产值', type: 'bar', data: d.departments.map(dp => dp.output) },
            { name: '费用', type: 'bar', data: d.departments.map(dp => dp.expense) },
            { name: '结余', type: 'bar', data: d.departments.map(dp => dp.balance) }
          ]
        });
      }

      // === 折线图：月度结余率趋势 ===
      if (this.$refs.lineChart) {
        if (!this.lineChartInstance) this.lineChartInstance = echarts.init(this.$refs.lineChart);
        const months = d.monthly_trend.map((_, i) => (i + 1) + '月');
        this.lineChartInstance.setOption({
          color: ['#7F41C0', '#5B9BD5', '#57B894'],
          tooltip: { trigger: 'axis', valueFormatter: v => (v * 100).toFixed(1) + '%' },
          legend: { data: ['啤机部', '印喷部', '装配部'] },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: { type: 'category', data: months },
          yAxis: { type: 'value', axisLabel: { formatter: v => (v * 100) + '%' } },
          series: [
            { name: '啤机部', type: 'line', smooth: true, data: d.monthly_trend.map(m => m.beer_ratio) },
            { name: '印喷部', type: 'line', smooth: true, data: d.monthly_trend.map(m => m.print_ratio) },
            { name: '装配部', type: 'line', smooth: true, data: d.monthly_trend.map(m => m.assembly_ratio) }
          ]
        });
      }

      // === 堆叠图：费用构成 ===
      if (this.$refs.stackChart) {
        if (!this.stackChartInstance) this.stackChartInstance = echarts.init(this.$refs.stackChart);
        const months = d.expense_breakdown.map((_, i) => (i + 1) + '月');
        const catNames = { wage: '工资', rent_utility: '房租水电', insurance_tax: '社保税收', repair_material: '维修物料', process_mold: '加工模费', other: '其他' };
        const catColors = ['#7F41C0', '#9B6DC6', '#5B9BD5', '#57B894', '#E88EA0', '#FFB74D'];
        const series = Object.keys(catNames).map((cat, i) => ({
          name: catNames[cat], type: 'bar', stack: 'expense',
          itemStyle: { color: catColors[i] },
          data: d.expense_breakdown.map(m => m[cat] || 0)
        }));
        this.stackChartInstance.setOption({
          tooltip: { trigger: 'axis', valueFormatter: v => '¥' + (v / 10000).toFixed(1) + '万' },
          legend: { data: Object.values(catNames) },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: { type: 'category', data: months },
          yAxis: { type: 'value', axisLabel: { formatter: v => (v / 10000) + '万' } },
          series
        });
      }
    },

    handleResize() {
      if (this.barChartInstance) this.barChartInstance.resize();
      if (this.lineChartInstance) this.lineChartInstance.resize();
      if (this.stackChartInstance) this.stackChartInstance.resize();
    },

    // ===== 汇总表 =====
    switchTableTab(tab) {
      this.tableTab = tab;
      this.loadTableData();
    },

    async loadTableData() {
      if (!this.tableMonth) return;
      this.loading = true;
      try {
        const [y, m] = this.tableMonth.split('-').map(Number);
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0);
        const params = {
          start_date: formatDate(start),
          end_date: formatDate(end)
        };
        if (this.tableTab !== 'overview') params.dept = this.tableTab;
        const res = await API.getSummaryDetail(params);
        this.tableData = res.data;
      } catch (err) {
        ElementPlus.ElMessage.error('加载汇总表失败: ' + (err.message || '未知错误'));
      } finally {
        this.loading = false;
      }
    },

    // ===== 导出Excel =====
    handleTableExport() {
      try {
        const rows = [];
        if (this.tableTab === 'overview' && this.tableData.rows) {
          // 总览模式
          for (const r of this.tableData.rows) {
            rows.push({
              '分类': r.category, '项目': r.label,
              '啤机部': r.field === 'balance_ratio' ? (r.beer != null ? (r.beer * 100).toFixed(1) + '%' : '') : (r.beer ?? ''),
              '印喷部': r.field === 'balance_ratio' ? (r.print != null ? (r.print * 100).toFixed(1) + '%' : '') : (r.print ?? ''),
              '装配部': r.field === 'balance_ratio' ? (r.assembly != null ? (r.assembly * 100).toFixed(1) + '%' : '') : (r.assembly ?? ''),
              '合计': r.field === 'balance_ratio' ? (r.total * 100).toFixed(1) + '%' : (r.total ?? '')
            });
          }
        } else if (this.tableData.workshops) {
          // 部门明细模式
          const ws = this.tableData.workshops;
          for (const r of this.tableData.rows) {
            const row = { '分类': r.category, '项目': r.label };
            ws.forEach(w => { row[w] = r.values[w] ?? ''; });
            row['合计'] = r.total ?? '';
            rows.push(row);
          }
          // 费用总计
          const expRow = { '分类': '合计', '项目': '费用总计' };
          ws.forEach(w => { expRow[w] = this.tableData.expense_total[w] ?? ''; });
          expRow['合计'] = this.tableData.expense_total.total ?? '';
          rows.push(expRow);
          // 结余
          const balRow = { '分类': '结余', '项目': '结余' };
          ws.forEach(w => { balRow[w] = this.tableData.balance[w] ?? ''; });
          balRow['合计'] = this.tableData.balance.total ?? '';
          rows.push(balRow);
          // 结余率
          const ratioRow = { '分类': '结余', '项目': '结余率' };
          ws.forEach(w => { ratioRow[w] = (this.tableData.balance_ratio[w] * 100).toFixed(1) + '%'; });
          ratioRow['合计'] = (this.tableData.balance_ratio.total * 100).toFixed(1) + '%';
          rows.push(ratioRow);
        }
        if (rows.length === 0) { ElementPlus.ElMessage.warning('无数据可导出'); return; }
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        const tabLabel = this.tableTab === 'overview' ? '总览' : { beer: '啤机部', print: '印喷部', assembly: '装配部' }[this.tableTab];
        XLSX.utils.book_append_sheet(wb, ws, tabLabel);
        XLSX.writeFile(wb, `大车间汇总_${tabLabel}_${this.tableMonth}.xlsx`);
        ElementPlus.ElMessage.success('导出成功');
      } catch (err) {
        ElementPlus.ElMessage.error('导出失败: ' + (err.message || '未知错误'));
      }
    }
  }
};

// ===== 用户管理页组件 =====
const UserManagementPage = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div class="user-management-page settings-card">
      <div class="card-top">
        <h3><span class="title-dot" style="background:#5B9BD5;"></span> 用户管理</h3>
        <button v-if="!readonly" class="btn-pill info" @click="showAddUserDialog">+ 新增用户</button>
      </div>

      <!-- 统计药片 -->
      <div class="stat-pills">
        <div class="stat-pill" style="background:#f3edf7; color:#7F41C0;">
          <span>统计组</span> <span class="stat-num">{{ users.filter(u => u.role === 'stats').length }}</span>
        </div>
        <div class="stat-pill" style="background:#fff3e0; color:#e65100;">
          <span>管理层</span> <span class="stat-num">{{ users.filter(u => u.role === 'management').length }}</span>
        </div>
        <div class="stat-pill" style="background:#e3f2fd; color:#5B9BD5;">
          <span>录入员</span> <span class="stat-num">{{ users.filter(u => u.role === 'entry').length }}</span>
        </div>
        <div class="stat-pill" style="background:#e8f5e9; color:#3D8361;">
          <span>已启用</span> <span class="stat-num">{{ users.filter(u => u.status === 'active').length }}</span>
        </div>
        <div class="stat-pill" style="background:#fce4ec; color:#c91d32;">
          <span>已禁用</span> <span class="stat-num">{{ users.filter(u => u.status !== 'active').length }}</span>
        </div>
      </div>

      <div v-loading="loading">
        <table class="pretty-table">
          <thead>
            <tr>
              <th style="width:40px;"></th>
              <th>用户</th>
              <th>角色</th>
              <th>部门</th>
              <th>状态</th>
              <th>批量权限</th>
              <th v-if="!readonly" style="width:240px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in users" :key="row.id" :class="{ 'row-disabled': row.status !== 'active' }">
              <td>
                <div class="user-avatar" :style="{ background: row.status !== 'active' ? '#ccc' : (row.role === 'stats' ? '#7F41C0' : row.role === 'management' ? '#F0A868' : '#5B9BD5') }">
                  {{ (row.name || row.username || '?').charAt(0) }}
                </div>
              </td>
              <td>
                <div style="font-weight:600;">{{ row.username }}</div>
                <div style="font-size:12px; color:#999;">{{ row.name }}</div>
              </td>
              <td><span class="pill-badge" :class="row.role === 'stats' ? 'purple' : row.role === 'management' ? 'orange' : 'blue'">{{ getRoleName(row.role) }}</span></td>
              <td>
                <span v-if="row.department" class="pill-badge" :class="deptBadge(row.department)">{{ ALL_DEPARTMENTS[row.department] || row.department }}</span>
                <span v-else style="color:#ccc;">—</span>
              </td>
              <td><span class="pill-badge" :class="row.status === 'active' ? 'green' : 'pink'">{{ row.status === 'active' ? '启用' : '禁用' }}</span></td>
              <td>
                <span v-if="row.role === 'stats'" class="pill-badge purple">全部权限</span>
                <span v-else-if="row.role === 'management'" class="pill-badge orange">查看/编辑</span>
                <span v-else class="pill-badge" :class="row.batch_permission ? 'green' : 'gray'">{{ row.batch_permission ? '是' : '否' }}</span>
              </td>
              <td v-if="!readonly">
                <button class="btn-pill ghost sm" @click="showEditUserDialog(row)">编辑</button>
                <button class="btn-pill sm" style="background:transparent; color:#F0A868; border:1.5px solid #F0A868;" @click="showResetPasswordDialog(row)">重置密码</button>
                <button v-if="row.status === 'active'" class="btn-pill sm" style="background:transparent; color:#E88EA0; border:1.5px solid #E88EA0;" @click="toggleUserStatus(row)">禁用</button>
                <button v-else class="btn-pill sm" style="background:transparent; color:#57B894; border:1.5px solid #57B894;" @click="toggleUserStatus(row)">启用</button>
                <button v-if="row.role !== 'stats' && row.role !== 'management'" class="btn-pill sm" style="background:transparent; color:#7F41C0; border:1.5px solid #7F41C0;" @click="showModuleDialog(row)">授权</button>
                <button v-if="currentUserRole === 'stats' && row.username !== currentUsername" class="btn-pill sm" style="background:transparent; color:#c91d32; border:1.5px solid #c91d32;" @click="handleDeleteUser(row)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 新增用户对话框 -->
      <el-dialog v-model="addUserVisible" title="新增用户" width="480px" destroy-on-close>
        <el-form :model="userForm" label-width="90px" size="default">
          <el-form-item label="用户名" required>
            <el-input v-model="userForm.username" placeholder="请输入用户名" />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="userForm.name" placeholder="请输入姓名" />
          </el-form-item>
          <el-form-item label="密码" required>
            <el-input v-model="userForm.password" type="password" placeholder="请输入密码" show-password />
          </el-form-item>
          <el-form-item label="角色" required>
            <el-select v-model="userForm.role" style="width:100%">
              <el-option label="统计组" value="stats" />
              <el-option label="管理层" value="management" />
              <el-option label="录入员" value="entry" />
            </el-select>
          </el-form-item>
          <!-- BUG-09: 硬编码部门下拉改为动态生成 -->
          <el-form-item label="部门">
            <el-select v-model="userForm.department" clearable style="width:100%">
              <el-option v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="addUserVisible = false">取消</el-button>
          <el-button type="primary" @click="handleAddUser" :loading="saving">保存</el-button>
        </template>
      </el-dialog>

      <!-- 编辑用户对话框 -->
      <el-dialog v-model="editUserVisible" title="编辑用户" width="480px" destroy-on-close>
        <el-form :model="editForm" label-width="90px" size="default">
          <el-form-item label="用户名">
            <el-input v-model="editForm.username" disabled />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="editForm.name" placeholder="请输入姓名" />
          </el-form-item>
          <el-form-item label="角色" required>
            <el-select v-model="editForm.role" style="width:100%">
              <el-option label="统计组" value="stats" />
              <el-option label="管理层" value="management" />
              <el-option label="录入员" value="entry" />
            </el-select>
          </el-form-item>
          <!-- BUG-09: 硬编码部门下拉改为动态生成 -->
          <el-form-item label="部门">
            <el-select v-model="editForm.department" clearable style="width:100%">
              <el-option v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="editUserVisible = false">取消</el-button>
          <el-button type="primary" @click="handleEditUser" :loading="saving">保存</el-button>
        </template>
      </el-dialog>

      <!-- 重置密码对话框 -->
      <el-dialog v-model="resetPwdVisible" title="重置密码" width="400px" destroy-on-close>
        <el-form :model="resetPwdForm" label-width="80px" size="default">
          <el-form-item label="用户">
            <el-input :model-value="resetPwdForm.username" disabled />
          </el-form-item>
          <el-form-item label="新密码" required>
            <el-input v-model="resetPwdForm.password" type="password" placeholder="请输入新密码" show-password />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="resetPwdVisible = false">取消</el-button>
          <el-button type="primary" @click="handleResetPassword" :loading="saving">确认重置</el-button>
        </template>
      </el-dialog>

      <!-- 模块授权对话框 -->
      <el-dialog v-model="moduleDialogVisible" title="模块授权" width="400px" destroy-on-close>
        <p style="margin-bottom:16px; color:var(--text-secondary);">为 <strong>{{ moduleForm.name }}</strong> 分配可访问的模块：</p>
        <el-checkbox-group v-model="moduleForm.modules">
          <div style="display:flex; flex-direction:column; gap:10px;">
            <el-checkbox label="beer">啤机部</el-checkbox>
            <el-checkbox label="print">印喷部</el-checkbox>
            <el-checkbox label="assembly">装配部</el-checkbox>
            <el-checkbox label="summary">三工汇总</el-checkbox>
          </div>
        </el-checkbox-group>
        <template #footer>
          <el-button @click="moduleDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSaveModules" :loading="saving">保存</el-button>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      users: [],
      loading: false,
      saving: false,
      addUserVisible: false,
      editUserVisible: false,
      resetPwdVisible: false,
      moduleDialogVisible: false,
      userForm: { username: '', name: '', password: '', role: 'entry', department: '' },
      editForm: { id: null, username: '', name: '', role: '', department: '' },
      resetPwdForm: { id: null, username: '', password: '' },
      moduleForm: { id: null, name: '', modules: [] },
      ALL_DEPARTMENTS, // BUG-09: 暴露部门映射供模板动态渲染
      currentUserRole: JSON.parse(localStorage.getItem('user') || '{}').role || '',
      currentUsername: JSON.parse(localStorage.getItem('user') || '{}').username || ''
    };
  },
  created() {
    this.loadUsers();
  },
  methods: {
    getRoleName,
    deptBadge(dept) {
      if (dept === 'beer') return 'purple';
      if (dept === 'print') return 'blue';
      if (dept === 'assembly') return 'teal';
      return 'gray';
    },
    async loadUsers() {
      this.loading = true;
      try {
        const res = await API.get('/users');
        this.users = res.data || res || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载用户列表失败');
      } finally {
        this.loading = false;
      }
    },
    showAddUserDialog() {
      this.userForm = { username: '', name: '', password: '', role: 'entry', department: '' };
      this.addUserVisible = true;
    },
    async handleAddUser() {
      if (!this.userForm.username || !this.userForm.name || !this.userForm.password) {
        ElementPlus.ElMessage.warning('请填写必填项');
        return;
      }
      this.saving = true;
      try {
        await API.post('/users', this.userForm);
        this.addUserVisible = false;
        ElementPlus.ElMessage.success('新增成功');
        await this.loadUsers();
      } catch (err) {
        ElementPlus.ElMessage.error('新增失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    showEditUserDialog(row) {
      this.editForm = { id: row.id, username: row.username, name: row.name, role: row.role, department: row.department || '' };
      this.editUserVisible = true;
    },
    async handleEditUser() {
      if (!this.editForm.name) {
        ElementPlus.ElMessage.warning('请填写姓名');
        return;
      }
      this.saving = true;
      try {
        await API.put(`/users/${this.editForm.id}`, {
          name: this.editForm.name,
          role: this.editForm.role,
          department: this.editForm.department
        });
        this.editUserVisible = false;
        ElementPlus.ElMessage.success('编辑成功');
        await this.loadUsers();
      } catch (err) {
        ElementPlus.ElMessage.error('编辑失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    showResetPasswordDialog(row) {
      this.resetPwdForm = { id: row.id, username: row.username, password: '' };
      this.resetPwdVisible = true;
    },
    async handleResetPassword() {
      if (!this.resetPwdForm.password) {
        ElementPlus.ElMessage.warning('请输入新密码');
        return;
      }
      this.saving = true;
      try {
        await API.put(`/users/${this.resetPwdForm.id}/password`, { password: this.resetPwdForm.password });
        this.resetPwdVisible = false;
        ElementPlus.ElMessage.success('密码重置成功');
      } catch (err) {
        ElementPlus.ElMessage.error('重置密码失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async toggleUserStatus(row) {
      const newStatus = row.status === 'active' ? 'disabled' : 'active';
      try {
        await API.put(`/users/${row.id}/status`, { status: newStatus });
        ElementPlus.ElMessage.success(newStatus === 'active' ? '已启用' : '已禁用');
        await this.loadUsers();
      } catch (err) {
        ElementPlus.ElMessage.error('操作失败: ' + (err.message || '未知错误'));
      }
    },
    showModuleDialog(row) {
      this.moduleForm = { id: row.id, name: row.name, modules: row.modules ? [...row.modules] : [] };
      this.moduleDialogVisible = true;
    },
    async handleSaveModules() {
      this.saving = true;
      try {
        await API.put(`/users/${this.moduleForm.id}/modules`, { modules: this.moduleForm.modules });
        this.moduleDialogVisible = false;
        ElementPlus.ElMessage.success('模块授权保存成功');
        await this.loadUsers();
      } catch (err) {
        ElementPlus.ElMessage.error('保存失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async handleDeleteUser(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定要永久删除用户 "${row.name || row.username}" 吗？此操作不可恢复！`,
          '确认删除用户',
          { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' }
        );
        await API.del(`/users/${row.id}`);
        ElementPlus.ElMessage.success('用户已删除');
        await this.loadUsers();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || '未知错误'));
        }
      }
    }
  }
};

// ===== 设置页组件 =====
const SettingsPage = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div class="settings-page">
      <!-- 只读提示 -->
      <div v-if="readonly" style="background:#fff3e0; color:#e65100; padding:8px 16px; border-radius:8px; margin-bottom:12px; font-size:13px;">
        当前为只读模式，管理层仅可查看系统设置，无法修改。
      </div>
      <!-- 药片Tab栏 -->
      <div class="settings-pill-tabs">
        <button v-for="tab in tabs" :key="tab.key"
          class="pill-tab" :class="{ ['active-' + tab.key]: activeTab === tab.key }"
          @click="activeTab = tab.key">
          <span>{{ tab.icon }}</span> {{ tab.label }}
        </button>
      </div>
      <!-- 内容面板 -->
      <formula-config v-if="activeTab === 'formulas'" :readonly="readonly" />
      <workshop-settings v-else-if="activeTab === 'workshops'" :readonly="readonly" />
      <user-management-page v-else-if="activeTab === 'users'" :readonly="readonly" />
      <data-locks v-else-if="activeTab === 'locks'" :readonly="readonly" />
      <audit-logs v-else-if="activeTab === 'logs'" />
      <backup-page v-else-if="activeTab === 'backup'" :readonly="readonly" />
    </div>
  `,
  data() {
    return {
      activeTab: 'formulas',
      tabs: [
        { key: 'formulas', label: '公式配置', icon: 'fx' },
        { key: 'workshops', label: '车间管理', icon: '🏭' },
        { key: 'users', label: '用户管理', icon: '👥' },
        { key: 'locks', label: '数据锁定', icon: '🔒' },
        { key: 'logs', label: '操作日志', icon: '📝' },
        { key: 'backup', label: '数据备份', icon: '💾' }
      ]
    };
  }
};

// ===== 公式配置子组件 =====
const FormulaConfig = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div>
      <!-- 顶部选择栏 -->
      <div style="display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
        <span style="font-size:14px; color:#666;">部门：</span>
        <el-radio-group v-model="currentDept" size="default" @change="loadFormulas">
          <el-radio-button v-for="(label, key) in BALANCE_DEPARTMENTS" :key="key" :value="key">{{ label }}</el-radio-button>
        </el-radio-group>
        <div style="flex:1"></div>
        <template v-if="!readonly">
          <el-button size="default" @click="showConstantsDialog" style="background:#5B9BD5; border-color:#5B9BD5; color:#fff;">常量配置</el-button>
          <el-button type="success" size="default" @click="showRecalcDialog" style="background:#57B894; border-color:#57B894;">重算历史</el-button>
          <el-button type="primary" size="default" @click="showAddDialog">新增公式</el-button>
        </template>
      </div>

      <!-- 公式卡片列表 -->
      <div v-loading="loading" style="min-height:200px;">
        <div v-if="formulas.length === 0 && !loading" style="text-align:center; color:#999; padding:40px;">
          暂无公式配置，请点击"新增公式"添加
        </div>
        <div ref="formulaList" style="display:flex; flex-direction:column; gap:12px;">
          <div v-for="f in formulas" :key="f.id" class="formula-card"
               :style="{ opacity: f.enabled ? 1 : 0.5, border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', background: '#fff' }">
            <div style="display:flex; align-items:center; gap:12px;">
              <span class="drag-handle" style="cursor:grab; font-size:18px; color:#999;">≡</span>
              <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                  <span style="font-weight:600; font-size:15px;">{{ f.field_label }}</span>
                  <el-tag size="small" type="info">{{ f.field_key }}</el-tag>
                  <el-tag size="small" :type="f.display_format === 'percent' ? 'warning' : (f.display_format === 'currency' ? 'success' : '')">
                    {{ {number:'数字', percent:'百分比', currency:'金额'}[f.display_format] || f.display_format }}
                  </el-tag>
                  <el-tag v-if="!f.enabled" size="small" type="danger">已禁用</el-tag>
                </div>
                <!-- 可视化公式展示 -->
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
                  <template v-for="(token, idx) in parseFormulaTokens(f.formula_text)" :key="idx">
                    <span v-if="token.type === 'field'" style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:12px;"
                          :style="getFieldPillStyle(token.value)">
                      {{ getFieldLabel(token.value) }}
                    </span>
                    <span v-else-if="token.type === 'op'" style="display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; background:#7F41C0; color:#fff; font-size:14px; font-weight:bold;">
                      {{ token.value }}
                    </span>
                    <span v-else-if="token.type === 'func'" style="display:inline-block; padding:2px 8px; border-radius:12px; background:#e0f2f1; border:1px solid #80cbc4; font-size:12px; color:#00695c; font-weight:600;">
                      {{ token.value }}
                    </span>
                    <span v-else-if="token.type === 'const'" style="display:inline-block; padding:2px 8px; border-radius:12px; background:#fff8e1; border:1px solid #ffe082; font-size:12px; color:#f57f17; font-weight:600;">
                      {{ '$' + token.value }}
                    </span>
                    <span v-else style="font-size:13px; color:#666;">{{ token.value }}</span>
                  </template>
                </div>
                <div style="margin-top:4px; font-size:12px; color:#999;">{{ f.formula_text }}</div>
              </div>
              <div v-if="!readonly" style="display:flex; gap:8px;">
                <el-button size="small" @click="showEditDialog(f)">编辑</el-button>
                <el-button size="small" :type="f.enabled ? 'warning' : 'success'" plain @click="toggleEnabled(f)">
                  {{ f.enabled ? '禁用' : '启用' }}
                </el-button>
                <el-button size="small" type="danger" plain @click="handleDelete(f)" style="color:#E88EA0;">删除</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 编辑弹窗 -->
      <el-dialog v-model="editVisible" :title="isEdit ? '编辑公式' : '新增公式'" width="720px" destroy-on-close>
        <el-form :model="form" label-width="100px" size="default">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="公式名称" required>
                <el-input v-model="form.field_label" placeholder="如：结余金额" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="字段名" required>
                <el-select v-model="form.field_key" style="width:100%" placeholder="搜索或选择字段" :disabled="isEdit" filterable @change="onFieldKeyChange">
                  <el-option-group v-for="g in allFieldOptions" :key="g.label" :label="g.label">
                    <el-option v-for="f in g.options" :key="f.field_key"
                      :label="f.field_key + '（' + f.field_label + ' · ' + f.typeLabel + '）'" :value="f.field_key" />
                  </el-option-group>
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="显示格式">
                <el-select v-model="form.display_format" style="width:100%">
                  <el-option label="数字" value="number" />
                  <el-option label="百分比" value="percent" />
                  <el-option label="金额" value="currency" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="小数位数">
                <el-input-number v-model="form.decimal_places" :min="0" :max="6" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>

          <!-- 模式切换 -->
          <div style="margin-bottom:12px; display:flex; gap:8px;">
            <el-button :type="editMode === 'visual' ? 'primary' : 'default'" size="small" @click="editMode = 'visual'"
                       :style="editMode === 'visual' ? 'background:#7F41C0; border-color:#7F41C0;' : ''">可视化模式</el-button>
            <el-button :type="editMode === 'text' ? 'primary' : 'default'" size="small" @click="editMode = 'text'"
                       :style="editMode === 'text' ? 'background:#7F41C0; border-color:#7F41C0;' : ''">文本模式</el-button>
          </div>

          <!-- 可视化编辑区 -->
          <div v-if="editMode === 'visual'">
            <!-- 公式展示区 -->
            <div style="min-height:48px; padding:12px; border:2px dashed #7F41C0; border-radius:8px; margin-bottom:12px; display:flex; flex-wrap:wrap; align-items:center; gap:6px; background:#faf5ff;">
              <span v-if="formulaTokens.length === 0" style="color:#999;">点击下方字段或运算符构建公式</span>
              <template v-for="(token, idx) in formulaTokens" :key="idx">
                <span v-if="token.type === 'field'" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; font-size:13px;"
                      :style="getFieldPillStyle(token.value)">
                  {{ getFieldLabel(token.value) }}
                  <span style="cursor:pointer; margin-left:2px; font-size:11px;" @click="removeToken(idx)">&times;</span>
                </span>
                <span v-else-if="token.type === 'op'" style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:#7F41C0; color:#fff; font-size:16px; font-weight:bold; cursor:pointer;" @click="removeToken(idx)">
                  {{ token.value }}
                </span>
                <span v-else-if="token.type === 'func'" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; background:#e0f2f1; border:1px solid #80cbc4; font-size:13px; color:#00695c; font-weight:600; cursor:pointer;" @click="removeToken(idx)">
                  {{ token.value }}
                  <span style="font-size:11px;">&times;</span>
                </span>
                <span v-else-if="token.type === 'const'" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; background:#fff8e1; border:1px solid #ffe082; font-size:13px; color:#f57f17; font-weight:600; cursor:pointer;" @click="removeToken(idx)">
                  {{ '$' + token.value }}
                  <span style="font-size:11px;">&times;</span>
                </span>
                <span v-else style="font-size:14px; color:#666; cursor:pointer;" @click="removeToken(idx)">{{ token.value }}</span>
              </template>
            </div>

            <!-- 运算符按钮 -->
            <div style="display:flex; gap:8px; margin-bottom:12px;">
              <el-button v-for="op in ['+', '−', '×', '÷', '(', ')']" :key="op" size="small" circle
                         style="background:#7F41C0; color:#fff; border-color:#7F41C0; font-size:16px; font-weight:bold;"
                         @click="addOperator(op)">{{ op }}</el-button>
              <el-button size="small" style="background:#00695c; color:#fff; border-color:#00695c;" @click="addSumFunction">SUM()</el-button>
            </div>

            <!-- 字段选择面板 -->
            <div style="border:1px solid var(--border-color); border-radius:8px; max-height:300px; overflow-y:auto;">
              <div style="padding:8px;">
                <el-input v-model="fieldSearch" placeholder="搜索字段..." size="small" clearable prefix-icon="Search" />
              </div>
              <!-- 共享输入字段 -->
              <div>
                <div style="padding:6px 12px; background:#f5f0fa; border-bottom:1px solid #e0d4f0; font-weight:600; font-size:13px; display:flex; justify-content:space-between;">
                  <span>共享输入字段</span>
                  <span style="color:#999;">{{ filteredSharedInputFields.length }}</span>
                </div>
                <div style="padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span v-for="f in filteredSharedInputFields" :key="f.field"
                        style="display:inline-block; padding:3px 10px; border-radius:14px; cursor:pointer; font-size:12px; background:#e8f5e9; border:1px solid #c8e6c9; color:#2e7d32;"
                        @click="addFieldToken(f.field)">{{ f.label || f.shortLabel }}</span>
                </div>
              </div>
              <!-- 费用字段 -->
              <div>
                <div style="padding:6px 12px; background:#fdf0f0; border-bottom:1px solid #f0d4d4; font-weight:600; font-size:13px; display:flex; justify-content:space-between;">
                  <span>费用字段</span>
                  <span style="color:#999;">{{ filteredExpenseFields.length }}</span>
                </div>
                <div style="padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span v-for="f in filteredExpenseFields" :key="f.field"
                        style="display:inline-block; padding:3px 10px; border-radius:14px; cursor:pointer; font-size:12px; background:#fff3e0; border:1px solid #ffe0b2; color:#e65100;"
                        @click="addFieldToken(f.field)">{{ f.label || f.shortLabel }}</span>
                </div>
              </div>
              <!-- 部门独有字段 -->
              <div>
                <div style="padding:6px 12px; background:#f0f8ff; font-weight:600; font-size:13px; display:flex; justify-content:space-between;">
                  <span>部门独有字段</span>
                  <span style="color:#999;">{{ filteredUniqueFields.length }}</span>
                </div>
                <div style="padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span v-for="f in filteredUniqueFields" :key="f.field"
                        style="display:inline-block; padding:3px 10px; border-radius:14px; cursor:pointer; font-size:12px; background:#e3f2fd; border:1px solid #90caf9; color:#1565c0;"
                        @click="addFieldToken(f.field)">{{ f.label || f.shortLabel }}</span>
                </div>
              </div>
              <!-- 计算字段（可引用） -->
              <div>
                <div style="padding:6px 12px; background:#f0faf5; font-weight:600; font-size:13px; display:flex; justify-content:space-between;">
                  <span>计算字段（可引用）</span>
                  <span style="color:#999;">{{ filteredCalcFields.length }}</span>
                </div>
                <div style="padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span v-for="f in filteredCalcFields" :key="f.field_key || f.field"
                        style="display:inline-block; padding:3px 10px; border-radius:14px; cursor:pointer; font-size:12px; background:#e3f2fd; border:1px solid #90caf9; color:#0d47a1;"
                        @click="addFieldToken(f.field_key || f.field)">{{ f.field_label || f.label }}</span>
                </div>
              </div>
              <!-- 常量 -->
              <div v-if="constantNames.length > 0">
                <div style="padding:6px 12px; background:#fff8e1; border-bottom:1px solid #ffe082; font-weight:600; font-size:13px; display:flex; justify-content:space-between;">
                  <span>常量（按月生效）</span>
                  <span style="color:#999;">{{ constantNames.length }}</span>
                </div>
                <div style="padding:8px 12px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span v-for="c in constantNames" :key="c.name"
                        style="display:inline-block; padding:3px 10px; border-radius:14px; cursor:pointer; font-size:12px; background:#fff8e1; border:1px solid #ffe082; color:#f57f17;"
                        @click="addConstantToken(c.name)">{{ c.label + '（$' + c.name + '）' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 文本模式 -->
          <div v-if="editMode === 'text'">
            <el-input v-model="form.formula_text" type="textarea" :rows="3" placeholder="如：{daily_output} - SUM(expense)" />
            <div style="margin-top:8px; padding:10px 12px; background:#faf5ff; border:1px solid #e0d4f0; border-radius:6px; font-size:12px; color:#666; line-height:1.8;">
              <div style="font-weight:600; color:#7F41C0; margin-bottom:4px;">公式语法说明</div>
              <div><code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">{字段名}</code> 引用字段，如 <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">{daily_output}</code> = 总产值/天</div>
              <div><code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">SUM(expense)</code> 自动求和所有费用字段</div>
              <div>运算符：<code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">+</code> <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">-</code> <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">*</code> <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">/</code> <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">()</code>，可用数字常量如 <code style="background:#f0e6f6; padding:1px 4px; border-radius:3px;">1.13</code></div>
              <div style="margin-top:4px; font-weight:600; color:#333;">常用模板：</div>
              <div style="color:#444;">结余 = <code style="background:#e8f5e9; padding:1px 4px; border-radius:3px;">{daily_output} - SUM(expense)</code></div>
              <div style="color:#444;">占比 = <code style="background:#e8f5e9; padding:1px 4px; border-radius:3px;">{mold_repair} / {daily_output}</code></div>
              <div style="color:#444;">不含税 = <code style="background:#e8f5e9; padding:1px 4px; border-radius:3px;">{daily_output} / 1.13</code></div>
              <div style="color:#444;">多字段求和占比 = <code style="background:#e8f5e9; padding:1px 4px; border-radius:3px;">({worker_wage} + {supervisor_wage}) / {daily_output}</code></div>
              <div style="color:#444;">引用其他公式 = <code style="background:#e8f5e9; padding:1px 4px; border-radius:3px;">{balance} / {running_machines}</code></div>
            </div>
          </div>

          <!-- 文本预览 -->
          <div style="margin-top:12px; padding:8px 12px; background:#f5f5f5; border-radius:6px; font-size:13px; color:#666; font-family:monospace;">
            {{ form.formula_text || '（空公式）' }}
          </div>

          <!-- 验证结果 -->
          <div v-if="validateResult" style="margin-top:8px;">
            <el-alert v-if="validateResult.valid" title="公式验证通过" type="success" :closable="false" show-icon />
            <el-alert v-else :title="'公式错误：' + validateResult.errors.join('；')" type="error" :closable="false" show-icon />
          </div>
        </el-form>
        <template #footer>
          <el-button @click="editVisible = false">取消</el-button>
          <el-button @click="handleValidate" :loading="validating">验证</el-button>
          <el-button type="primary" @click="handleSaveFormula" :loading="saving" style="background:#7F41C0; border-color:#7F41C0;">保存公式</el-button>
        </template>
      </el-dialog>

      <!-- 重算历史弹窗 -->
      <el-dialog v-model="recalcVisible" title="重算历史数据" width="480px" destroy-on-close>
        <el-alert type="warning" :closable="false" show-icon style="margin-bottom:16px;">
          <template #title>此操作将根据当前公式配置重新计算选定时间范围内的所有记录，原计算结果将被覆盖且不可恢复。</template>
        </el-alert>
        <el-form label-width="80px" size="default">
          <el-form-item label="部门">
            <el-select v-model="recalcForm.department" style="width:100%">
              <el-option v-for="(label, key) in BALANCE_DEPARTMENTS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
          <el-form-item label="开始日期">
            <el-date-picker v-model="recalcForm.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
          <el-form-item label="结束日期">
            <el-date-picker v-model="recalcForm.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="recalcVisible = false">取消</el-button>
          <el-button type="danger" @click="handleRecalculate" :loading="recalculating">确认重算</el-button>
        </template>
      </el-dialog>

      <!-- 常量配置弹窗 -->
      <el-dialog v-model="constVisible" title="常量配置" width="700px" destroy-on-close>
        <div style="margin-bottom:16px;">
          <el-alert type="info" :closable="false" show-icon>
            <template #title>常量按月生效并向后延续。只需在值变化的月份添加记录，未设置的月份自动沿用上次的值。</template>
          </el-alert>
        </div>

        <!-- 快捷选择 -->
        <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center;">
          <span style="font-size:13px; color:#333;">快捷填入：</span>
          <span style="display:inline-block; padding:3px 10px; border-radius:14px; font-size:12px; background:#fff8e1; border:1px solid #ffe082; color:#f57f17; cursor:pointer;" @click="constForm.name = 'tax_rate'; constForm.label = '税点'">税点 = tax_rate</span>
          <span style="display:inline-block; padding:3px 10px; border-radius:14px; font-size:12px; background:#fff8e1; border:1px solid #ffe082; color:#f57f17; cursor:pointer;" @click="constForm.name = 'exchange_rate'; constForm.label = '汇率'">汇率 = exchange_rate</span>
        </div>

        <!-- 新增常量 -->
        <div style="display:flex; gap:12px; margin-bottom:16px; align-items:flex-end;">
          <div style="flex:1;">
            <div style="font-size:13px; color:#333; margin-bottom:6px;">常量名（中文）</div>
            <el-input v-model="constForm.label" placeholder="如：税点" size="default" />
          </div>
          <div style="flex:1;">
            <div style="font-size:13px; color:#333; margin-bottom:6px;">英文标识</div>
            <el-input v-model="constForm.name" placeholder="如：tax_rate" size="default" />
          </div>
          <div style="flex:1;">
            <div style="font-size:13px; color:#333; margin-bottom:6px;">生效月份</div>
            <el-date-picker v-model="constForm.effective_month" type="month" value-format="YYYY-MM" placeholder="选择月份" size="default" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <div style="font-size:13px; color:#333; margin-bottom:6px;">数值</div>
            <el-input v-model.number="constForm.value" placeholder="如：1.13" size="default" />
          </div>
          <el-button type="primary" size="default" @click="handleSaveConstant" :loading="constSaving" style="background:#7F41C0; border-color:#7F41C0;">保存</el-button>
        </div>

        <!-- 常量列表 -->
        <el-table :data="constantsList" border stripe style="width:100%;" v-loading="constLoading" size="small">
          <el-table-column prop="label" label="常量名" width="100" />
          <el-table-column prop="name" label="英文标识" width="120">
            <template #default="{ row }">
              <code style="background:#f5f0fa; padding:1px 4px; border-radius:3px; color:#7F41C0;">{{ '$' + row.name }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="effective_month" label="生效月份" width="110" />
          <el-table-column prop="value" label="数值" width="100" />
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-button size="small" type="danger" plain @click="handleDeleteConstant(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      BALANCE_DEPARTMENTS,
      currentDept: 'beer',
      formulas: [],
      fieldRegistry: [],
      loading: false,
      // 编辑弹窗
      editVisible: false,
      isEdit: false,
      editMode: 'visual',
      form: { field_key: '', field_label: '', formula_text: '', display_format: 'number', decimal_places: 2 },
      formulaTokens: [],     // 可视化模式的 token 数组
      fieldSearch: '',
      validateResult: null,
      validating: false,
      saving: false,
      // 重算弹窗
      recalcVisible: false,
      recalcForm: { department: 'beer', start_date: '', end_date: '' },
      recalculating: false,
      // 常量管理
      constVisible: false,
      constantsList: [],
      constForm: { name: '', label: '', value: '', effective_month: '' },
      constLoading: false,
      constSaving: false,
      constantNames: [],  // [{name, label}] 用于编辑器面板
      // 字段标签映射（缓存）
      fieldLabelMap: {},
    };
  },
  computed: {
    // 共享输入字段（非费用）
    filteredSharedInputFields() {
      const search = this.fieldSearch.toLowerCase();
      return [...SHARED_PEOPLE, ...SHARED_OUTPUT].filter(f =>
        !search || f.label.includes(search) || f.field.includes(search)
      );
    },
    // 费用字段（共享 + 部门独有中 expense 类型）
    filteredExpenseFields() {
      const search = this.fieldSearch.toLowerCase();
      const shared = [...SHARED_WAGE, ...SHARED_EXPENSE];
      const deptConfig = DEPT_CONFIG[this.currentDept];
      const unique = deptConfig ? deptConfig.uniqueFields.filter(f => f.editable && !f.calculated) : [];
      // 从 fieldRegistry 中找 expense 类型的部门独有字段
      const expenseKeys = new Set(this.fieldRegistry.filter(f => f.field_type === 'expense').map(f => f.field_key));
      const deptExpense = unique.filter(f => expenseKeys.has(f.field));
      return [...shared, ...deptExpense].filter(f =>
        !search || (f.label || '').includes(search) || f.field.includes(search)
      );
    },
    // 部门独有输入字段（非费用、非计算）
    filteredUniqueFields() {
      const search = this.fieldSearch.toLowerCase();
      const deptConfig = DEPT_CONFIG[this.currentDept];
      if (!deptConfig) return [];
      const expenseKeys = new Set(this.fieldRegistry.filter(f => f.field_type === 'expense').map(f => f.field_key));
      return deptConfig.uniqueFields
        .filter(f => f.editable && !f.calculated && !expenseKeys.has(f.field))
        .filter(f => !search || (f.label || '').includes(search) || f.field.includes(search));
    },
    // 可引用的计算字段（其他公式的结果）
    filteredCalcFields() {
      const search = this.fieldSearch.toLowerCase();
      return this.formulas.filter(f =>
        f.field_key !== this.form.field_key &&
        (!search || f.field_label.includes(search) || f.field_key.includes(search))
      );
    },
    // 所有可选字段，按类型分组（计算字段、输入字段、费用字段）
    allFieldOptions() {
      const typeMap = { calc: '计算', input: '输入', expense: '费用' };
      // 从 field_registry 获取当前部门和共享字段
      const fields = this.fieldRegistry
        .filter(f => f.department === this.currentDept || f.department === '_shared')
        .map(f => ({ field_key: f.field_key, field_label: f.field_label, field_type: f.field_type, data_type: f.data_type, typeLabel: typeMap[f.field_type] || f.field_type }));
      // 兜底：从前端 DEPT_CONFIG 补充（field_registry 为空时）
      if (fields.length === 0) {
        const deptConfig = DEPT_CONFIG[this.currentDept];
        if (deptConfig) {
          for (const f of deptConfig.uniqueFields) {
            fields.push({ field_key: f.field, field_label: f.label, field_type: f.calculated ? 'calc' : 'input', typeLabel: f.calculated ? '计算' : '输入' });
          }
        }
        for (const f of [...SHARED_PEOPLE, ...SHARED_OUTPUT]) {
          fields.push({ field_key: f.field, field_label: f.label, field_type: 'input', typeLabel: '输入' });
        }
        for (const f of [...SHARED_WAGE, ...SHARED_EXPENSE]) {
          fields.push({ field_key: f.field, field_label: f.label, field_type: 'expense', typeLabel: '费用' });
        }
        for (const f of SHARED_BALANCE) {
          fields.push({ field_key: f.field, field_label: f.label, field_type: 'calc', typeLabel: '计算' });
        }
      }
      // 按类型分组，计算字段排第一
      const groups = [
        { label: '计算字段', options: fields.filter(f => f.field_type === 'calc').sort((a, b) => a.field_label.localeCompare(b.field_label, 'zh')) },
        { label: '输入字段', options: fields.filter(f => f.field_type === 'input').sort((a, b) => a.field_label.localeCompare(b.field_label, 'zh')) },
        { label: '费用字段', options: fields.filter(f => f.field_type === 'expense').sort((a, b) => a.field_label.localeCompare(b.field_label, 'zh')) },
      ];
      return groups.filter(g => g.options.length > 0);
    }
  },
  watch: {
    // 可视化模式下 token 变化时同步到 formula_text
    formulaTokens: {
      handler() {
        if (this.editMode === 'visual') {
          this.form.formula_text = this.tokensToText(this.formulaTokens);
        }
      },
      deep: true
    }
  },
  created() {
    this.loadFormulas();
  },
  mounted() {
    this.$nextTick(() => this.initFormulaSortable());
  },
  methods: {
    async loadFormulas() {
      this.loading = true;
      try {
        const [formulaRes, registryRes, constNamesRes] = await Promise.all([
          API.getFormulas({ module: 'balance', department: this.currentDept }),
          API.getFieldRegistry({ module: 'balance' }),
          API.getConstantNames({ module: 'balance' })
        ]);
        this.formulas = formulaRes.data || [];
        this.fieldRegistry = registryRes.data || [];
        this.constantNames = constNamesRes.data || [];
        // 构建字段标签映射
        this.fieldLabelMap = {};
        for (const f of this.fieldRegistry) {
          this.fieldLabelMap[f.field_key] = f.field_label;
        }
        // 补充前端 SHARED / DEPT_CONFIG 中的字段
        for (const f of [...SHARED_PEOPLE, ...SHARED_OUTPUT, ...SHARED_WAGE, ...SHARED_EXPENSE, ...SHARED_BALANCE]) {
          if (!this.fieldLabelMap[f.field]) this.fieldLabelMap[f.field] = f.label;
        }
        const deptConfig = DEPT_CONFIG[this.currentDept];
        if (deptConfig) {
          for (const f of deptConfig.uniqueFields) {
            if (!this.fieldLabelMap[f.field]) this.fieldLabelMap[f.field] = f.label;
          }
        }
        this.$nextTick(() => this.initFormulaSortable());
      } catch (err) {
        ElementPlus.ElMessage.error('加载公式失败');
      } finally {
        this.loading = false;
      }
    },
    initFormulaSortable() {
      const el = this.$refs.formulaList;
      if (!el || this._sortable) return;
      this._sortable = Sortable.create(el, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: ({ oldIndex, newIndex }) => {
          if (oldIndex === newIndex) return;
          const moved = this.formulas.splice(oldIndex, 1)[0];
          this.formulas.splice(newIndex, 0, moved);
          this.saveFormulaSort();
        }
      });
    },
    async saveFormulaSort() {
      const items = this.formulas.map((f, i) => ({ id: f.id, sort_order: i + 1 }));
      try {
        await API.sortFormulas({ items });
        this.formulas.forEach((f, i) => { f.sort_order = i + 1; });
        ElementPlus.ElMessage.success('排序已保存');
      } catch (err) {
        ElementPlus.ElMessage.error('排序保存失败');
        await this.loadFormulas();
      }
    },

    // === 字段/公式展示辅助 ===
    getFieldLabel(key) {
      return this.fieldLabelMap[key] || key;
    },
    getFieldPillStyle(key) {
      // 判断字段类型给不同颜色
      const isExpense = [...SHARED_WAGE, ...SHARED_EXPENSE].some(f => f.field === key) ||
        this.fieldRegistry.some(f => f.field_key === key && f.field_type === 'expense');
      const isCalc = [...SHARED_BALANCE].some(f => f.field === key) ||
        this.formulas.some(f => f.field_key === key);
      if (isCalc) return { background: '#e3f2fd', border: '1px solid #90caf9', color: '#1565c0' };
      if (isExpense) return { background: '#fff3e0', border: '1px solid #ffe0b2', color: '#e65100' };
      return { background: '#e8f5e9', border: '1px solid #c8e6c9', color: '#2e7d32' };
    },
    parseFormulaTokens(text) {
      if (!text) return [];
      const tokens = [];
      // 匹配 {field}、$constant、SUM(tag)、运算符、数字、括号
      const regex = /\{(\w+)\}|\$(\w+)|SUM\((\w+)\)|([+\-*/÷×−])|(\d+\.?\d*)|([()])/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        if (m[1]) tokens.push({ type: 'field', value: m[1] });
        else if (m[2]) tokens.push({ type: 'const', value: m[2] });
        else if (m[3]) tokens.push({ type: 'func', value: 'SUM(' + m[3] + ')' });
        else if (m[4]) {
          const opMap = { '-': '−', '*': '×', '/': '÷' };
          tokens.push({ type: 'op', value: opMap[m[4]] || m[4] });
        }
        else if (m[5]) tokens.push({ type: 'number', value: m[5] });
        else if (m[6]) tokens.push({ type: 'paren', value: m[6] });
      }
      return tokens;
    },

    // === 可视化编辑操作 ===
    addFieldToken(key) {
      this.formulaTokens.push({ type: 'field', value: key });
    },
    addOperator(op) {
      const opMap = { '−': '-', '×': '*', '÷': '/' };
      this.formulaTokens.push({ type: 'op', value: op, raw: opMap[op] || op });
    },
    addSumFunction() {
      // 弹出输入标签名
      ElementPlus.ElMessageBox.prompt('请输入标签名（如 expense）', 'SUM 函数', {
        confirmButtonText: '确定', cancelButtonText: '取消', inputValue: 'expense'
      }).then(({ value }) => {
        if (value) this.formulaTokens.push({ type: 'func', value: 'SUM(' + value + ')' });
      }).catch(() => {});
    },
    addConstantToken(name) {
      this.formulaTokens.push({ type: 'const', value: name });
    },
    removeToken(idx) {
      this.formulaTokens.splice(idx, 1);
    },
    tokensToText(tokens) {
      return tokens.map(t => {
        if (t.type === 'field') return '{' + t.value + '}';
        if (t.type === 'const') return '$' + t.value;
        if (t.type === 'func') return t.value;
        if (t.type === 'op') {
          const map = { '−': '-', '×': '*', '÷': '/' };
          return ' ' + (map[t.value] || t.value) + ' ';
        }
        return t.value;
      }).join('').replace(/\s+/g, ' ').trim();
    },
    textToTokens(text) {
      return this.parseFormulaTokens(text);
    },

    // === 弹窗操作 ===
    // 选择字段名后自动填入公式名称和显示格式
    onFieldKeyChange(key) {
      // 从分组选项中找到匹配项，自动填入公式名称
      for (const g of this.allFieldOptions) {
        const opt = g.options.find(f => f.field_key === key);
        if (opt) {
          if (!this.form.field_label) this.form.field_label = opt.field_label;
          // 根据数据类型推断显示格式
          if (opt.data_type === 'ratio') {
            this.form.display_format = 'percent';
            this.form.decimal_places = 4;
          }
          break;
        }
      }
    },
    showAddDialog() {
      this.isEdit = false;
      this.form = { field_key: '', field_label: '', formula_text: '', display_format: 'number', decimal_places: 2 };
      this.formulaTokens = [];
      this.editMode = 'visual';
      this.validateResult = null;
      this.editVisible = true;
    },
    showEditDialog(f) {
      this.isEdit = true;
      this.form = { ...f };
      this.formulaTokens = this.textToTokens(f.formula_text);
      this.editMode = 'visual';
      this.validateResult = null;
      this.editVisible = true;
    },
    async handleValidate() {
      this.validating = true;
      try {
        const res = await API.validateFormula({
          module: 'balance', department: this.currentDept,
          formula_text: this.form.formula_text, field_key: this.form.field_key
        });
        this.validateResult = res.data;
      } catch (err) {
        ElementPlus.ElMessage.error('验证请求失败');
      } finally {
        this.validating = false;
      }
    },
    async handleSaveFormula() {
      if (!this.form.field_key || !this.form.field_label || !this.form.formula_text) {
        ElementPlus.ElMessage.warning('请填写公式名称、字段名和公式内容');
        return;
      }
      this.saving = true;
      try {
        if (this.isEdit) {
          await API.updateFormula(this.form.id, this.form);
        } else {
          await API.createFormula({ ...this.form, module: 'balance', department: this.currentDept, sort_order: this.formulas.length + 1 });
        }
        this.editVisible = false;
        ElementPlus.ElMessage.success('保存成功');
        await this.loadFormulas();
      } catch (err) {
        ElementPlus.ElMessage.error('保存失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async toggleEnabled(f) {
      try {
        await API.updateFormula(f.id, { enabled: !f.enabled });
        f.enabled = !f.enabled;
        ElementPlus.ElMessage.success(f.enabled ? '已启用' : '已禁用');
      } catch (err) {
        ElementPlus.ElMessage.error('操作失败');
      }
    },
    async handleDelete(f) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定要删除公式 "' + f.field_label + '" 吗？删除后不可恢复。', '确认删除',
          { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
        );
        await API.deleteFormula(f.id);
        ElementPlus.ElMessage.success('删除成功');
        await this.loadFormulas();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || ''));
        }
      }
    },

    // === 重算历史 ===
    showRecalcDialog() {
      this.recalcForm = { department: this.currentDept, start_date: '', end_date: '' };
      this.recalcVisible = true;
    },
    async handleRecalculate() {
      if (!this.recalcForm.start_date || !this.recalcForm.end_date) {
        ElementPlus.ElMessage.warning('请选择时间范围');
        return;
      }
      try {
        await ElementPlus.ElMessageBox.confirm(
          '此操作将覆盖所选时间范围内的所有计算字段值，且不可撤销。确定继续？', '最终确认',
          { type: 'error', confirmButtonText: '确定重算', cancelButtonText: '取消' }
        );
      } catch { return; }

      this.recalculating = true;
      try {
        const res = await API.recalculate({ module: 'balance', ...this.recalcForm });
        this.recalcVisible = false;
        ElementPlus.ElMessage.success('重算完成，共处理 ' + res.data.processed + ' 条记录');
      } catch (err) {
        ElementPlus.ElMessage.error('重算失败: ' + (err.message || ''));
      } finally {
        this.recalculating = false;
      }
    },

    // === 常量管理 ===
    async showConstantsDialog() {
      this.constVisible = true;
      this.constForm = { name: '', label: '', value: '', effective_month: '' };
      await this.loadConstants();
    },
    async loadConstants() {
      this.constLoading = true;
      try {
        const res = await API.getConstants({ module: 'balance' });
        this.constantsList = res.data || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载常量失败');
      } finally {
        this.constLoading = false;
      }
    },
    async handleSaveConstant() {
      if (!this.constForm.name || !this.constForm.label || !this.constForm.effective_month || this.constForm.value === '') {
        ElementPlus.ElMessage.warning('请填写完整信息');
        return;
      }
      this.constSaving = true;
      try {
        await API.saveConstant({ module: 'balance', ...this.constForm });
        ElementPlus.ElMessage.success('保存成功');
        // 保留 name 和 label 方便连续添加同一常量的不同月份
        this.constForm.value = '';
        this.constForm.effective_month = '';
        await this.loadConstants();
      } catch (err) {
        ElementPlus.ElMessage.error('保存失败: ' + (err.message || ''));
      } finally {
        this.constSaving = false;
      }
    },
    async handleDeleteConstant(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          '删除 "' + row.label + '" 在 ' + row.effective_month + ' 的值 ' + row.value + '？', '确认删除',
          { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
        );
        await API.deleteConstant(row.id);
        ElementPlus.ElMessage.success('删除成功');
        await this.loadConstants();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败');
        }
      }
    }
  }
};

// ===== 车间管理子组件 =====
const WorkshopSettings = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div class="settings-card">
      <div class="card-top">
        <h3><span class="title-dot" style="background:#3D8361;"></span> 组织架构</h3>
        <button v-if="!readonly" class="btn-pill success" @click="showAddDialog">+ 新增车间</button>
      </div>

      <!-- 厂区切换按钮（右键可编辑） -->
      <div class="region-tabs">
        <div v-for="r in regionList" :key="r.key"
          class="region-tab" :class="[r.key, { active: activeRegion === r.key }]"
          @click="activeRegion = r.key"
          @contextmenu.prevent="!readonly && showCtxMenu($event, 'region', r)">
          {{ r.label }} <span class="tab-count">({{ r.count }})</span>
        </div>
      </div>

      <!-- 组织架构图：公司 → 车间 → 部门 -->
      <div v-loading="loading" class="org-chart">
        <div class="org-tree" v-if="currentTree.length">
          <div class="org-children" style="gap:28px; align-items:flex-start;">
            <!-- 每个公司一个分支 -->
            <div class="org-branch" v-for="comp in currentTree" :key="comp.name">
              <div class="org-node company"
                @contextmenu.prevent="!readonly && showCtxMenu($event, 'company', comp)">
                {{ comp.name }}</div>
              <div class="org-vline"></div>
              <div class="org-children" style="gap:10px;">
                <!-- 第2级：每个车间名一个子分支 -->
                <div class="org-sub" v-for="wsGroup in comp.workshopGroups" :key="wsGroup.name">
                  <div class="org-node workshop"
                    @contextmenu.prevent="!readonly && showCtxMenu($event, 'wsGroup', wsGroup)">
                    {{ wsGroup.name }}
                  </div>
                  <!-- 第3级：该车间下挂的部门标签 -->
                  <template v-if="wsGroup.departments.length">
                    <div class="org-vline short"></div>
                    <div class="org-children" style="gap:4px;" v-if="wsGroup.departments.length > 1">
                      <div class="org-node dept" v-for="d in wsGroup.departments" :key="d.key"
                        @contextmenu.prevent="!readonly && showCtxMenu($event, 'dept', d)">
                        {{ d.label }}
                      </div>
                    </div>
                    <div class="org-node dept" v-else
                      @contextmenu.prevent="!readonly && showCtxMenu($event, 'dept', wsGroup.departments[0])">
                      {{ wsGroup.departments[0].label }}
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="!loading" style="text-align:center; padding:40px; color:#999;">
          该厂区暂无车间数据
        </div>
        <div v-if="!readonly" class="org-hint">右键点击厂区 / 公司 / 车间 / 部门节点 → 编辑 / 删除</div>
      </div>

      <!-- 右键菜单 -->
      <teleport to="body">
        <div v-if="ctxMenu.visible" class="org-ctx-menu"
          :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
          <div class="menu-item" @click="handleCtxEdit">✏️ 编辑</div>
          <div class="menu-divider"></div>
          <div class="menu-item danger" @click="handleCtxDelete">🗑 删除</div>
        </div>
      </teleport>

      <!-- 新增/编辑弹窗（保留原有） -->
      <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑车间' : '新增车间'" width="420px" destroy-on-close>
        <el-form :model="form" label-width="80px" size="default">
          <el-form-item label="厂区" required>
            <el-select v-model="form.region" style="width:100%">
              <el-option v-for="r in ALL_REGIONS" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="公司" required>
            <el-input v-model="form.company" placeholder="如：兴信、华登" />
          </el-form-item>
          <el-form-item label="车间名" required>
            <el-input v-model="form.name" placeholder="如：兴信A、华登B" />
          </el-form-item>
          <el-form-item label="部门">
            <el-select v-model="form.department" style="width:100%" clearable placeholder="无">
              <el-option v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSave" :loading="saving">保存</el-button>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      workshops: [],
      loading: false,
      saving: false,
      dialogVisible: false,
      isEdit: false,
      form: { name: '', company: '', region: '', department: '', sort_order: 0 },
      activeRegion: 'qx',            // 当前选中的厂区Tab
      ctxMenu: { visible: false, x: 0, y: 0, type: '', target: null },  // 右键菜单状态
      ALL_DEPARTMENTS,
      ALL_REGIONS,
      // 厂区中文名 → Tab key 映射
      regionKeyMap: { '清溪': 'qx', '湖南': 'hn', '河源': 'hy' },
      regionLabelMap: { qx: '清溪', hn: '湖南', hy: '河源' }
    };
  },
  computed: {
    // 厂区Tab列表（含车间数量统计）
    regionList() {
      const counts = {};
      for (const w of this.workshops) {
        const key = this.regionKeyMap[w.region] || 'other';
        counts[key] = (counts[key] || 0) + 1;
      }
      return [
        { key: 'qx', label: '清溪', count: counts.qx || 0 },
        { key: 'hn', label: '湖南', count: counts.hn || 0 },
        { key: 'hy', label: '河源', count: counts.hy || 0 }
      ];
    },
    // 当前厂区的树形数据：按公司 → 车间名 → 部门分组（带自定义排序）
    currentTree() {
      const regionName = this.regionLabelMap[this.activeRegion];
      const filtered = this.workshops.filter(w => w.region === regionName);

      // 车间名排序表（按厂区）
      const wsOrder = {
        '清溪': ['兴信A', '兴信B', '华登A', '华登B', '登信', '小部门', '华嘉'],
        '河源': ['华登', '华康A', '华康B', '华康C', '小部门', '华兴']
      };
      // 部门排序：啤机→印喷→装配→搪胶→吸塑→胶袋配色→其他
      const deptOrder = ['beer', 'print', 'assembly', 'roto_casting', 'blister', 'bags_color', 'blowing'];

      // 排序辅助：返回在数组中的索引，找不到排到末尾
      const indexOf = (arr, val) => { const i = arr.indexOf(val); return i >= 0 ? i : 999; };

      // 按公司分组（用车间名排序表推导公司顺序）
      const companyMap = {};
      for (const w of filtered) {
        const compName = w.company || '未知公司';
        if (!companyMap[compName]) companyMap[compName] = [];
        companyMap[compName].push(w);
      }

      const tree = [];
      for (const [compName, items] of Object.entries(companyMap)) {
        // 按车间名分组
        const wsMap = {};
        for (const w of items) {
          if (!wsMap[w.name]) wsMap[w.name] = [];
          wsMap[w.name].push(w);
        }
        const order = wsOrder[regionName] || [];
        const workshopGroups = Object.entries(wsMap).map(([name, records]) => {
          // 部门排序：啤机→印喷→装配→其他
          const departments = records.filter(r => r.department).map(r => ({
            key: r.department,
            label: ALL_DEPARTMENTS[r.department] || r.department,
            record: r
          })).sort((a, b) => indexOf(deptOrder, a.key) - indexOf(deptOrder, b.key));
          return { name, records, departments, noDeptRecords: records.filter(r => !r.department) };
        });
        // 车间名按指定顺序排序
        workshopGroups.sort((a, b) => indexOf(order, a.name) - indexOf(order, b.name));
        tree.push({ name: compName, workshopGroups });
      }
      // 公司排序：按其第一个车间名在排序表中的位置
      const order = wsOrder[regionName] || [];
      tree.sort((a, b) => {
        const aFirst = a.workshopGroups[0] ? indexOf(order, a.workshopGroups[0].name) : 999;
        const bFirst = b.workshopGroups[0] ? indexOf(order, b.workshopGroups[0].name) : 999;
        return aFirst - bFirst;
      });
      return tree;
    }
  },
  created() {
    this.loadWorkshops();
    // 点击空白处关闭右键菜单
    this._closeCtx = () => { this.ctxMenu.visible = false; };
    document.addEventListener('click', this._closeCtx);
  },
  beforeUnmount() {
    document.removeEventListener('click', this._closeCtx);
  },
  methods: {
    // —— 数据加载 ——
    async loadWorkshops() {
      this.loading = true;
      try {
        const res = await API.get('/workshops');
        this.workshops = res.data || res || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载车间列表失败');
      } finally {
        this.loading = false;
      }
    },
    // —— 右键菜单 ——
    showCtxMenu(e, type, target) {
      this.ctxMenu = { visible: true, x: e.clientX, y: e.clientY, type, target };
    },
    handleCtxEdit() {
      const t = this.ctxMenu.target;
      const type = this.ctxMenu.type;
      this.ctxMenu.visible = false;
      if (!t) return;
      if (type === 'dept') {
        // 部门节点：每个部门标签对应一条DB记录，直接编辑
        this.showEditDialog(t.record);
      } else if (type === 'wsGroup') {
        // 车间节点：如果只有1条记录直接编辑，多条时提示点具体部门
        if (t.records.length === 1) {
          this.showEditDialog(t.records[0]);
        } else {
          ElementPlus.ElMessage.info('该车间有多个部门记录，请右键点击下方具体部门节点编辑');
        }
      } else if (type === 'company') {
        // 公司节点：编辑该公司下第一条记录
        const first = t.workshopGroups[0] && t.workshopGroups[0].records[0];
        if (first) {
          this.showEditDialog(first);
        } else {
          ElementPlus.ElMessage.info('该公司暂无车间数据');
        }
      } else if (type === 'region') {
        // 厂区节点：编辑该厂区下第一条记录
        const regionName = t.label;
        const first = this.workshops.find(w => w.region === regionName);
        if (first) {
          this.showEditDialog(first);
        } else {
          ElementPlus.ElMessage.info('该厂区暂无车间数据');
        }
      }
    },
    handleCtxDelete() {
      const t = this.ctxMenu.target;
      const type = this.ctxMenu.type;
      this.ctxMenu.visible = false;
      if (!t) return;
      if (type === 'dept') {
        // 部门节点：删除对应的那条DB记录
        this.handleDelete(t.record);
      } else if (type === 'wsGroup') {
        // 车间节点：如果只有1条记录直接删除，多条时提示
        if (t.records.length === 1) {
          this.handleDelete(t.records[0]);
        } else {
          ElementPlus.ElMessage.info('该车间有多个部门记录，请右键点击下方具体部门节点删除');
        }
      } else if (type === 'company') {
        // 公司节点：批量删除该公司下所有车间
        const allRecords = t.workshopGroups.flatMap(g => g.records);
        this.handleDeleteBatch(t.name, allRecords);
      } else if (type === 'region') {
        // 厂区节点：批量删除该厂区所有车间
        const regionName = t.label;
        const count = t.count;
        this.handleDeleteRegion(regionName, count);
      }
    },
    // —— 弹窗操作 ——
    showAddDialog() {
      this.isEdit = false;
      // 默认厂区为当前选中的Tab对应厂区
      const defaultRegion = this.regionLabelMap[this.activeRegion] || '清溪';
      this.form = { name: '', company: '', region: defaultRegion, department: '', sort_order: 0 };
      this.dialogVisible = true;
    },
    showEditDialog(row) {
      this.isEdit = true;
      this.form = { id: row.id, name: row.name, company: row.company || '', region: row.region || '', department: row.department || '', sort_order: row.sort_order || 0 };
      this.dialogVisible = true;
    },
    async handleSave() {
      if (!this.form.name || !this.form.company || !this.form.region) {
        ElementPlus.ElMessage.warning('请填写厂区、公司和车间名');
        return;
      }
      this.saving = true;
      try {
        if (this.isEdit) {
          await API.put(`/workshops/${this.form.id}`, this.form);
        } else {
          await API.post('/workshops', this.form);
        }
        this.dialogVisible = false;
        ElementPlus.ElMessage.success('保存成功');
        await this.loadWorkshops();
      } catch (err) {
        ElementPlus.ElMessage.error('保存失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async handleDelete(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定要删除车间 "' + row.name + '" 吗？', '确认删除',
          { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
        );
        await API.del('/workshops/' + row.id);
        ElementPlus.ElMessage.success('删除成功');
        await this.loadWorkshops();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || '未知错误'));
        }
      }
    },
    // 批量删除某公司下所有车间（危险操作，二次确认）
    async handleDeleteBatch(name, records) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定要删除 "' + name + '" 下的全部 ' + records.length + ' 条车间记录吗？此操作不可撤销！',
          '删除公司车间',
          { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' }
        );
        for (const w of records) {
          await API.del('/workshops/' + w.id);
        }
        ElementPlus.ElMessage.success(name + ' 的车间已清空');
        await this.loadWorkshops();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || '未知错误'));
        }
      }
    },
    // 批量删除整个厂区的所有车间（危险操作，二次确认）
    async handleDeleteRegion(regionName, count) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定要删除 "' + regionName + '" 厂区下的全部 ' + count + ' 条车间记录吗？此操作不可撤销！',
          '删除整个厂区',
          { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' }
        );
        // 逐条删除该厂区所有车间
        const toDelete = this.workshops.filter(w => w.region === regionName);
        for (const w of toDelete) {
          await API.del('/workshops/' + w.id);
        }
        ElementPlus.ElMessage.success(regionName + ' 厂区已清空');
        await this.loadWorkshops();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('删除失败: ' + (err.message || '未知错误'));
        }
      }
    }
  }
};

// ===== 数据锁定子组件 =====
const DataLocks = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div class="settings-card">
      <div class="card-top">
        <h3><span class="title-dot" style="background:#E88EA0;"></span> 数据锁定</h3>
        <button v-if="!readonly" class="btn-pill danger" @click="showLockDialog">+ 锁定月份</button>
      </div>

      <div v-loading="loading">
        <!-- 无数据提示 -->
        <div v-if="locks.length === 0 && !loading" style="text-align:center; padding:40px; color:#999;">
          暂无锁定记录
        </div>
        <!-- 锁定卡片 -->
        <div class="lock-cards" v-else>
          <div class="lock-card" v-for="row in locks" :key="row.id">
            <span class="lock-icon">🔒</span>
            <div class="lock-month">{{ row.lock_month }}</div>
            <div class="lock-dept">
              <span class="pill-badge" :class="row.department ? deptBadge(row.department) : 'gray'">
                {{ row.department ? (BALANCE_DEPARTMENTS[row.department] || row.department) : '全部部门' }}
              </span>
            </div>
            <div class="lock-meta">{{ row.locked_by_name }} · {{ row.locked_at ? row.locked_at.substring(0, 16).replace('T', ' ') : '' }}</div>
            <button v-if="!readonly" class="unlock-btn" @click="handleUnlock(row)">解锁</button>
          </div>
        </div>
      </div>

      <el-dialog v-model="lockDialogVisible" title="锁定月份" width="400px" destroy-on-close>
        <el-form :model="lockForm" label-width="80px" size="default">
          <el-form-item label="月份" required>
            <el-date-picker v-model="lockForm.lock_month" type="month" placeholder="选择月份" value-format="YYYY-MM" style="width:100%" />
          </el-form-item>
          <el-form-item label="部门">
            <el-select v-model="lockForm.department" clearable placeholder="全部部门" style="width:100%">
              <el-option v-for="(label, key) in BALANCE_DEPARTMENTS" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="lockDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleLock" :loading="saving">锁定</el-button>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      locks: [],
      loading: false,
      saving: false,
      lockDialogVisible: false,
      lockForm: { lock_month: '', department: '' },
      BALANCE_DEPARTMENTS
    };
  },
  created() {
    this.loadLocks();
  },
  methods: {
    async loadLocks() {
      this.loading = true;
      try {
        const res = await API.get('/settings/data-locks');
        this.locks = res.data || res || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载锁定列表失败');
      } finally {
        this.loading = false;
      }
    },
    deptBadge(dept) {
      if (dept === 'beer') return 'purple';
      if (dept === 'print') return 'blue';
      if (dept === 'assembly') return 'teal';
      return 'gray';
    },
    showLockDialog() {
      // BUG-04: 字段名对齐后端 req.body.department
      this.lockForm = { lock_month: '', department: '' };
      this.lockDialogVisible = true;
    },
    async handleLock() {
      if (!this.lockForm.lock_month) {
        ElementPlus.ElMessage.warning('请选择月份');
        return;
      }
      this.saving = true;
      try {
        await API.post('/settings/data-locks', this.lockForm);
        this.lockDialogVisible = false;
        ElementPlus.ElMessage.success('锁定成功');
        await this.loadLocks();
      } catch (err) {
        ElementPlus.ElMessage.error('锁定失败: ' + (err.message || '未知错误'));
      } finally {
        this.saving = false;
      }
    },
    async handleUnlock(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(`确定要解锁 ${row.lock_month} 的数据吗？`, '确认解锁', {
          type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消'
        });
        await API.del(`/settings/data-locks/${row.id}`);
        ElementPlus.ElMessage.success('解锁成功');
        await this.loadLocks();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('解锁失败: ' + (err.message || '未知错误'));
        }
      }
    }
  }
};

// ===== 操作日志子组件 =====
const AuditLogs = {
  template: `
    <div class="settings-card">
      <div class="card-top">
        <h3><span class="title-dot" style="background:#F0A868;"></span> 操作日志</h3>
      </div>

      <!-- 筛选药片 -->
      <div class="filter-pills">
        <span v-for="opt in actionOptions" :key="opt.value"
          class="filter-pill" :class="{ active: actionFilter === opt.value }"
          @click="actionFilter = opt.value; loadLogs()">{{ opt.label }}</span>
        <span style="margin-left:auto; display:flex; gap:8px; align-items:center;">
          <el-input v-model="userFilter" placeholder="按用户筛选..." clearable size="small"
            style="width:140px;" @input="loadLogs">
          </el-input>
          <el-date-picker v-model="dateRange" type="daterange" range-separator="至"
            start-placeholder="开始" end-placeholder="结束" size="small"
            value-format="YYYY-MM-DD" @change="loadLogs" style="width:240px" />
        </span>
      </div>

      <!-- 时间线列表 -->
      <div v-loading="loading" style="max-height:500px; overflow-y:auto;">
        <div v-if="logs.length === 0 && !loading" style="text-align:center; padding:40px; color:#999;">
          暂无日志记录
        </div>
        <div class="log-timeline" v-else>
          <div class="log-item" v-for="log in logs" :key="log.id">
            <div class="log-time">{{ log.created_at ? log.created_at.substring(0, 16).replace('T', ' ') : '' }}</div>
            <span class="log-action-badge" :class="log.action || ''">{{ actionLabel(log.action) }}</span>
            <div class="log-body">
              <div class="log-user">{{ log.username }}</div>
              <div class="log-detail">{{ typeof log.detail === 'object' ? JSON.stringify(log.detail) : log.detail }}</div>
            </div>
            <div class="log-ip">{{ log.ip }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      logs: [],
      loading: false,
      dateRange: getDefaultDateRange(),
      userFilter: '',
      actionFilter: '',
      actionOptions: [
        { label: '全部', value: '' },
        { label: '登录', value: 'login' },
        { label: '新增', value: 'create' },
        { label: '修改', value: 'update' },
        { label: '删除', value: 'delete' },
        { label: '导入', value: 'import' },
        { label: '导出', value: 'export' },
        { label: '锁定', value: 'lock' },
        { label: '备份', value: 'backup' },
        { label: '恢复', value: 'restore' }
      ]
    };
  },
  created() {
    this.loadLogs();
  },
  methods: {
    actionLabel(action) {
      const map = { login: '登录', create: '新增', update: '修改', delete: '删除', import: '导入', export: '导出', lock: '锁定', backup: '备份', restore: '恢复' };
      return map[action] || action || '未知';
    },
    async loadLogs() {
      this.loading = true;
      try {
        const params = {};
        if (this.dateRange && this.dateRange[0]) {
          params.start_date = this.dateRange[0];
          params.end_date = this.dateRange[1];
        }
        if (this.userFilter) params.username = this.userFilter;
        if (this.actionFilter) params.action = this.actionFilter;
        const res = await API.get('/audit-logs', params);
        this.logs = res.data || res || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载日志失败');
      } finally {
        this.loading = false;
      }
    }
  }
};

// ===== 数据备份子组件 =====
const BackupPage = {
  props: { readonly: { type: Boolean, default: false } },
  template: `
    <div class="settings-card">
      <div class="card-top">
        <h3><span class="title-dot" style="background:#9B6DC6;"></span> 数据备份</h3>
        <button v-if="!readonly" class="btn-pill primary" @click="handleBackup" :disabled="backing">
          {{ backing ? '备份中...' : '+ 创建备份' }}
        </button>
      </div>

      <div v-loading="loading">
        <div v-if="backups.length === 0 && !loading" style="text-align:center; padding:40px; color:#999;">
          暂无备份记录
        </div>
        <div class="backup-cards" v-else>
          <div class="backup-card" v-for="row in backups" :key="row.id">
            <div class="backup-icon">📦</div>
            <div class="backup-info">
              <div class="backup-name">{{ row.filename }}</div>
              <div class="backup-meta">
                <span><span class="pill-badge gray">{{ formatSize(row.size) }}</span></span>
                <span>{{ row.created_at ? row.created_at.substring(0, 16).replace('T', ' ') : '' }}</span>
                <span>{{ row.created_by }}</span>
              </div>
            </div>
            <button v-if="!readonly" class="restore-btn" @click="handleRestore(row)">恢复</button>
          </div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      backups: [],
      loading: false,
      backing: false
    };
  },
  created() {
    this.loadBackups();
  },
  methods: {
    formatSize(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let idx = 0;
      let size = Number(bytes);
      while (size >= 1024 && idx < units.length - 1) { size /= 1024; idx++; }
      return size.toFixed(1) + ' ' + units[idx];
    },
    async loadBackups() {
      this.loading = true;
      try {
        const res = await API.get('/backup/list');
        this.backups = res.data || res || [];
      } catch (err) {
        ElementPlus.ElMessage.error('加载备份列表失败');
      } finally {
        this.loading = false;
      }
    },
    async handleBackup() {
      try {
        await ElementPlus.ElMessageBox.confirm('确定要创建数据备份吗？', '确认备份', {
          type: 'info', confirmButtonText: '确定', cancelButtonText: '取消'
        });
        this.backing = true;
        await API.post('/backup');
        ElementPlus.ElMessage.success('备份创建成功');
        await this.loadBackups();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('备份失败: ' + (err.message || '未知错误'));
        }
      } finally {
        this.backing = false;
      }
    },
    async handleRestore(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定要恢复到备份 "${row.filename}" 吗？当前数据将被覆盖！`,
          '确认恢复',
          { type: 'error', confirmButtonText: '确定恢复', cancelButtonText: '取消' }
        );
        this.loading = true;
        await API.post('/backup/restore', { id: row.id, filename: row.filename });
        ElementPlus.ElMessage.success('数据恢复成功');
        await this.loadBackups();
      } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
          ElementPlus.ElMessage.error('恢复失败: ' + (err.message || '未知错误'));
        }
      } finally {
        this.loading = false;
      }
    }
  }
};

// ===== 面包屑映射 =====
const BREADCRUMB_MAP = {
  '/beer': '三工结余 / 啤机部',
  '/print': '三工结余 / 印喷部',
  '/assembly': '三工结余 / 装配部',
  '/summary': '结余收支汇总 / 大车间汇总',
  '/settings': '系统设置'
};

// ===== 主应用 =====
const app = Vue.createApp({
  template: `
    <template v-if="currentRoute === '/login' || !user">
      <login-page />
    </template>
    <template v-else>
      <div class="app-container">
        <!-- 侧边栏 -->
        <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
          <div class="sidebar-header">
            <button class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed">
              {{ sidebarCollapsed ? '☰' : '✕' }}
            </button>
            <h1 v-show="!sidebarCollapsed">生产经营数据系统</h1>
          </div>
          <div class="sidebar-menu">
            <!-- 三工结余 组 -->
            <div class="menu-group-title" v-show="!sidebarCollapsed">三工结余</div>
            <a class="menu-item" :class="{ active: currentRoute === '/beer' }" @click="navigate('/beer')">
              <span class="icon">🗜️</span>
              <span v-show="!sidebarCollapsed">啤机部</span>
            </a>
            <a class="menu-item" :class="{ active: currentRoute === '/print' }" @click="navigate('/print')">
              <span class="icon">🖨️</span>
              <span v-show="!sidebarCollapsed">印喷部</span>
            </a>
            <a class="menu-item" :class="{ active: currentRoute === '/assembly' }" @click="navigate('/assembly')">
              <span class="icon">🔧</span>
              <span v-show="!sidebarCollapsed">装配部</span>
            </a>
            <div class="menu-group">
              <a class="menu-item" :class="{ active: currentRoute === '/summary' }" @click="summaryExpanded = !summaryExpanded">
                <span class="icon">📊</span>
                <span v-show="!sidebarCollapsed">结余收支汇总</span>
                <span v-show="!sidebarCollapsed" style="margin-left:auto; font-size:10px;">{{ summaryExpanded ? '▼' : '▶' }}</span>
              </a>
              <template v-if="summaryExpanded && !sidebarCollapsed">
                <a class="menu-item sub-item" :class="{ active: currentRoute === '/summary' }" @click="navigate('/summary')">
                  <span class="icon">📋</span>
                  大车间汇总
                </a>
              </template>
            </div>

            <!-- 系统设置 (stats + management) -->
            <template v-if="user && (user.role === 'stats' || user.role === 'management')">
              <div class="menu-group-title" v-show="!sidebarCollapsed">管理</div>
              <a class="menu-item" :class="{ active: currentRoute === '/settings' }" @click="navigate('/settings')">
                <span class="icon">⚙️</span>
                <span v-show="!sidebarCollapsed">系统设置</span>
              </a>
            </template>

            <!-- 未来模块 -->
            <div class="menu-group-title" v-show="!sidebarCollapsed">更多模块</div>
            <a class="menu-item disabled" v-show="!sidebarCollapsed">
              <span class="icon">📈</span>
              <span>预计产值</span>
            </a>
            <a class="menu-item disabled" v-show="!sidebarCollapsed">
              <span class="icon">📉</span>
              <span>实际产值</span>
            </a>
          </div>
        </div>

        <!-- 主内容 -->
        <div class="main-content" :class="{ expanded: sidebarCollapsed }">
          <div class="top-nav">
            <div class="breadcrumb">{{ breadcrumb }}</div>
            <div class="user-info">
              <span>{{ user?.name || user?.username }}</span>
              <el-tag size="small" type="info" effect="dark" style="border:none;">{{ getRoleName(user?.role) }}</el-tag>
              <button class="logout-btn" @click="handleLogout">退出</button>
            </div>
          </div>
          <div class="page-content">
            <dept-records-page v-if="isDeptPage" :dept="currentDept" :key="currentDept" />
            <summary-page v-else-if="currentRoute === '/summary'" />
            <settings-page v-else-if="currentRoute === '/settings' && (user?.role === 'stats' || user?.role === 'management')" :readonly="user?.role === 'management'" />
            <div v-else style="text-align:center; padding:60px; color:var(--text-secondary);">
              <h2>页面未找到</h2>
              <p>请从左侧菜单选择一个页面</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  `,
  data() {
    return {
      currentRoute: '/login',
      user: null,
      sidebarCollapsed: false,
      summaryExpanded: true
    };
  },
  computed: {
    isDeptPage() {
      return ['/beer', '/print', '/assembly'].includes(this.currentRoute);
    },
    currentDept() {
      if (this.currentRoute === '/beer') return 'beer';
      if (this.currentRoute === '/print') return 'print';
      if (this.currentRoute === '/assembly') return 'assembly';
      return '';
    },
    breadcrumb() {
      return BREADCRUMB_MAP[this.currentRoute] || '';
    }
  },
  created() {
    // Restore user from localStorage
    const savedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (savedUser && token) {
      try {
        this.user = JSON.parse(savedUser);
        API.setToken(token);
      } catch (e) {
        this.user = null;
      }
    }

    // Init route from hash
    this.handleRouteChange();

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      this.handleRouteChange();
    });

    // Verify token on load
    if (this.user) {
      this.verifyAuth();
    }
  },
  methods: {
    getRoleName,
    handleRouteChange() {
      const hash = window.location.hash.replace('#', '') || '/login';
      if (!this.user && hash !== '/login') {
        window.location.hash = '#/login';
        this.currentRoute = '/login';
        return;
      }
      this.currentRoute = hash;
    },
    navigate(path) {
      window.location.hash = '#' + path;
    },
    async verifyAuth() {
      try {
        const res = await API.get('/auth/me');
        const userData = res.data || res.user || res;
        if (userData && userData.username) {
          this.user = userData;
          localStorage.setItem('user', JSON.stringify(userData));
        }
        // If currently on login, redirect to default
        if (this.currentRoute === '/login') {
          this.navigate('/beer');
        }
      } catch (err) {
        // Token invalid
        this.user = null;
        API.setToken(null);
        localStorage.removeItem('user');
        this.navigate('/login');
      }
    },
    handleLogout() {
      this.user = null;
      API.setToken(null);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      this.navigate('/login');
      ElementPlus.ElMessage.success('已退出登录');
    }
  }
});

// Register components
app.component('login-page', LoginPage);
app.component('dept-records-page', DeptRecordsPage);
app.component('summary-page', SummaryPage);
app.component('user-management-page', UserManagementPage);
app.component('settings-page', SettingsPage);
app.component('formula-config', FormulaConfig);
app.component('workshop-settings', WorkshopSettings);
app.component('data-locks', DataLocks);
app.component('audit-logs', AuditLogs);
app.component('backup-page', BackupPage);

// Use Element Plus and mount
app.use(ElementPlus);
app.mount('#app');
