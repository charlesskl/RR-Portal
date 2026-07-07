<template>
  <div>
    <el-card>
      <template #header>
        <span style="font-size: 18px; font-weight: bold;">邮件导入</span>
      </template>

      <!-- 上传区域：支持多文件 -->
      <el-upload
        ref="uploadRef"
        drag
        multiple
        :auto-upload="false"
        accept=".eml"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
      >
        <el-icon style="font-size: 48px; color: #409eff;"><UploadFilled /></el-icon>
        <div style="margin-top: 8px;">将 .eml 文件拖到此处，或 <em>点击上传</em>（支持多封邮件）</div>
      </el-upload>

      <div style="margin-top: 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <el-button type="primary" :loading="parsing" :disabled="!fileList.length" @click="parseEmails">
          解析邮件 ({{ fileList.length }} 封)
        </el-button>
        <el-button type="success" :loading="aiParsing" :disabled="!fileList.length" @click="aiParseEmails">
          🤖 AI 智能解析
        </el-button>
        <span v-if="parsing" style="color: #909399; font-size: 13px;">
          正在解析第 {{ parseProgress }} / {{ fileList.length }} 封...
        </span>
      </div>
    </el-card>

    <!-- 从邮箱直接导入 -->
    <el-card style="margin-top: 24px;">
      <template #header><span style="font-weight:600;">从邮箱直接导入</span></template>

      <!-- 状态一：未配置 -->
      <div v-if="!mailboxConfigured">
        <el-form :model="mailboxForm" label-width="120px" style="max-width:480px;">
          <el-form-item label="邮件服务器">
            <el-input v-model="mailboxForm.imap_host" placeholder="imaphz.qiye.163.com" />
          </el-form-item>
          <el-form-item label="邮箱地址">
            <el-input v-model="mailboxForm.email" placeholder="your@company.com" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="mailboxForm.password" type="password" show-password />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="mailboxSaving" @click="saveMailboxConfig">保存并连接</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 状态二：已配置 -->
      <div v-else>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <el-tag type="success">已连接 {{ mailboxEmail }}</el-tag>
          <el-button size="small" type="warning" @click="mailboxConfigured = false; mailboxForm.password = ''">修改配置</el-button>
        </div>

        <!-- 搜索栏 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <el-select v-model="mailboxFolder" style="width:110px;">
            <el-option label="收件箱" value="INBOX" />
            <el-option :label="sentFolderLabel" :value="sentFolder" />
          </el-select>
          <el-input v-model="mailboxSubject" placeholder="主题关键词" style="width:220px;" clearable @keyup.enter="doSearch" />
          <el-input v-model="mailboxSender" placeholder="发件人" style="width:180px;" clearable />
          <el-date-picker
            v-model="mailboxDateRange"
            type="daterange"
            range-separator="~"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width:240px;"
            value-format="YYYY-MM-DD"
          />
          <el-button type="primary" :loading="mailboxSearching" @click="doSearch">搜索</el-button>
          <el-button :loading="mailboxSearching" @click="doShowRecent">最近邮件</el-button>
        </div>

        <!-- 结果表格 -->
        <el-table
          ref="mailboxTableRef"
          :data="mailboxEmails"
          border
          stripe
          size="small"
          max-height="320"
          v-loading="mailboxSearching"
          @selection-change="onMailboxSelect"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column label="📎" width="36">
            <template #default="{ row }">
              <span v-if="row.has_attachment" style="color:#e6a23c;font-size:14px;">📎</span>
              <span v-else style="color:#ccc;font-size:14px;">📎</span>
            </template>
          </el-table-column>
          <el-table-column label="附件" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ (row.attachments || []).join(', ') || '-' }}</template>
          </el-table-column>
          <el-table-column prop="subject" label="主题" min-width="320" show-overflow-tooltip />
          <el-table-column prop="sender" label="发件人" width="180" show-overflow-tooltip />
          <el-table-column prop="date" label="日期" width="110" />
          <el-table-column label="操作" width="150">
            <template #default="{ row }">
              <el-button size="small" type="primary" :loading="mailboxImporting" @click.stop="importOne(row.uid)">导入</el-button>
              <el-button size="small" type="success" :loading="aiParsing" @click.stop="aiParseOne(row.uid)">🤖 AI</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 批量操作栏 -->
        <div v-if="mailboxSelected.length" style="margin-top:10px;display:flex;align-items:center;gap:12px;">
          <span style="color:#606266;">已选 {{ mailboxSelected.length }} 封</span>
          <el-button type="primary" :loading="mailboxImporting" @click="batchImport('rule')">批量导入（规则解析）</el-button>
          <el-button type="success" :loading="aiParsing" @click="batchImport('ai')">批量 AI 解析</el-button>
        </div>
      </div>
    </el-card>

    <!-- 历史解析记录（可折叠） -->
    <el-card style="margin-top: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" @click="showRecords = !showRecords">
        <span style="font-size: 16px; font-weight: bold;">
          <el-icon style="vertical-align: middle; margin-right: 4px;">
            <ArrowRight v-if="!showRecords" /><ArrowDown v-else />
          </el-icon>
          解析记录 ({{ emailRecords.length }})
        </span>
        <el-button size="small" @click.stop="loadRecords" :loading="loadingRecords">刷新</el-button>
      </div>
      <div v-show="showRecords" style="margin-top: 12px;">
        <el-table :data="emailRecords" border stripe size="small" v-loading="loadingRecords" @row-click="viewRecord" max-height="400">
          <el-table-column prop="id" label="ID" width="50" />
          <el-table-column prop="subject" label="邮件主题" min-width="300" show-overflow-tooltip />
          <el-table-column prop="sender" label="发件人" width="160" show-overflow-tooltip />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="PL项数" width="70">
            <template #default="{ row }">
              {{ row.parsed_data?.packing_list_items?.length || 0 }}
            </template>
          </el-table-column>
          <el-table-column label="时间" width="150">
            <template #default="{ row }">
              {{ formatTime(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" @click.stop="viewRecord(row)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 解析结果预览 -->
    <el-card v-if="merged" style="margin-top: 16px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 16px; font-weight: bold;">
            解析结果（合并 {{ parsedResults.length }} 封邮件）
          </span>
          <el-button size="small" @click="showEmailList = !showEmailList">
            {{ showEmailList ? '隐藏' : '查看' }}各邮件详情
          </el-button>
        </div>
      </template>

      <!-- 多柜分组选择（只有多个不同工厂时才显示） -->
      <div v-if="containerGroups.length > 1" style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border-radius: 8px; border: 1px solid #b3d8ff;">
        <div style="margin-bottom: 8px; font-weight: 600; color: #303133;">多柜分组（共 {{ containerGroups.length }} 组，选择要创建的柜）</div>
        <el-radio-group v-model="selectedGroupIdx" size="default" @change="onGroupChange">
          <el-radio-button v-for="(g, i) in containerGroups" :key="i" :value="i">
            {{ g.group_label }}（{{ g.packing_list_items.length }} 项 / {{ g.total_cbm }} CBM）
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 各邮件来源列表 -->
      <div v-if="showEmailList" style="margin-bottom: 16px;">
        <el-table :data="emailSources" border size="small">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="subject" label="邮件主题" min-width="300" />
          <el-table-column prop="itemCount" label="PL项数" width="80" />
          <el-table-column prop="so_number" label="SO号" width="140" />
        </el-table>
      </div>

      <!-- 交仓类型：只显示关键字段 -->
      <el-descriptions v-if="merged.shipment_type === 'warehouse'" :column="3" border>
        <el-descriptions-item label="仓库">{{ merged.warehouse || '-' }}</el-descriptions-item>
        <el-descriptions-item label="吨车类型">{{ merged.truck_type || '-' }}</el-descriptions-item>
        <el-descriptions-item label="收货国家">{{ merged.country || merged.delivery_address || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入仓时间">
          <el-input v-model="editShipDate" size="small" style="width: 120px;" />
        </el-descriptions-item>
        <el-descriptions-item label="截数期">{{ merged.cutoff_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="订舱号">{{ merged.so_number || '-' }}</el-descriptions-item>
      </el-descriptions>

      <!-- 整柜/客上柜类型：完整字段 -->
      <el-descriptions v-else :column="3" border>
        <el-descriptions-item label="SO号">{{ merged.so_number || '-' }}</el-descriptions-item>
        <el-descriptions-item label="柜型">{{ merged.container_type || '-' }}</el-descriptions-item>
        <el-descriptions-item label="SI截止">
          <el-input v-model="editSiDeadline" size="small" style="width: 120px;" @input="onSiChange" />
        </el-descriptions-item>
        <el-descriptions-item label="出货时间">
          <el-input v-model="editShipDate" size="small" style="width: 120px;" />
        </el-descriptions-item>
        <el-descriptions-item label="截数期">{{ merged.cutoff_date || '-' }}</el-descriptions-item>
        <el-descriptions-item label="港口">{{ merged.port || '-' }}</el-descriptions-item>
        <el-descriptions-item label="收货地">{{ merged.delivery_address || '-' }}</el-descriptions-item>
        <el-descriptions-item label="报关行">{{ merged.customs_broker || '-' }}</el-descriptions-item>
        <el-descriptions-item label="CBM总和" :span="2">
          <span v-if="factoryCbmList.length">
            <span v-for="(fc, i) in factoryCbmList" :key="i">
              {{ fc.factory }}：{{ fc.cbm }}
              <span v-if="i < factoryCbmList.length - 1">；</span>
            </span>
            （合计：{{ merged.total_cbm }}）
          </span>
          <span v-else>{{ merged.total_cbm || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="国家">{{ merged.country || '-' }}</el-descriptions-item>
        <el-descriptions-item label="吨车类型" v-if="merged.truck_type">{{ merged.truck_type }}</el-descriptions-item>
        <el-descriptions-item label="特殊要求">{{ merged.special_requirements || '-' }}</el-descriptions-item>
      </el-descriptions>

      <!-- Packing List 表格（交仓无 PL 时不显示） -->
      <div v-if="merged.shipment_type !== 'warehouse' || (merged.packing_list_items?.length > 0)" style="margin-top: 16px;">
        <!-- 多柜分组展示 -->
        <template v-if="plGroups.length > 1">
          <div v-for="(grp, gi) in plGroups" :key="gi" style="margin-bottom: 20px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;padding:2px 10px;background:#409eff;color:#fff;border-radius:4px;">
                {{ grp.label }}
              </span>
              <span style="color:#606266;font-size:13px;">{{ grp.items.length }} 项 / CBM {{ grp.cbm }}</span>
            </div>
            <el-table :data="grp.items" border stripe style="width:100%" max-height="400" size="small">
              <el-table-column prop="product_code" label="货号" min-width="90" />
              <el-table-column prop="contract_number" label="合同号" min-width="100" />
              <el-table-column prop="quantity" label="数量" width="70" />
              <el-table-column prop="pieces" label="件数" width="70" />
              <el-table-column prop="customer_po" label="客PO" min-width="100" />
              <el-table-column label="CBM" width="85">
                <template #default="{ row }">{{ row.volume != null ? Number(row.volume).toFixed(3) : '-' }}</template>
              </el-table-column>
              <el-table-column label="工厂" min-width="70">
                <template #default="{ row }">{{ row.factory_remark || '' }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>
        <!-- 单组平铺展示 -->
        <template v-else>
          <h4>Packing List 明细 ({{ merged.packing_list_items?.length || 0 }} 项)</h4>
          <el-table :data="merged.packing_list_items || []" border stripe style="width: 100%" max-height="500">
            <el-table-column prop="product_code" label="货号" min-width="100" />
            <el-table-column prop="contract_number" label="合同号" min-width="100" />
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column prop="pieces" label="件数" width="80" />
            <el-table-column label="每单总件数" width="100">
              <template #default="{ row }">
                {{ row.total_pieces_per_order != null ? row.total_pieces_per_order : (row.pieces || '-') }}
              </template>
            </el-table-column>
            <el-table-column prop="pallet_count" label="卡板数" width="80" />
            <el-table-column prop="customer_po" label="客PO" min-width="100" />
            <el-table-column label="体积(CBM)" width="100">
              <template #default="{ row }">
                {{ row.volume != null ? Number(row.volume).toFixed(3) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="工厂" min-width="80">
              <template #default="{ row }">
                {{ row.factory_remark || '' }}
              </template>
            </el-table-column>
            <el-table-column prop="box_dimensions" label="长宽高(cm)" min-width="120" v-if="!isCabinet" />
            <el-table-column prop="_source_email" label="来源邮件" width="60" v-if="parsedResults.length > 1" />
          </el-table>
        </template>
      </div>

      <div style="margin-top: 16px; text-align: right;">
        <el-button type="success" size="large" :loading="creating" @click="confirmCreate">
          确认创建出货单
        </el-button>
      </div>
    </el-card>

    <!-- AI 审核面板 -->
    <el-dialog v-model="showAiPanel" title="🤖 AI 智能解析结果审核" width="90%" top="5vh" :close-on-click-modal="false">
      <AiParseReviewPanel
        :result="aiResult"
        @confirmed="onAiConfirmed"
        @cancel="showAiPanel = false"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { importEmail, listEmails, getMailboxConfig, saveMailboxConfigApi, searchMailboxApi, importMailboxApi } from '../../api/emails'
import { createShipmentFromEmail } from '../../api/shipments'
import { ElMessage } from 'element-plus'
import AiParseReviewPanel from '../../components/AiParseReviewPanel.vue'
import { aiParseEmail } from '../../api/aiParser'

const router = useRouter()
const uploadRef = ref(null)
const fileList = ref([])
const parsing = ref(false)
const parseProgress = ref(0)

const creating = ref(false)

// 邮箱配置状态
const mailboxConfigured = ref(false)
const mailboxEmail = ref('')
const mailboxForm = ref({ email: '', password: '', imap_host: 'imaphz.qiye.163.com', imap_port: 993 })
const mailboxSaving = ref(false)

// 搜索状态
const mailboxFolder = ref('INBOX')
const sentFolder = ref('Sent Messages')
const sentFolderLabel = ref('已发送')
const mailboxSubject = ref('')
const mailboxSender = ref('')
const mailboxDateRange = ref(null)
const mailboxSearching = ref(false)
const mailboxEmails = ref([])
const mailboxSelected = ref([])
const mailboxTableRef = ref(null)
const mailboxImporting = ref(false)
const parsedResults = ref([])  // 多封邮件的解析结果数组
const showEmailList = ref(false)

// TJX 多柜分组
const selectedGroupIdx = ref(0)

// 持久化：从 localStorage 恢复解析结果
const STORAGE_KEY = 'email_import_parsed'
function saveParsed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      results: parsedResults.value,
      groupIdx: selectedGroupIdx.value,
    }))
  } catch (e) { /* ignore */ }
}
function loadParsed() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const { results, groupIdx } = JSON.parse(saved)
      if (results?.length) {
        parsedResults.value = results
        selectedGroupIdx.value = groupIdx || 0
      }
    }
  } catch (e) { /* ignore */ }
}
function clearParsed() {
  localStorage.removeItem(STORAGE_KEY)
}

// 历史记录
const emailRecords = ref([])
const loadingRecords = ref(false)
const showRecords = ref(false)

async function loadRecords() {
  loadingRecords.value = true
  try {
    emailRecords.value = await listEmails()
  } catch (e) {
    console.error(e)
  } finally {
    loadingRecords.value = false
  }
}

function viewRecord(row) {
  // 点击记录直接预览解析结果
  parsedResults.value = [{
    email_record_id: row.id,
    subject: row.subject,
    parsed: row.parsed_data,
  }]
  selectedGroupIdx.value = 0
  saveParsed()
  // 滚动到解析结果区域
  setTimeout(() => {
    document.querySelector('.el-card:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 100)
}

function statusLabel(s) {
  return { unprocessed: '未处理', parsed: '已解析', shipment_created: '已创建出货单', parse_failed: '解析失败' }[s] || s
}

function statusType(s) {
  return { parsed: 'success', shipment_created: 'info', parse_failed: 'danger', unprocessed: 'warning' }[s] || ''
}

function formatTime(t) {
  if (!t) return '-'
  return t.replace('T', ' ').substring(0, 19)
}

// ── 新版邮箱配置与搜索函数 ──────────────────────────────────────────────────

async function loadMailboxConfig() {
  try {
    const cfg = await getMailboxConfig()
    if (cfg.configured) {
      mailboxConfigured.value = true
      mailboxEmail.value = cfg.email
      mailboxForm.value.email = cfg.email
      mailboxForm.value.imap_host = cfg.imap_host || 'imaphz.qiye.163.com'
      mailboxForm.value.imap_port = cfg.imap_port || 993
    }
  } catch (e) { /* ignore */ }
}

async function saveMailboxConfig() {
  if (!mailboxForm.value.email) { ElMessage.warning('请输入邮箱地址'); return }
  mailboxSaving.value = true
  try {
    await saveMailboxConfigApi(mailboxForm.value)
    mailboxConfigured.value = true
    mailboxEmail.value = mailboxForm.value.email
    ElMessage.success('邮箱配置已保存')
  } catch (e) {
    ElMessage.error('配置失败：' + (e.response?.data?.error || e.message))
  } finally {
    mailboxSaving.value = false
  }
}

function onMailboxSelect(rows) {
  mailboxSelected.value = rows
}

async function doSearch() {
  mailboxSearching.value = true
  try {
    const params = {
      folder: mailboxFolder.value,
      subject: mailboxSubject.value,
      sender: mailboxSender.value,
    }
    if (mailboxDateRange.value) {
      params.date_from = mailboxDateRange.value[0]
      params.date_to = mailboxDateRange.value[1]
    }
    const res = await searchMailboxApi(params)
    mailboxEmails.value = res.emails || []
    if (!mailboxEmails.value.length) ElMessage.warning('未找到匹配邮件')
  } catch (e) {
    ElMessage.error('搜索失败：' + (e.response?.data?.error || e.message))
  } finally {
    mailboxSearching.value = false
  }
}

async function doShowRecent() {
  mailboxSubject.value = ''
  mailboxSender.value = ''
  mailboxDateRange.value = null
  await doSearch()
}

async function importOne(uid) {
  mailboxImporting.value = true
  try {
    const res = await importMailboxApi({ uids: [uid], folder: mailboxFolder.value, mode: 'rule' })
    const item = res.results?.[0]
    if (!item?.ok) throw new Error(item?.error || '解析失败')
    const p = item.parsed || {}
    parsedResults.value = [{ email_record_id: item.email_record_id, subject: p.subject || '邮件', parsed: p }]
    ElMessage.success('导入成功')
    saveParsed()
    await loadRecords()
  } catch (e) {
    ElMessage.error('导入失败：' + (e.response?.data?.error || e.message))
  } finally {
    mailboxImporting.value = false
  }
}

async function aiParseOne(uid) {
  aiParsing.value = true
  try {
    const res = await importMailboxApi({ uids: [uid], folder: mailboxFolder.value, mode: 'ai' })
    const item = res.results?.[0]
    if (!item?.ok) throw new Error(item?.error || 'AI解析失败')
    aiResult.value = item.parsed
    showAiPanel.value = true
  } catch (e) {
    ElMessage.error('AI解析失败：' + (e.response?.data?.error || e.message))
  } finally {
    aiParsing.value = false
  }
}

async function batchImport(mode) {
  if (!mailboxSelected.value.length) return
  const uids = mailboxSelected.value.map(r => r.uid)
  if (mode === 'ai') {
    aiParsing.value = true
  } else {
    mailboxImporting.value = true
  }
  try {
    const res = await importMailboxApi({ uids, folder: mailboxFolder.value, mode })
    const ok = res.results?.filter(r => r.ok) || []
    const fail = res.results?.filter(r => !r.ok) || []
    if (mode === 'rule') {
      parsedResults.value = ok.map(r => ({
        email_record_id: r.email_record_id,
        subject: r.parsed?.subject || '邮件',
        parsed: r.parsed,
      }))
      if (ok.length) { saveParsed(); await loadRecords() }
    } else if (ok.length) {
      aiResult.value = ok[0].parsed
      showAiPanel.value = true
    }
    if (ok.length) ElMessage.success(`成功处理 ${ok.length} 封`)
    if (fail.length) ElMessage.warning(`${fail.length} 封失败：${fail.map(r => r.error).join('；')}`)
  } catch (e) {
    ElMessage.error('批量操作失败：' + (e.response?.data?.error || e.message))
  } finally {
    aiParsing.value = false
    mailboxImporting.value = false
  }
}

onMounted(() => {
  loadParsed()
  loadRecords()
  loadMailboxConfig()
})

// 合并所有邮件的解析结果
const merged = computed(() => {
  if (!parsedResults.value.length) return null

  const allParsed = parsedResults.value.map(r => r.parsed)

  // 取第一封有值的字段作为主字段
  const result = {
    so_number: '',
    container_type: '',
    si_deadline: '',
    cutoff_date: '',
    port: '',
    delivery_address: '',
    customs_broker: '',
    special_requirements: '',
    country: '',
    truck_type: '',
    packing_list_items: [],
    factory_cbm: {},
    total_cbm: 0,
  }

  // 合并各字段：取最后一个非空值（后续邮件通常是更新版，优先级更高）
  const textFields = ['so_number', 'container_type', 'si_deadline', 'ship_date', 'cutoff_date',
    'port', 'delivery_address', 'customs_broker', 'country', 'truck_type', 'zuogui_factory', 'shipment_type']
  for (const field of textFields) {
    for (const p of [...allParsed].reverse()) {
      if (p[field]) {
        result[field] = p[field]
        break
      }
    }
  }

  // 特殊要求：合并所有非空值
  const allReqs = allParsed.map(p => p.special_requirements).filter(Boolean)
  result.special_requirements = [...new Set(allReqs)].join('、')

  // 合并所有 Packing List 明细，标记来源邮件编号
  for (let i = 0; i < allParsed.length; i++) {
    const items = allParsed[i].packing_list_items || []
    for (const item of items) {
      result.packing_list_items.push({
        ...item,
        _source_email: `#${i + 1}`,
      })
    }
  }

  // 合并 factory_cbm
  const cbmMap = {}
  for (const p of allParsed) {
    const fc = p.factory_cbm || {}
    for (const [factory, cbm] of Object.entries(fc)) {
      cbmMap[factory] = Math.round(((cbmMap[factory] || 0) + cbm) * 1000) / 1000
    }
  }
  result.factory_cbm = cbmMap

  // 合计 CBM
  let totalCbm = 0
  for (const cbm of Object.values(cbmMap)) {
    totalCbm += cbm
  }
  result.total_cbm = Math.round(totalCbm * 1000) / 1000

  return result
})

// PL 按 _container_assignment 分组展示
const plGroups = computed(() => {
  const items = merged.value?.packing_list_items || []
  const hasAssign = items.some(it => it._container_assignment)
  if (!hasAssign) return []
  const map = new Map()
  for (const it of items) {
    const key = it._container_assignment || '其他'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(it)
  }
  return [...map.entries()].map(([label, grpItems]) => {
    const cbm = grpItems.reduce((s, it) => s + (parseFloat(it.volume) || 0), 0)
    return { label: label.replace('\n', ' '), items: grpItems, cbm: cbm.toFixed(3) }
  })
})

// TJX 多柜分组
const containerGroups = computed(() => {
  if (!parsedResults.value.length) return []
  const p = parsedResults.value[0]?.parsed
  return p?.container_groups || []
})

function onGroupChange(idx) {
  // 切换分组时，用该组的数据替换 parsed 中的对应字段
  const group = containerGroups.value[idx]
  if (!group || !parsedResults.value.length) return
  const p = parsedResults.value[0].parsed
  p.packing_list_items = group.packing_list_items
  // 分组 SO 优先；为空时保留整体 SO（多柜共享同一订舱号的情况）
  if (group.so_number) p.so_number = group.so_number
  p.container_type = group.container_type
  p.zuogui_factory = group.zuogui_factory
  saveParsed()
}

// 各邮件来源信息
const emailSources = computed(() => {
  return parsedResults.value.map((r, i) => ({
    subject: r.subject || `邮件 #${i + 1}`,
    itemCount: (r.parsed?.packing_list_items || []).length,
    so_number: r.parsed?.so_number || '-',
  }))
})

// 是否柜类型（有柜型且不是吨车）— 柜不显示长宽高
const isCabinet = computed(() => {
  const ct = (merged.value?.container_type || '').toUpperCase()
  return ct && !ct.endsWith('T')
})

// SI截止和出货时间 — 可编辑，联动
const editSiDeadline = ref('')
const editShipDate = ref('')

watch(merged, (val) => {
  if (val) {
    editSiDeadline.value = val.si_deadline || ''
    editShipDate.value = val.ship_date || ''
  }
}, { immediate: true })

function onSiChange(val) {
  const match = val.match(/^(\d{1,2})\/(\d{1,2})/)
  if (match) {
    const m = parseInt(match[1])
    const d = parseInt(match[2])
    const year = new Date().getFullYear()
    const siDate = new Date(year, m - 1, d)
    const shipDate = new Date(siDate.getTime() - 86400000)
    editShipDate.value = `${shipDate.getMonth() + 1}/${shipDate.getDate()}`
  }
}

// AI 解析相关
const aiParsing = ref(false)
const aiResult = ref(null)
const showAiPanel = ref(false)

// CBM 分组列表
const factoryCbmList = computed(() => {
  const map = merged.value?.factory_cbm || {}
  return Object.entries(map).map(([factory, cbm]) => ({ factory, cbm }))
})

async function handleFileChange(file, uploadFiles) {
  // 立即把文件内容读入内存，防止 Foxmail 临时文件被删后无法上传
  if (file.raw && !file._buffer) {
    try {
      file._buffer = await file.raw.arrayBuffer()
      file._name = file.raw.name
    } catch (e) {
      console.warn('[handleFileChange] 文件预读失败:', e)
    }
  }
  fileList.value = uploadFiles
}

function handleFileRemove(file, uploadFiles) {
  fileList.value = uploadFiles
}

async function parseEmails() {
  if (!fileList.value.length) return
  parsing.value = true
  parseProgress.value = 0
  parsedResults.value = []

  try {
    for (let i = 0; i < fileList.value.length; i++) {
      parseProgress.value = i + 1
      const file = fileList.value[i]
      const result = await importEmail(file)
      const p = result.parsed || {}
      console.log('[EML导入] 解析结果:', JSON.stringify({
        type: p.shipment_type, so: p.so_number, si: p.si_deadline,
        cutoff: p.cutoff_date, ship: p.ship_date, country: p.country,
        port: p.port, broker: p.customs_broker,
      }))
      parsedResults.value.push({
        email_record_id: result.email_record_id,
        subject: result.parsed?.subject || file.name,
        parsed: result.parsed,
      })
    }
    ElMessage.success(`成功解析 ${parsedResults.value.length} 封邮件`)
    saveParsed()
  } catch (e) {
    ElMessage.error('邮件解析失败：' + (e.response?.data?.error || e.message))
  } finally {
    parsing.value = false
  }
}


async function aiParseEmails() {
  if (!fileList.value.length) { ElMessage.warning('请先选择 eml 文件'); return }
  const file = fileList.value[0].raw || fileList.value[0]
  aiParsing.value = true
  try {
    const result = await aiParseEmail(file)
    aiResult.value = result
    showAiPanel.value = true
  } catch (e) {
    ElMessage.error('AI 解析失败：' + (e.response?.data?.error || e.message))
  } finally {
    aiParsing.value = false
  }
}

function onAiConfirmed(shipmentId) {
  showAiPanel.value = false
  aiResult.value = null
  ElMessage.success(`出货单 #${shipmentId} 已创建，已跳转到出货单管理`)
  router.push('/shipments')
}

async function confirmCreate() {
  if (!parsedResults.value.length) return
  creating.value = true
  try {
    // 用合并后的数据创建出货单，传所有 email_record_id
    const emailIds = parsedResults.value.map(r => r.email_record_id)
    // 把编辑后的 SI 和出货时间合入数据
    const data = { ...merged.value, si_deadline: editSiDeadline.value, ship_date: editShipDate.value }
    await createShipmentFromEmail(emailIds, data)
    ElMessage.success('出货单创建成功')
    // TJX多柜：移除已创建的分组，保留其他分组
    if (containerGroups.value.length > 1) {
      const groups = containerGroups.value
      groups.splice(selectedGroupIdx.value, 1)
      selectedGroupIdx.value = 0
      if (groups.length) {
        onGroupChange(0)
        saveParsed()
      } else {
        clearParsed()
      }
      await loadRecords()
      return
    }
    clearParsed()
    router.push('/shipments')
  } catch (e) {
    ElMessage.error('创建出货单失败：' + (e.response?.data?.error || e.message))
  } finally {
    creating.value = false
  }
}
</script>
