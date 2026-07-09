<template>
  <div>
    <h4>出货明细</h4>
    <el-table :data="items" border stripe style="width: 100%" row-key="id"
              :span-method="spanMethod">
      <el-table-column prop="product_code" label="货号" min-width="100">
        <template #default="{ row }">
          <span v-if="!row._isSubRow">{{ row.product_code }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="contract_number" label="合同号" min-width="100">
        <template #default="{ row }">
          <span v-if="!row._isSubRow">{{ row.contract_number }}</span>
        </template>
      </el-table-column>
      <el-table-column label="产品名称" min-width="140">
        <template #default="{ row, $index }">
          <el-input v-if="editable && row._isSubRow" v-model="row.product_name" size="small"
                    @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.product_name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="数量" width="90">
        <template #default="{ row }">
          <el-input-number v-if="editable && row._isSubRow" v-model="row.quantity" size="small"
                           :min="0" controls-position="right"
                           @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.quantity }}</span>
        </template>
      </el-table-column>
      <el-table-column label="国家" min-width="80">
        <template #default="{ row }">
          <el-input v-if="editable && row._isSubRow" v-model="row.country" size="small"
                    @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.country }}</span>
        </template>
      </el-table-column>
      <el-table-column label="玩具类别" min-width="100">
        <template #default="{ row }">
          <el-input v-if="editable && row._isSubRow" v-model="row.toy_category" size="small"
                    @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.toy_category }}</span>
        </template>
      </el-table-column>
      <el-table-column label="件数" width="80">
        <template #default="{ row }">
          <el-input-number v-if="editable && row._isSubRow" v-model="row.pieces" size="small"
                           :min="0" controls-position="right"
                           @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.pieces }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="customer_po" label="客PO" min-width="100">
        <template #default="{ row }">
          <span v-if="!row._isSubRow">{{ row.customer_po }}</span>
        </template>
      </el-table-column>
      <el-table-column label="体积(CBM)" width="110">
        <template #default="{ row }">
          <el-input-number v-if="editable && row._isSubRow" v-model="row.volume" size="small"
                           :precision="4" :min="0" controls-position="right"
                           @change="emitSubItemUpdate(row)" />
          <span v-else>{{ row.volume }}</span>
        </template>
      </el-table-column>
      <el-table-column label="毛重/箱(kg)" width="120">
        <template #default="{ row, $index }">
          <template v-if="!row._isSubRow">
            <el-input-number
              v-if="editable"
              v-model="row.gross_weight_per_box"
              :precision="2"
              :step="0.1"
              :min="0"
              size="small"
              controls-position="right"
              @change="emitUpdate($index, 'gross_weight_per_box', $event)"
            />
            <span v-else>{{ row.gross_weight_per_box || '-' }}</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="净重/箱(kg)" width="120">
        <template #default="{ row, $index }">
          <template v-if="!row._isSubRow">
            <el-input-number
              v-if="editable"
              v-model="row.net_weight_per_box"
              :precision="2"
              :step="0.1"
              :min="0"
              size="small"
              controls-position="right"
              @change="emitUpdate($index, 'net_weight_per_box', $event)"
            />
            <span v-else>{{ row.net_weight_per_box || '-' }}</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" v-if="editable">
        <template #default="{ row }">
          <template v-if="!row._isSubRow">
            <el-button size="small" type="primary" link @click="addSubItem(row)">
              +混装
            </el-button>
            <el-tag v-if="row.sub_items && row.sub_items.length" size="small" type="warning" style="margin-left:4px;">
              {{ row.sub_items.length }}个子行
            </el-tag>
          </template>
          <template v-else>
            <el-button size="small" type="danger" link @click="removeSubItem(row)">
              删除
            </el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <!-- 混合装子行展开区域 -->
    <el-dialog v-model="subItemDialogVisible" :title="'混合装子行 - ' + (currentParentItem?.product_code || '')"
               width="900px" destroy-on-close>
      <div v-if="currentParentItem">
        <p style="margin-bottom: 12px; color: #909399;">
          父行共用字段: 件数={{ currentParentItem.pieces }}, 客PO={{ currentParentItem.customer_po }}, 体积={{ currentParentItem.volume }}
        </p>
        <el-table :data="currentSubItems" border size="small">
          <el-table-column label="产品名称" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.product_name" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="数量" width="100">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" size="small" :min="0" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="国家" width="100">
            <template #default="{ row }">
              <el-input v-model="row.country" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="玩具类别" width="120">
            <template #default="{ row }">
              <el-input v-model="row.toy_category" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="件数" width="90">
            <template #default="{ row }">
              <el-input-number v-model="row.pieces" size="small" :min="0" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="体积(CBM)" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.volume" size="small" :precision="4" :min="0" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row, $index }">
              <el-button size="small" type="danger" link @click="deleteSubItemInDialog(row, $index)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button style="margin-top: 10px;" size="small" @click="addSubItemInDialog">
          + 添加子行
        </el-button>
      </div>
      <template #footer>
        <el-button @click="subItemDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="subItemSaving" @click="saveSubItems">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { createSubItem, updateSubItem, deleteSubItem as apiDeleteSubItem } from '../api/shipments'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  items: { type: Array, default: () => [] },
  editable: { type: Boolean, default: false },
})

