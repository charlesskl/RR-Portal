<script setup lang="ts">
import { reactive, computed, ref } from 'vue'
import type { Factory } from '../types/factory'
import { useAuthStore } from '../stores/auth'
import { pb } from '../pb'

const props = defineProps<{ modelValue: Partial<Factory>; readonly?: boolean }>()
const emit = defineEmits<{ (e: 'save', v: FormData): void }>()
const auth = useAuthStore()

const form = reactive<Partial<Factory>>({ status: 'active', region: 'dongguan', ...props.modelValue })
const photoInput = ref<HTMLInputElement | null>(null)

// 设备清单：一行一种设备（类型 + 数量），可加可删
type EquipItem = { type: string; qty: number | null }
const equipList = ref<EquipItem[]>(
  Array.isArray(props.modelValue.equipment_list) && props.modelValue.equipment_list.length
    ? props.modelValue.equipment_list.map((e) => ({ type: e.type ?? '', qty: e.qty ?? null }))
    // 兼容旧数据：把逗号分隔的 equipment_type 拆成无数量的行
    : (props.modelValue.equipment_type ?? '').split(/[，,]/).map((s) => s.trim()).filter(Boolean).map((t) => ({ type: t, qty: null })),
)
function addEquipRow() { equipList.value.push({ type: '', qty: null }) }
function removeEquipRow(i: number) { equipList.value.splice(i, 1) }
// 资质有效期/资质文件：仅 admin、供应链经理可改
const canEditQual = computed(() => auth.role === 'admin' || auth.role === 'sc_manager')

// 部门（底层值仍是 craft，保持权限/统计逻辑兼容）
const DEPTS = [
  { value: 'injection', label: '注塑部' },
  { value: 'painting', label: '喷油部' },
  { value: 'assembly', label: '装配部' },
  { value: 'sewing', label: '车缝部' },
]
const REGIONS = [
  { value: 'dongguan', label: '东莞' },
  { value: 'hunan', label: '湖南' },
  { value: 'heyuan', label: '河源' },
]

// 已有厂房图片（编辑态展示）
const existingPhotos = computed(() => {
  const id = props.modelValue.id
  const photos = props.modelValue.workshop_photos
  if (!id || !photos?.length) return []
  return photos.map((p) => pb.files.getURL(props.modelValue as any, p, { thumb: '100x100' }))
})

