<template>
  <div>
    <el-card shadow="hover" style="border-radius: 8px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <el-icon :size="22" color="#409eff"><Goods /></el-icon>
            <span style="font-size: 18px; font-weight: bold;">货号映射管理</span>
            <el-tag effect="dark" round size="small">{{ total }}</el-tag>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input v-model="searchInput" placeholder="搜索货号或货名" class="plain-search-input" @keyup.enter="doSearch" />
            <el-button type="primary" @click="doSearch" :icon="Search">搜索</el-button>
            <el-button @click="searchInput = ''; doSearch()" :icon="Refresh">重置</el-button>
            <el-button type="success" :icon="Plus" @click="addNew">新增</el-button>
          </div>
        </div>
      </template>

      <!-- 客户筛选 -->
      <div style="margin-bottom: 16px; display: flex; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #ebeef5;">
        <span style="color: #606266; font-size: 14px; font-weight: 500;">客户筛选：</span>
        <el-radio-group v-model="selectedCustomer" @change="selectCustomer" size="small">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button v-for="c in customerList" :key="c.name" :label="c.name">
            {{ c.name }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 规则说明 -->
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 14px; font-size: 13px;">
        <template #title>
          多规格匹配规则：货号相同、货名相同、每箱个数不同 → 视为独立记录，分行展示，导出时各自对应正确重量。
        </template>
      </el-alert>

      <el-table
        :data="products"
        border
        v-loading="loading"
        style="width: 100%;"
        size="default"
        :row-class-name="rowClassName"
        :header-cell-style="{ background: '#fafafa', color: '#303133', fontWeight: '600', fontSize: '14px', padding: '12px 0' }"
        :row-style="{ height: '48px' }"
        :cell-style="{ fontSize: '13px', padding: '8px 0' }">

        <!-- 货号 -->
        <el-table-column prop="product_code" label="货号" width="165">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
              <span style="font-weight: 600; color: #409eff; font-size: 14px;">{{ row.product_code }}</span>
              <el-tag
                v-if="isMultiVariant(row)"
                size="small"
                type="warning"
                effect="light"
                round
                style="font-size: 11px; padding: 0 5px; height: 18px; line-height: 16px; flex-shrink: 0;">
                多规格
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <!-- 货名 -->
        <el-table-column prop="product_name" label="货名" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="color: #303133;">{{ row.product_name || '-' }}</span>
          </template>
        </el-table-column>

        <!-- 每箱个数 -->
        <el-table-column prop="qty_per_box" label="每箱个数" width="95" align="center">
          <template #default="{ row }">
            <span v-if="row.qty_per_box" style="font-weight: 600; color: #e6a23c;">{{ row.qty_per_box }} 个</span>
            <span v-else style="color: #c0c4cc;">默认</span>
          </template>
        </el-table-column>

        <!-- 玩具类别 -->
        <el-table-column prop="toy_category" label="玩具类别" width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.toy_category || '-' }}</span>
          </template>
        </el-table-column>

        <!-- 备注（柜单备注列） -->
        <el-table-column prop="factory_short" label="备注(柜单)" width="110" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.factory_short" size="small" type="danger" effect="light" round>
              {{ row.factory_short }}
            </el-tag>
            <span v-else style="color: #c0c4cc;">-</span>
          </template>
        </el-table-column>

        <!-- 每箱毛重 -->
        <el-table-column label="每箱毛重(kg)" width="115" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.gross_weight_per_box ? '#303133' : '#c0c4cc', fontWeight: row.gross_weight_per_box ? '500' : '400' }">
              {{ row.gross_weight_per_box || '-' }}
            </span>
          </template>
        </el-table-column>

        <!-- 每箱净重 -->
        <el-table-column label="每箱净重(kg)" width="115" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.net_weight_per_box ? '#303133' : '#c0c4cc', fontWeight: row.net_weight_per_box ? '500' : '400' }">
              {{ row.net_weight_per_box || '-' }}
            </span>
          </template>
        </el-table-column>

        <!-- 来源 -->
        <el-table-column label="来源" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.source === 'manual' ? 'warning' : 'info'" effect="plain" round>
              {{ row.source || 'X盘' }}
            </el-tag>
          </template>
        </el-table-column>

        <!-- 客户 -->
        <el-table-column label="客户" width="95" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="tagType(row.customer_name)" effect="light" round>
              {{ row.customer_name || '-' }}
            </el-tag>
          </template>
        </el-table-column>

        <!-- 操作：每行独立 -->
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editRow(row)"><el-icon><Edit /></el-icon> 编辑</el-button>
            <el-button link type="danger" @click="deleteRow(row)"><el-icon><Delete /></el-icon> 删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
        <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total"
          :page-sizes="[50, 100, 200]" layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadData" @size-change="handleSizeChange" background />
      </div>
    </el-card>

    <!-- 编辑 / 新增弹窗 -->
    <el-dialog v-model="showEdit" :title="editForm.id ? '编辑货号映射' : '新增货号映射'" width="480px" :close-on-click-modal="false" style="border-radius: 8px;">
      <el-form :model="editForm" label-width="90px" style="padding: 0 10px;">
        <el-form-item label="货号" required>
          <el-input v-model="editForm.product_code" :disabled="!!editForm.id" placeholder="如 77711GQ4" />
        </el-form-item>
        <el-form-item label="客户">
          <el-select v-model="editForm.customer_name" :disabled="!!editForm.id" placeholder="选择客户" style="width: 100%;">
            <el-option v-for="c in customerList" :key="c.name" :label="c.name" :value="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="每箱个数">
          <el-input-number
            v-model="editForm.qty_per_box"
            :disabled="!!editForm.id"
            :min="1" :precision="0" :step="1"
            style="width: 100%;"
            controls-position="right" />
          <div style="color: #909399; font-size: 12px; margin-top: 4px; line-height: 1.5;">
            留空 = 默认规格；填入具体数字（如 25）= 独立规格，不覆盖其他记录
          </div>
        </el-form-item>
        <el-form-item label="货名">
          <el-input v-model="editForm.product_name" placeholder="如 卡哇伊DIY球25个/箱" />
        </el-form-item>
        <el-form-item label="玩具类别">
          <el-input v-model="editForm.toy_category" placeholder="如 塑胶、电动" />
        </el-form-item>
        <el-form-item label="备注(柜单)">
          <el-input v-model="editForm.factory_short" placeholder="如 华登、汇有（自动填入柜单备注列）" />
          <div style="color: #909399; font-size: 12px; margin-top: 4px; line-height: 1.5;">
            填入后生成柜单时自动显示在备注列，无需人工查找
          </div>
        </el-form-item>
        <el-divider>重量信息</el-divider>
        <el-form-item label="每箱毛重">
          <el-input-number v-model="editForm.gross_weight_per_box" :precision="3" :min="0" :step="0.1" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="每箱净重">
          <el-input-number v-model="editForm.net_weight_per_box" :precision="3" :min="0" :step="0.1" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { Search, Refresh, Plus } from '@element-plus/icons-vue'