const emit = defineEmits(['update-item', 'refresh'])

const subItemDialogVisible = ref(false)
const currentParentItem = ref(null)
const currentSubItems = ref([])
const subItemSaving = ref(false)

function emitUpdate(index, field, value) {
  emit('update-item', { index, field, value })
}

function emitSubItemUpdate(row) {
  // 子行更新通过对话框或直接 API 保存
}

function addSubItem(parentItem) {
  currentParentItem.value = parentItem
  // 复制已有子行数据
  currentSubItems.value = (parentItem.sub_items || []).map(s => ({ ...s }))
  subItemDialogVisible.value = true
}

function addSubItemInDialog() {
  currentSubItems.value.push({
    id: null,
    product_name: '',
    quantity: 0,
    spec: '',
    toy_category: '',
    country: currentParentItem.value?.country || '',
    pieces: 0,
    volume: null,
    order_index: currentSubItems.value.length,
  })
}

async function deleteSubItemInDialog(row, index) {
  if (row.id) {
    try {
      await ElMessageBox.confirm('确认删除该子行？', '提示', { type: 'warning' })
      await apiDeleteSubItem(currentParentItem.value.id, row.id)
    } catch (e) {
      if (e !== 'cancel') ElMessage.error('删除失败')
      return
    }
  }
  currentSubItems.value.splice(index, 1)
}

async function removeSubItem(row) {
  if (!row._parentItemId || !row._subItemId) return
  try {
    await ElMessageBox.confirm('确认删除该混装子行？', '提示', { type: 'warning' })
    await apiDeleteSubItem(row._parentItemId, row._subItemId)
    ElMessage.success('已删除')
    emit('refresh')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

async function saveSubItems() {
  subItemSaving.value = true
  const parentId = currentParentItem.value.id
  try {
    for (const sub of currentSubItems.value) {
      const payload = {
        product_name: sub.product_name,
        quantity: sub.quantity,
        spec: sub.spec,
        toy_category: sub.toy_category,
        country: sub.country,
        pieces: sub.pieces,
        volume: sub.volume,
        order_index: sub.order_index,
      }
      if (sub.id) {
        await updateSubItem(parentId, sub.id, payload)
      } else {
        await createSubItem(parentId, payload)
      }
    }
    ElMessage.success('混合装子行保存成功')
    subItemDialogVisible.value = false
    emit('refresh')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.detail || e.message))
  } finally {
    subItemSaving.value = false
  }
}

// spanMethod 不再需要，因为子行通过对话框管理
function spanMethod() {
  return undefined
}
</script>
