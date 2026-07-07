<template>
  <div v-if="result" class="ai-review-panel">

    <!-- 错误提示 -->
    <el-alert v-if="result.ai_error" type="warning" :title="'AI解析失败：' + result.ai_error"
      description="以下字段需要全部手动填写" show-icon style="margin-bottom:16px;" />

    <!-- 头部字段 -->
    <el-card style="margin-bottom:16px;">
      <template #header><span style="font-weight:bold;">📋 头部信息</span></template>
      <el-row :gutter="16">
        <el-col :span="8" v-for="key in headerFields" :key="key">
          <div :class="['field-block', levelClass(result.fields[key])]">
            <div class="field-label">{{ fieldLabel(key) }}</div>
            <el-input
              v-model="editFields[key]"
              size="small"
              :placeholder="result.fields[key]?.confidence === 0 ? '未识别，请手动输入' : ''"
            />
            <div class="field-source" v-if="result.fields[key]?.evidence">
              <el-icon><Document /></el-icon>
              {{ result.fields[key].source_file }}
              <span v-if="result.fields[key].page"> 第{{ result.fields[key].page }}页</span>
              <span v-if="result.fields[key].row"> 第{{ result.fields[key].row }}行</span>
              <el-tooltip :content="result.fields[key].evidence" placement="top">
                <span class="evidence-tag">原文</span>
              </el-tooltip>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 未知目的港弹窗 -->
    <el-dialog v-model="showPortDialog" title="未知目的港，请填写国家" width="400px">
      <p>目的港：<b>{{ unknownPort }}</b></p>
      <el-input v-model="newCountry" placeholder="请输入中文国家名，如：美国" />
      <template #footer>
        <el-button @click="showPortDialog=false">取消</el-button>
        <el-button type="primary" @click="confirmPort">确认并保存</el-button>
      </template>
    </el-dialog>

    <!-- 明细数据 -->
    <el-card style="margin-bottom:16px;">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:bold;">📦 出货明细（{{ result.items?.length || 0 }} 条）</span>
          <el-tag v-if="result.zuogui_factory !== '兴信'" type="warning">
            外厂做柜：已过滤非兴信货
          </el-tag>
        </div>
      </template>
      <el-table :data="result.items" border size="small" max-height="300">
        <el-table-column prop="product_code" label="货号" width="120" />
        <el-table-column prop="contract_number" label="合同号" width="120" />
        <el-table-column prop="pieces" label="件数" width="80" />
        <el-table-column prop="quantity" label="数量" width="80" />
        <el-table-column prop="cbm" label="CBM" width="80" />
        <el-table-column prop="customer_po" label="客人PO" width="120" />
        <el-table-column prop="factory_short" label="工厂" width="100" />
        <el-table-column label="置信度" width="80">
          <template #default="{ row }">
            <el-tag :type="row.confidence_level === 'green' ? 'success' : row.confidence_level === 'yellow' ? 'warning' : 'danger'" size="small">
              {{ Math.round(row.confidence * 100) }}%
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.source_file }} 第{{ row.row }}行</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 确认按钮 -->
    <div style="text-align:right;">
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="confirming" @click="handleConfirm">
        确认并创建出货单
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import { aiParseConfirm, saveDestinationPort } from '../api/aiParser'

const props = defineProps({ result: Object })
const emit = defineEmits(['confirmed', 'cancel'])

const confirming = ref(false)
const showPortDialog = ref(false)
const unknownPort = ref('')
const newCountry = ref('')

const headerFields = ['so_number', 'container_type', 'si_deadline', 'cutoff_date',
  'ship_date', 'port', 'country', 'customs_broker', 'zuogui_factory', 'special_requirements']

const FIELD_LABELS = {
  so_number: 'SO号', container_type: '柜型', si_deadline: 'SI截止',
  cutoff_date: '截数期', ship_date: '出货时间', port: '港口',
  country: '国家', customs_broker: '报关行',
  zuogui_factory: '做柜工厂', special_requirements: '特殊要求',
}

const editFields = reactive({})

// 初始化编辑值
watch(() => props.result, (r) => {
  if (!r?.fields) return
  headerFields.forEach(k => {
    editFields[k] = r.fields[k]?.value || ''
  })
  // 检查未知目的港
  if (r.fields.country?.confidence === 0 && r.fields.country?.value) {
    unknownPort.value = r.fields.country.value
    showPortDialog.value = true
  }
}, { immediate: true })

function fieldLabel(key) { return FIELD_LABELS[key] || key }

function levelClass(field) {
  if (!field) return 'level-red'
  const level = field.confidence_level
  return level === 'green' ? 'level-green' : level === 'yellow' ? 'level-yellow' : 'level-red'
}

async function confirmPort() {
  if (!newCountry.value.trim()) { ElMessage.warning('请输入国家名'); return }
  await saveDestinationPort(unknownPort.value, newCountry.value.trim())
  editFields['country'] = newCountry.value.trim()
  showPortDialog.value = false
  ElMessage.success('目的港映射已保存')
}

async function handleConfirm() {
  confirming.value = true
  try {
    // 将编辑后的值回写到 fields
    const fields = {}
    headerFields.forEach(k => {
      fields[k] = { ...(props.result.fields[k] || {}), value: editFields[k] }
    })
    const payload = {
      shipment_type: props.result.shipment_type,
      zuogui_factory: props.result.zuogui_factory,
      fields,
      items: props.result.items,
    }
    const res = await aiParseConfirm(payload)
    ElMessage.success('出货单已创建')
    emit('confirmed', res.shipment_id)
  } catch (e) {
    ElMessage.error('创建失败：' + (e.response?.data?.error || e.message))
  } finally {
    confirming.value = false
  }
}
</script>

<style scoped>
.field-block { padding: 8px; border-radius: 6px; margin-bottom: 8px; }
.level-green { background: #f0f9eb; border: 1px solid #b3e19d; }
.level-yellow { background: #fdf6ec; border: 1px solid #f5dab1; }
.level-red { background: #fef0f0; border: 1px solid #fbc4c4; }
.field-label { font-size: 12px; color: #606266; margin-bottom: 4px; }
.field-source { font-size: 11px; color: #909399; margin-top: 4px; display: flex; align-items: center; gap: 4px; }
.evidence-tag { background: #e4e7ed; border-radius: 3px; padding: 1px 4px; cursor: pointer; }
</style>