import api from '../../api/auth'
import { ElMessage, ElMessageBox } from 'element-plus'

const products = ref([])
const loading = ref(false)
const saving = ref(false)
const searchInput = ref('')
const searchQuery = ref('')
const selectedCustomer = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const showEdit = ref(false)
const editForm = ref({})

const customerList = [
  { name: 'ZURU' }, { name: 'MOOSE' }, { name: 'TIG' },
  { name: 'TOMY' }, { name: 'CEPIA' }, { name: 'AZAD' }, { name: 'ZANZOON' }, { name: 'JOHN ADAMS' },
]

function tagType(name) {
  const map = { ZURU: 'primary', MOOSE: 'success', TIG: 'warning', TOMY: 'danger', AZAD: 'info' }
  return map[name] || 'info'
}

// ── 多规格分组判断 ──────────────────────────────────────────────────────────
// 统计当前页中每个 (product_code + customer_name) 组合的出现次数
// 若同一组合 > 1 条 → 多规格组，打「多规格」标，加左侧橙色竖线
const variantCounts = computed(() => {
  const counts = {}
  products.value.forEach(r => {
    const k = `${r.product_code}__${r.customer_name}`
    counts[k] = (counts[k] || 0) + 1
  })
  return counts
})

const groupIndex = computed(() => {
  // 为每行分配分组序号（相邻同组共用同一序号），用于交替条纹
  const idx = {}
  let n = 0
  let prev = null
  products.value.forEach(r => {
    const k = `${r.product_code}__${r.customer_name}`
    if (k !== prev) { n++; prev = k }
    idx[r.id] = n
  })
  return idx
})