function onSubmit() {
  const fd = new FormData()
  fd.append('name', form.name ?? '')
  fd.append('craft', form.craft ?? '')
  fd.append('region', form.region ?? 'dongguan')
  fd.append('contact_person', form.contact_person ?? '')
  fd.append('contact_phone', form.contact_phone ?? '')
  fd.append('address', form.address ?? '')
  if (form.workshop_area != null && form.workshop_area !== ('' as any)) {
    fd.append('workshop_area', String(form.workshop_area))
  }
  // 厂房基本信息；设备清单（类型+数量）
  const cleanEquip = equipList.value.filter((e) => e.type.trim())
  fd.append('equipment_list', JSON.stringify(cleanEquip))
  // 兼容：类型拼接 + 数量合计，供 Excel/旧字段使用
  fd.append('equipment_type', cleanEquip.map((e) => e.type).join(','))
  // 设备台数/生产拉线 总数量：优先用手动填写值，留空则按设备明细自动合计
  const sumQty = cleanEquip.reduce((s, e) => s + (Number(e.qty) || 0), 0)
  const totalQty = (form.equipment_qty != null && form.equipment_qty !== ('' as any)) ? Number(form.equipment_qty) : sumQty
  if (totalQty) fd.append('equipment_qty', String(totalQty))
  fd.append('processable_types', form.processable_types ?? '')
  fd.append('production_lines', form.production_lines ?? '')
  fd.append('cooperative_workshops', form.cooperative_workshops ?? '')
  fd.append('ip_control', form.ip_control ?? '')
  fd.append('cooperation_period', form.cooperation_period ?? '')
  for (const k of ['staff_count', 'annual_revenue', 'monthly_capacity'] as const) {
    const v = form[k]
    if (v != null && v !== ('' as any)) fd.append(k, String(v))
  }
  if (canEditQual.value) {
    fd.append('cert_status', form.cert_status ?? '')
  }
  const files = photoInput.value?.files
  if (files) for (const f of Array.from(files)) fd.append('workshop_photos', f)
  emit('save', fd)
}
</script>
<template>
  <form class="factory-form" @submit.prevent="onSubmit">
    <fieldset class="fs" :disabled="props.readonly">
    <label>名称 <input v-model="form.name" required /></label>
    <label>厂区
      <select v-model="form.region" required>
        <option v-for="r in REGIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
      </select>
    </label>
    <label>部门
      <select v-model="form.craft" required>
        <option v-for="d in DEPTS" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>
    </label>
    <label>联系人 <input v-model="form.contact_person" /></label>
    <label>电话 <input v-model="form.contact_phone" /></label>
    <label>地址 <input v-model="form.address" /></label>
    <label>同我们工厂合作年限 <input v-model="form.cooperation_period" placeholder="如：4年 / 3个月 / 0.5年" /></label>
    <div class="equip-block">
      <span class="equip-title">设备台数/生产拉线（类型 + 数量，可添加多种）</span>
      <label class="equip-total">总数量 <input v-model.number="form.equipment_qty" type="number" min="0" placeholder="设备台数/生产拉线 总数（可直接填写，留空则按下方明细自动合计）" /></label>
      <div v-if="equipList.length" class="equip-head"><span>设备类型</span><span>数量</span><span></span></div>
      <div v-for="(e, i) in equipList" :key="i" class="equip-row">
        <input v-model="e.type" placeholder="如注塑机" />
        <input v-model.number="e.qty" type="number" min="0" placeholder="台数" />
        <button v-if="!props.readonly" type="button" class="ghost mini" @click="removeEquipRow(i)">删除</button>
      </div>
      <button v-if="!props.readonly" type="button" class="ghost mini add" @click="addEquipRow">+ 添加设备</button>
    </div>
    <label>帮我们生产的几台/生产线 <input v-model="form.production_lines" placeholder="如：2 条移印线、1 条喷涂线专供我司" /></label>
    <label>员工人数 <input v-model.number="form.staff_count" type="number" min="0" /></label>
    <label>月产能 <input v-model.number="form.monthly_capacity" type="number" min="0" /></label>
    <label>加工类型 <input v-model="form.processable_types" placeholder="如 ABS/PC 注塑、金属喷涂" /></label>
    <label>厂房面积(㎡) <input v-model.number="form.workshop_area" type="number" /></label>
    <label v-if="!props.readonly">厂房图片/证书
      <input ref="photoInput" type="file" multiple accept="image/*,.pdf" />
      <span class="hint" v-if="modelValue.id">重新上传将替换原有文件</span>
    </label>
    <div v-if="existingPhotos.length" class="thumbs">
      <img v-for="(u, i) in existingPhotos" :key="i" :src="u" alt="厂房图片" />
    </div>
    <label>环评 / 消防 / 安监资质
      <input v-model="form.cert_status" :disabled="!canEditQual" placeholder="如：有效期内、有效期至2026-12" />
    </label>
    <p v-if="!canEditQual" class="hint">资质信息仅供应链经理/管理员可修改</p>
    <label>合作车间 <input v-model="form.cooperative_workshops" placeholder="如：移印车间、丝印车间外协" /></label>
    <label>IP管控 <input v-model="form.ip_control" placeholder="如：已授权 / 无 IP 风险 / 待确认" /></label>
    </fieldset>
    <button v-if="!props.readonly" type="submit">保存</button>
  </form>
</template>
<style scoped>
.factory-form { display: flex; flex-direction: column; gap: 0.7rem; max-width: 460px; }
.fs { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.fs:disabled, .fs[disabled] { opacity: 1; }
.factory-form label { display: flex; flex-direction: column; gap: 0.25rem; }
.factory-form textarea { width: 100%; }
.ws-info { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .75rem 1rem; display: flex; flex-direction: column; gap: .6rem; }
.ws-info legend { font-size: .85rem; color: var(--text-soft); padding: 0 .4rem; }
.ws-info label { display: flex; flex-direction: column; gap: .2rem; }
.equip-block { display: flex; flex-direction: column; gap: .4rem; }
.equip-title { font-size: .85rem; color: var(--text); }
.equip-head { display: grid; grid-template-columns: 1fr 100px 56px; gap: .5rem; font-size: .78rem; color: var(--text-soft); }
.equip-row { display: grid; grid-template-columns: 1fr 100px 56px; gap: .5rem; align-items: center; }
.mini { padding: .3rem .6rem; font-size: .82rem; }
.add { align-self: flex-start; }
.thumbs { display: flex; gap: .5rem; flex-wrap: wrap; }
.thumbs img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
</style>
