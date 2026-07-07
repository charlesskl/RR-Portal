<template>
  <div>
    <el-card>
      <template #header>
        <span style="font-size: 18px; font-weight: bold;">提单管理</span>
      </template>

      <el-tabs v-model="activeTab" type="border-card">
        <!-- ── Tab 1: 找提单 ── -->
        <el-tab-pane label="找提单" name="find">
          <!-- 搜索表单 -->
          <el-form :model="searchForm" inline style="margin-bottom: 16px;">
            <el-form-item label="货号">
              <el-input v-model="searchForm.product_code" placeholder="货号（模糊）" style="width: 160px;" clearable />
            </el-form-item>
            <el-form-item label="合同号">
              <el-input v-model="searchForm.contract_number" placeholder="合同号（模糊）" style="width: 160px;" clearable />
            </el-form-item>
            <el-form-item label="邮件主题">
              <el-input v-model="searchForm.email_subject" placeholder="邮件主题关键词" style="width: 200px;" clearable />
            </el-form-item>
            <el-form-item label="件数">
              <el-input v-model="searchForm.pieces" placeholder="精确件数" style="width: 100px;" clearable />
            </el-form-item>
            <el-form-item label="CBM">
              <el-input v-model="searchForm.cbm" placeholder="精确CBM" style="width: 100px;" clearable />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
              <el-button @click="resetSearch">重置</el-button>
            </el-form-item>
          </el-form>

          <!-- 搜索结果 -->
          <div v-if="searchGroups.length === 0 && searched" style="color: #909399; text-align: center; padding: 40px 0;">
            未找到匹配的出货记录
          </div>

          <div v-for="group in searchGroups" :key="group.shipment_id" style="margin-bottom: 20px; border: 1px solid #e4e7ed; border-radius: 8px; overflow: hidden;">
            <!-- 分组标题栏 -->
            <div style="background: #f5f7fa; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                <span style="font-weight: 600; font-size: 15px; color: #303133;">{{ group.file_name }}</span>
                <el-tag size="small" type="info">{{ group.container_type }}</el-tag>
                <span v-if="group.so_number" style="color: #606266; font-size: 13px;">SO: {{ group.so_number }}</span>
                <span v-if="group.ship_date" style="color: #606266; font-size: 13px;">出货: {{ group.ship_date }}</span>
                <span style="color: #606266; font-size: 13px;">共 {{ group.items.length }} 项 / {{ group.total_cbm }} CBM / {{ group.total_pieces }} 件</span>
                <el-tag v-if="group.already_saved" size="small" type="success">已保存</el-tag>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <!-- 文件名可编辑 -->
                <el-input
                  v-model="group._edit_name"
                  size="small"
                  style="width: 180px;"
                  :placeholder="group.file_name"
                />
                <el-button
                  type="success"
                  size="small"
                  :loading="group._saving"
                  @click="autoSave(group)"
                >
                  自动保存
                </el-button>
              </div>
            </div>

            <!-- 邮件主题 -->
            <div v-if="group.email_subject" style="padding: 6px 16px; font-size: 12px; color: #909399; border-bottom: 1px solid #f0f0f0;">
              邮件: {{ group.email_subject }}
            </div>

            <!-- 明细表格 -->
            <el-table :data="group.items" size="small" border style="width: 100%;">
              <el-table-column prop="product_code" label="货号" min-width="100" />
              <el-table-column prop="contract_number" label="合同号" min-width="100" />
              <el-table-column prop="product_name" label="货名" min-width="160" show-overflow-tooltip />
              <el-table-column prop="quantity" label="数量" width="70" align="right" />
              <el-table-column prop="pieces" label="件数" width="70" align="right" />
              <el-table-column prop="volume" label="CBM" width="80" align="right" />
              <el-table-column prop="gross_weight" label="毛重(kg)" width="90" align="right" />
              <el-table-column prop="net_weight" label="净重(kg)" width="90" align="right" />
            </el-table>
          </div>
        </el-tab-pane>

        <!-- ── Tab 2: 核对提单 ── -->
        <el-tab-pane label="核对提单" name="verify">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
            <span style="font-weight: 600; color: #303133;">已保存的提单记录</span>
            <el-button size="small" @click="loadRecords">刷新</el-button>
          </div>

          <el-table
            :data="blRecords"
            v-loading="loadingRecords"
            border
            stripe
            style="width: 100%;"
            @row-click="openRecord"
            row-style="cursor: pointer;"
          >
            <el-table-column prop="file_name" label="文件名" min-width="180">
              <template #default="{ row }">
                <span style="font-weight: 500; color: #409eff;">{{ row.file_name }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="so_number" label="SO号" min-width="130" show-overflow-tooltip />
            <el-table-column prop="container_type" label="柜型" width="90" />
            <el-table-column prop="item_count" label="明细行数" width="80" align="center" />
            <el-table-column prop="total_pieces" label="总件数" width="80" align="right" />
            <el-table-column prop="total_cbm" label="总CBM" width="90" align="right" />
            <el-table-column prop="email_subject" label="邮件主题" min-width="200" show-overflow-tooltip />
            <el-table-column prop="verified" label="核对状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.verified ? 'success' : 'info'" size="small">
                  {{ row.verified ? '已核对' : '未核对' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="保存时间" width="140" />
            <el-table-column label="操作" width="100" align="center" @click.stop>
              <template #default="{ row }">
                <el-button
                  type="danger"
                  size="small"
                  link
                  @click.stop="deleteRecord(row)"
                >删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 详情抽屉 -->
          <el-drawer
            v-model="drawerVisible"
            :title="currentRecord?.file_name || '提单详情'"
            size="70%"
            direction="rtl"
          >
            <template v-if="currentRecord">
              <!-- 基本信息 -->
              <el-descriptions :column="3" border size="small" style="margin-bottom: 16px;">
                <el-descriptions-item label="文件名">{{ currentRecord.file_name }}</el-descriptions-item>
                <el-descriptions-item label="SO号">{{ currentRecord.so_number || '-' }}</el-descriptions-item>
                <el-descriptions-item label="柜型">{{ currentRecord.container_type || '-' }}</el-descriptions-item>
                <el-descriptions-item label="总件数">{{ currentRecord.total_pieces }}</el-descriptions-item>
                <el-descriptions-item label="总CBM">{{ currentRecord.total_cbm }}</el-descriptions-item>
                <el-descriptions-item label="保存时间">{{ currentRecord.created_at }}</el-descriptions-item>
                <el-descriptions-item label="邮件主题" :span="3">{{ currentRecord.email_subject || '-' }}</el-descriptions-item>
              </el-descriptions>

              <!-- 核对按钮 -->
              <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
                <el-button
                  type="primary"
                  :loading="verifying"
                  :disabled="!currentRecord.shipment_id"
                  @click="doVerify"
                >
                  与当前出货单核对
                </el-button>
                <span v-if="!currentRecord.shipment_id" style="color: #909399; font-size: 12px;">
                  （该记录未关联出货单，无法自动核对）
                </span>
                <el-tag v-if="currentRecord.verified" type="success" size="small">已核对</el-tag>
              </div>

              <!-- 核对结果 -->
              <div v-if="verifyResult">
                <el-alert
                  :type="verifyResult.mismatch_count === 0 && verifyResult.only_in_saved_count === 0 && verifyResult.only_in_live_count === 0 ? 'success' : 'warning'"
                  :title="`核对完成：${verifyResult.match_count} 行一致 / ${verifyResult.mismatch_count} 行有差异 / ${verifyResult.only_in_saved_count} 行仅在快照 / ${verifyResult.only_in_live_count} 行仅在当前`"
                  :closable="false"
                  style="margin-bottom: 12px;"
                />

                <!-- 差异明细 -->
                <div v-if="verifyResult.mismatched?.length" style="margin-bottom: 12px;">
                  <div style="font-weight: 600; color: #e6a23c; margin-bottom: 6px;">差异行（{{ verifyResult.mismatched.length }} 行）</div>
                  <el-table :data="verifyResult.mismatched" border size="small">
                    <el-table-column prop="product_code" label="货号" width="100" />
                    <el-table-column prop="contract_number" label="合同号" width="100" />
                    <el-table-column prop="product_name" label="货名" min-width="140" show-overflow-tooltip />
                    <el-table-column label="件数（保存/当前）" width="130" align="center">
                      <template #default="{ row }">
                        <span v-if="row.diffs?.pieces" style="color: #f56c6c;">
                          {{ row.saved.pieces }} → {{ row.live.pieces }}
                        </span>
                        <span v-else>{{ row.saved.pieces }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="CBM（保存/当前）" width="130" align="center">
                      <template #default="{ row }">
                        <span v-if="row.diffs?.volume" style="color: #f56c6c;">
                          {{ row.saved.volume }} → {{ row.live.volume }}
                        </span>
                        <span v-else>{{ row.saved.volume }}</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>

                <!-- 仅在快照中 -->
                <div v-if="verifyResult.only_in_saved?.length" style="margin-bottom: 12px;">
                  <div style="font-weight: 600; color: #f56c6c; margin-bottom: 6px;">仅在提单快照中（{{ verifyResult.only_in_saved.length }} 行，当前出货单已删除或修改）</div>
                  <el-table :data="verifyResult.only_in_saved" border size="small">
                    <el-table-column prop="product_code" label="货号" width="100" />
                    <el-table-column prop="contract_number" label="合同号" width="100" />
                    <el-table-column prop="product_name" label="货名" min-width="160" />
                    <el-table-column prop="pieces" label="件数" width="70" align="right" />
                    <el-table-column prop="volume" label="CBM" width="80" align="right" />
                  </el-table>
                </div>

                <!-- 仅在当前出货单中 -->
                <div v-if="verifyResult.only_in_live?.length" style="margin-bottom: 12px;">
                  <div style="font-weight: 600; color: #409eff; margin-bottom: 6px;">仅在当前出货单中（{{ verifyResult.only_in_live.length }} 行，快照后新增）</div>
                  <el-table :data="verifyResult.only_in_live" border size="small">
                    <el-table-column prop="product_code" label="货号" width="100" />
                    <el-table-column prop="contract_number" label="合同号" width="100" />
                    <el-table-column prop="product_name" label="货名" min-width="160" />
                    <el-table-column prop="pieces" label="件数" width="70" align="right" />
                    <el-table-column prop="volume" label="CBM" width="80" align="right" />
                  </el-table>
                </div>
              </div>

              <!-- 快照明细 -->
              <div>
                <div style="font-weight: 600; margin-bottom: 8px; color: #303133;">
                  提单明细快照（{{ currentRecord.items_snapshot?.length || 0 }} 行）
                </div>
                <el-table :data="currentRecord.items_snapshot" border size="small" max-height="400">
                  <el-table-column prop="product_code" label="货号" min-width="100" />
                  <el-table-column prop="contract_number" label="合同号" min-width="100" />
                  <el-table-column prop="product_name" label="货名" min-width="160" show-overflow-tooltip />
                  <el-table-column prop="quantity" label="数量" width="70" align="right" />
                  <el-table-column prop="pieces" label="件数" width="70" align="right" />
                  <el-table-column prop="volume" label="CBM" width="80" align="right" />
                  <el-table-column prop="gross_weight" label="毛重" width="80" align="right" />
                  <el-table-column prop="net_weight" label="净重" width="80" align="right" />
                </el-table>
              </div>
            </template>
          </el-drawer>
        </el-tab-pane>

        <!-- ── Tab 3: 从邮箱找提单 ── -->
        <el-tab-pane label="从邮箱找提单" name="imap">
          <!-- 配置区 -->
          <el-form inline style="margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
            <el-form-item label="搜索关键词">
              <el-input v-model="imapKeyword" placeholder="提单 B/L BL" style="width: 160px;" />
            </el-form-item>
            <el-form-item label="出货日期范围">
              <el-date-picker
                v-model="imapDateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                style="width: 240px;"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="imapSearching" @click="searchImapBL">搜索邮件</el-button>
              <el-button :loading="imapLoadingAll" @click="loadAllImapBL">显示全部</el-button>
            </el-form-item>
          </el-form>

          <div style="color: #909399; font-size: 12px; margin-bottom: 12px;">
            说明：搜索关键词在邮箱 INBOX 中查找包含"提单/B/L"的邮件，导入后自动与
            <strong>{{ imapDateRange[0] }} ~ {{ imapDateRange[1] }}</strong> 期间的出货单匹配。
          </div>

          <!-- 邮件列表 -->
          <el-table
            :data="imapEmails"
            v-loading="imapSearching || imapLoadingAll"
            border
            size="small"
            style="width: 100%; margin-bottom: 16px;"
          >
            <el-table-column prop="date" label="日期" width="180" />
            <el-table-column prop="subject" label="主题" min-width="300" show-overflow-tooltip />
            <el-table-column prop="sender" label="发件人" min-width="180" show-overflow-tooltip />
            <el-table-column label="操作" width="160" align="center">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  :loading="row._importing"
                  :disabled="row._matched"
                  @click="importAndMatch(row)"
                >
                  {{ row._matched ? '已匹配' : '导入并匹配' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 匹配结果 -->
          <div v-if="imapMatchResult">
            <el-divider content-position="left">
              匹配结果 — {{ imapMatchResult.email_subject }}
              <el-tag size="small" type="info" style="margin-left: 8px;">
                PL {{ imapMatchResult.pl_item_count }} 行 / SO: {{ imapMatchResult.so_from_email || '-' }}
              </el-tag>
            </el-divider>

            <div v-if="!imapMatchResult.groups?.length" style="color: #909399; text-align: center; padding: 20px;">
              未找到匹配的出货单（日期范围: {{ imapMatchResult.date_range }}）
            </div>

            <div
              v-for="group in imapMatchResult.groups"
              :key="group.shipment_id"
              style="margin-bottom: 16px; border: 1px solid #e4e7ed; border-radius: 8px; overflow: hidden;"
            >
              <!-- 分组标题 -->
              <div style="background: #f5f7fa; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                  <span style="font-weight: 600; font-size: 15px; color: #303133;">{{ group.file_name }}</span>
                  <el-tag size="small" :type="group.match_score >= 10 ? 'success' : group.match_score >= 5 ? 'warning' : 'info'">
                    匹配度 {{ group.match_score }}
                  </el-tag>
                  <span style="color: #606266; font-size: 13px;">{{ group.container_type }}</span>
                  <span v-if="group.so_number" style="color: #606266; font-size: 13px;">SO: {{ group.so_number }}</span>
                  <span style="color: #606266; font-size: 13px;">{{ group.total_pieces }} 件 / {{ group.total_cbm }} CBM</span>
                  <el-tag v-if="group.already_saved" size="small" type="success">已保存</el-tag>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <el-input v-model="group._edit_name" size="small" style="width: 180px;" :placeholder="group.file_name" />
                  <el-button type="success" size="small" :loading="group._saving" @click="autoSaveFromImap(group)">
                    保存提单
                  </el-button>
                </div>
              </div>

              <!-- 匹配理由 -->
              <div style="padding: 6px 16px; font-size: 12px; color: #67c23a; border-bottom: 1px solid #f0f0f0;">
                匹配依据：{{ group.match_reasons?.join(' / ') || '-' }}
              </div>

              <!-- 明细 -->
              <el-table :data="group.items" size="small" border style="width: 100%;">
                <el-table-column prop="product_code" label="货号" min-width="100" />
                <el-table-column prop="contract_number" label="合同号" min-width="100" />
                <el-table-column prop="product_name" label="货名" min-width="160" show-overflow-tooltip />
                <el-table-column prop="quantity" label="数量" width="70" align="right" />
                <el-table-column prop="pieces" label="件数" width="70" align="right" />
                <el-table-column prop="volume" label="CBM" width="80" align="right" />
                <el-table-column prop="gross_weight" label="毛重" width="80" align="right" />
                <el-table-column prop="net_weight" label="净重" width="80" align="right" />
              </el-table>
            </div>
          </div>
        </el-tab-pane>

      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { searchBL, saveBL, listBL, getBL, deleteBL, verifyBL, matchFromEmail } from '../../api/billOfLading'
import { searchMailboxApi, importMailboxApi } from '../../api/emails'

const activeTab = ref('find')

// ── 找提单 ──────────────────────────────────────────────────────────────────

const searchForm = reactive({
  product_code: '',
  contract_number: '',
  email_subject: '',
  pieces: '',
  cbm: '',
})
const searching = ref(false)
const searched = ref(false)
const searchGroups = ref([])

async function doSearch() {
  const params = {}
  if (searchForm.product_code) params.product_code = searchForm.product_code
  if (searchForm.contract_number) params.contract_number = searchForm.contract_number
  if (searchForm.email_subject) params.email_subject = searchForm.email_subject
  if (searchForm.pieces) params.pieces = searchForm.pieces
  if (searchForm.cbm) params.cbm = searchForm.cbm

  if (!Object.keys(params).length) {
    ElMessage.warning('请至少填写一个搜索条件')
    return
  }

  searching.value = true
  try {
    const groups = await searchBL(params)
    // 给每个分组加可编辑的文件名和保存状态
    searchGroups.value = groups.map(g => ({
      ...g,
      _edit_name: g.file_name,
      _saving: false,
    }))
    searched.value = true
    if (!groups.length) ElMessage.info('未找到匹配记录')
  } catch (e) {
    ElMessage.error('搜索失败：' + (e.response?.data?.error || e.message))
  } finally {
    searching.value = false
  }
}

function resetSearch() {
  Object.keys(searchForm).forEach(k => (searchForm[k] = ''))
  searchGroups.value = []
  searched.value = false
}

async function autoSave(group) {
  group._saving = true
  try {
    const fileName = (group._edit_name || '').trim() || group.file_name
    const result = await saveBL({
      shipment_id: group.shipment_id,
      file_name: fileName,
      email_subject: group.email_subject,
    })
    group.already_saved = true
    ElMessage.success(`已自动保存：${result.file_name}（${result.item_count} 行，${result.total_cbm} CBM）`)
    // 刷新核对列表
    if (activeTab.value === 'verify') loadRecords()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.response?.data?.error || e.message))
  } finally {
    group._saving = false
  }
}

// ── 核对提单 ─────────────────────────────────────────────────────────────────

const blRecords = ref([])
const loadingRecords = ref(false)
const drawerVisible = ref(false)
const currentRecord = ref(null)
const verifying = ref(false)
const verifyResult = ref(null)

async function loadRecords() {
  loadingRecords.value = true
  try {
    blRecords.value = await listBL()
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loadingRecords.value = false
  }
}

async function openRecord(row) {
  verifyResult.value = null
  try {
    currentRecord.value = await getBL(row.id)
    drawerVisible.value = true
  } catch (e) {
    ElMessage.error('加载详情失败')
  }
}

async function doVerify() {
  if (!currentRecord.value) return
  verifying.value = true
  verifyResult.value = null
  try {
    const result = await verifyBL(currentRecord.value.id)
    verifyResult.value = result
    currentRecord.value.verified = true
    // 刷新列表状态
    const idx = blRecords.value.findIndex(r => r.id === currentRecord.value.id)
    if (idx >= 0) blRecords.value[idx].verified = true
    if (result.mismatch_count === 0 && result.only_in_saved_count === 0 && result.only_in_live_count === 0) {
      ElMessage.success(`核对完成，${result.match_count} 行全部一致！`)
    } else {
      ElMessage.warning(`核对完成，发现差异，请查看详情`)
    }
  } catch (e) {
    ElMessage.error('核对失败：' + (e.response?.data?.error || e.message))
  } finally {
    verifying.value = false
  }
}

async function deleteRecord(row) {
  await ElMessageBox.confirm(`确认删除提单记录「${row.file_name}」？`, '确认', { type: 'warning' })
  try {
    await deleteBL(row.id)
    blRecords.value = blRecords.value.filter(r => r.id !== row.id)
    if (currentRecord.value?.id === row.id) {
      drawerVisible.value = false
      currentRecord.value = null
    }
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

// ── 从邮箱找提单 ──────────────────────────────────────────────────────────────

const imapKeyword = ref('提单')
const imapDateRange = ref(['2025-10-01', '2026-03-31'])
const imapEmails = ref([])
const imapSearching = ref(false)
const imapLoadingAll = ref(false)
const imapMatchResult = ref(null)

async function searchImapBL() {
  imapSearching.value = true
  imapEmails.value = []
  imapMatchResult.value = null
  try {
    const kw = imapKeyword.value || '提单'
    const [dateFrom, dateTo] = imapDateRange.value || []
    const res = await searchMailboxApi({
      folder: 'INBOX',
      subject: kw,
      date_from: dateFrom,
      date_to: dateTo,
    })
    const list = res.emails || []
    imapEmails.value = (list || []).map(e => ({ ...e, _importing: false, _matched: false }))
    if (!imapEmails.value.length) ElMessage.info('未找到包含该关键词的邮件')
  } catch (e) {
    ElMessage.error('搜索失败：' + (e.response?.data?.error || e.message))
  } finally {
    imapSearching.value = false
  }
}

async function loadAllImapBL() {
  imapLoadingAll.value = true
  imapEmails.value = []
  imapMatchResult.value = null
  try {
    // 搜索多个关键词合并
    const keywords = ['提单', 'B/L', 'BL', 'BILL OF LADING']
    const seen = new Set()
    const combined = []
    const [dateFrom, dateTo] = imapDateRange.value || []
    for (const kw of keywords) {
      try {
        const res = await searchMailboxApi({
          folder: 'INBOX',
          subject: kw,
          date_from: dateFrom,
          date_to: dateTo,
        })
        const list = res.emails || []
        for (const e of (list || [])) {
          if (!seen.has(e.uid)) {
            seen.add(e.uid)
            combined.push({ ...e, _importing: false, _matched: false })
          }
        }
      } catch (_) {}
    }
    // 按日期降序
    combined.sort((a, b) => new Date(b.date) - new Date(a.date))
    imapEmails.value = combined
    if (!combined.length) ElMessage.info('未找到提单相关邮件')
    else ElMessage.success(`共找到 ${combined.length} 封提单相关邮件`)
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    imapLoadingAll.value = false
  }
}

async function importAndMatch(emailRow) {
  emailRow._importing = true
  imapMatchResult.value = null
  try {
    // 1. 导入邮件
    const result = await importMailboxApi({ uids: [emailRow.uid], folder: 'INBOX', mode: 'rule' })
    const item = result.results?.[0]
    if (!item?.ok) throw new Error(item?.error || '导入失败')
    const emailRecordId = item.email_record_id
    if (!emailRecordId) {
      ElMessage.warning('邮件导入成功，但未生成记录 ID，无法自动匹配')
      return
    }

    // 2. 匹配出货单
    const [dateFrom, dateTo] = imapDateRange.value
    const matchResult = await matchFromEmail(emailRecordId, dateFrom, dateTo)

    // 给每个匹配组加可编辑名称
    matchResult.groups = (matchResult.groups || []).map(g => ({
      ...g,
      _edit_name: g.file_name,
      _saving: false,
    }))

    imapMatchResult.value = matchResult
    emailRow._matched = true

    if (matchResult.groups.length) {
      ElMessage.success(`匹配到 ${matchResult.groups.length} 个出货单，请确认后保存`)
    } else {
      ElMessage.warning(`未找到匹配的出货单（日期范围: ${dateFrom} ~ ${dateTo}）`)
    }
  } catch (e) {
    ElMessage.error('导入匹配失败：' + (e.response?.data?.error || e.message))
  } finally {
    emailRow._importing = false
  }
}

async function autoSaveFromImap(group) {
  group._saving = true
  try {
    const fileName = (group._edit_name || '').trim() || group.file_name
    const result = await saveBL({
      shipment_id: group.shipment_id,
      file_name: fileName,
      email_subject: imapMatchResult.value?.email_subject || group.email_subject,
    })
    group.already_saved = true
    ElMessage.success(`已保存：${result.file_name}（${result.item_count} 行，${result.total_cbm} CBM）`)
    loadRecords()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.response?.data?.error || e.message))
  } finally {
    group._saving = false
  }
}

onMounted(() => {
  loadRecords()
})
</script>