function isMultiVariant(row) {
  return (variantCounts.value[`${row.product_code}__${row.customer_name}`] || 0) > 1
}

function rowClassName({ row }) {
  const stripe = (groupIndex.value[row.id] || 0) % 2 === 0 ? 'group-even' : 'group-odd'
  const variant = isMultiVariant(row) ? ' variant-row' : ''
  return stripe + variant
}

// ── 数据加载 ───────────────────────────────────────────────────────────────
let _loadAbort = null
async function loadData() {
  if (_loadAbort) _loadAbort.abort()
  const controller = new AbortController()
  _loadAbort = controller
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize.value }
    if (searchQuery.value) params.search = searchQuery.value
    if (selectedCustomer.value) params.customer = selectedCustomer.value
    const { data } = await api.get('/master-data/product-mappings/', { params, signal: controller.signal })
    products.value = data.results || data
    total.value = data.count || products.value.length
  } catch (e) {
    if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function doSearch() { searchQuery.value = searchInput.value; page.value = 1; loadData() }
function selectCustomer() { page.value = 1; loadData() }
function handleSizeChange(size) { pageSize.value = size; page.value = 1; loadData() }

function addNew() {
  editForm.value = { customer_name: selectedCustomer.value || 'ZURU' }
  showEdit.value = true
}

function editRow(row) { editForm.value = { ...row }; showEdit.value = true }

async function saveEdit() {
  saving.value = true
  try {
    if (editForm.value.id) {
      // 编辑：定位字段（货号/客户/每箱个数）只读，不发送
      const { id, product_code, customer_name, qty_per_box, ...payload } = editForm.value
      await api.patch(`/master-data/product-mappings/${id}/`, payload)
    } else {
      // 新增：qty_per_box 为空则不传 → NULL → 默认规格
      const payload = { ...editForm.value }
      if (!payload.qty_per_box) delete payload.qty_per_box
      await api.post('/master-data/product-mappings/', payload)
    }
    ElMessage.success('保存成功')
    showEdit.value = false
    await loadData()
  } catch (e) {
    const detail = e?.response?.data
    const msg = typeof detail === 'string'
      ? detail
      : detail?.detail || detail?.non_field_errors?.[0] || '保存失败，请检查是否存在重复记录'
    ElMessage.error(msg)
  } finally { saving.value = false }
}

async function deleteRow(row) {
  const label = row.qty_per_box ? `${row.product_code}（${row.qty_per_box}个/箱）` : `${row.product_code}（默认规格）`
  try {
    await ElMessageBox.confirm(`确定删除 ${label} 吗？`, '确认删除', { type: 'warning' })
    await api.delete(`/master-data/product-mappings/${row.id}/`)
    ElMessage.success('删除成功')
    await loadData()
  } catch (e) { if (e !== 'cancel') ElMessage.error('删除失败') }
}

onMounted(loadData)
</script>

<style scoped>
.plain-search-input {
  width: 200px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.plain-search-input:focus { border-color: #409eff; }
.plain-search-input::placeholder { color: #a8abb2; }

/* 分组交替条纹：相邻同货号的多规格行背景一致，不同货号组切换颜色 */
:deep(.group-odd > td.el-table__cell)  { background-color: #ffffff; }
:deep(.group-even > td.el-table__cell) { background-color: #f7f8fc; }

/* 多规格行：左侧橙色竖线标记，帮助区分哪些行是同货号不同规格 */
:deep(.variant-row > td.el-table__cell:first-child) {
  border-left: 3px solid #e6a23c !important;
}

/* hover 统一蓝色高亮 */
:deep(.el-table__row:hover > td.el-table__cell) {
  background-color: #ecf5ff !important;
}
</style>
