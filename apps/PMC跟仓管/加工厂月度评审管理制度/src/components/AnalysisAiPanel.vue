<script setup lang="ts">
import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { pb } from '../pb'
import { chinaToday } from '../utils/dynamicAnalysis'
import { useAuthStore } from '../stores/auth'
import type { Factory } from '../types/factory'
const props=defineProps<{ factories: Factory[]; factoryId?:string }>()
const auth=useAuthStore()
const config=ref<{enabled:boolean;model:string;reason:string;dailyLimit:number}|null>(null)
const error=ref(''), busy=ref(false), factory=ref(props.factoryId||'')
const end=ref(chinaToday()), start=ref(chinaToday(new Date(Date.now()-29*86400000)))
const question=ref('哪些工厂需要优先跟进？请结合巡查、品质、交期、评分和产值说明依据、数据不足及建议。')
interface Evidence {id:string;factoryCode:string;factoryId:string;factoryName:string;source:string;recordId:string;date:string;craft:string;region:string}
interface Report { report:{summary:string;limitations:string[];findings:{title:string;risk:string;analysis:string;actions:string[];evidence_ids:string[]}[]}; evidence:Evidence[]; coverage:{source:string;status:string;count:number}[]; model:string; generatedAt:string; start:string; end:string }
const result=ref<Report|null>(null)
let generation=0,configGeneration=0,disposed=false,controller:AbortController|null=null
function clear(){generation++;controller?.abort();controller=null;result.value=null;busy.value=false;error.value=''}
async function loadConfig(){const current=++configGeneration;try{const c=await pb.send('/api/factory-review/analysis-ai/config',{method:'GET'});if(!disposed&&current===configGeneration)config.value=c}catch{if(!disposed&&current===configGeneration){config.value=null;error.value='AI配置状态读取失败，请重试'}}}
async function generate(){
  if(!config.value?.enabled||busy.value)return
  clear();const current=generation;busy.value=true;controller=new AbortController()
  try{const report=await pb.send<Report>('/api/factory-review/analysis-ai',{method:'POST',body:{start:start.value,end:end.value,factory:factory.value,question:question.value},signal:controller.signal});if(current===generation)result.value=report}
  catch(e:any){if(current===generation)error.value=e?.response?.message||'AI分析失败，请稍后重试'}
  finally{if(current===generation){busy.value=false;controller=null}}
}
watch([start,end,factory,question],()=>clear())
watch(()=>props.factoryId,id=>{factory.value=id||'';clear()})
const stop=pb.authStore.onChange(()=>{clear();configGeneration++;config.value=null;if(pb.authStore.record)void loadConfig()})
onMounted(loadConfig);onScopeDispose(()=>{disposed=true;configGeneration++;clear();stop()})
function target(e:Evidence){
  if(e.source==='quality_patrols')return {path:'/quality-patrol',query:{region:e.region,factory:e.factoryId,date:e.date}}
  if(e.source==='orders')return `/orders/dept/${e.craft}/${e.recordId}`
  if(e.source==='quality_inspections')return {path:'/quality-inspection',query:{region:e.region}}
  if(e.source==='monthly_scores')return `/factories/${e.factoryId}/score/${e.date}`
  return '/monthly-output'
}
</script>
<template>
  <section class="ai-panel">
    <header><h2>AI综合分析</h2><span>{{config?.enabled?'服务已配置':'待配置服务'}}</span></header>
    <p>选择范围并提问后生成一次分析。发送所选范围内的授权业务明细及问题；工厂以代号传给模型，不读取联系人字段、照片和订单价格。AI建议需人工核实，不会修改业务记录。</p>
    <p v-if="config && !config.enabled" class="notice">{{config.reason}}。当前规则预警仍正常使用。</p>
    <details v-if="auth.role==='admin'"><summary>AI服务配置入口（管理员）</summary>
      <p>当前支持OpenAI Responses API。请运维在服务器环境中填写以下配置并重新创建加工厂服务；这里不接收、不显示密钥。测试版使用独立的 TEST 配置，不共用正式密钥。</p>
      <ul><li>FACTORY_REVIEW_AI_ENABLED=true：开通后启用</li><li>FACTORY_REVIEW_AI_API_KEY：专用API密钥</li><li>FACTORY_REVIEW_AI_MODEL：该账号可用、支持结构化输出的模型ID</li><li>FACTORY_REVIEW_AI_BASE_URL：默认 https://api.openai.com/v1</li></ul>
      <p>完成后刷新配置状态，先用测试数据验证。每个账号每分钟最多1次、每天最多20次；仅在主动点击时调用，失败请求也占用调用额度。测试配置前缀为 FACTORY_REVIEW_TEST_AI_。</p>
      <button :disabled="busy" @click="loadConfig">刷新配置状态</button>
    </details>
    <div class="controls"><label>开始日期<input type="date" v-model="start" :max="end" :disabled="busy" /></label><label>结束日期<input type="date" v-model="end" :min="start" :max="chinaToday()" :disabled="busy" /></label><label v-if="!factoryId">分析工厂<select v-model="factory" :disabled="busy"><option value="">全部授权工厂</option><option v-for="f in factories" :key="f.id" :value="f.id">{{f.name}}</option></select></label></div>
    <label class="question">希望分析的问题<textarea v-model="question" maxlength="600" rows="3" :disabled="busy" /></label>
    <p class="muted">订单按约定交期、巡查按检查日期、检验按送货日期筛选；评分和产值按涉及的整月分析，不含无日期及范围外记录。最多180天、500条明细，过多时请缩小范围。</p>
    <button class="primary" :disabled="!config?.enabled||busy||!start||!end||question.trim().length<2" @click="generate">{{busy?'AI正在分析…':'生成综合分析'}}</button>
    <p v-if="error" role="alert" class="error">{{error}} <button v-if="!config" @click="loadConfig">重试</button></p>
    <div v-if="result" class="result">
      <p class="muted">{{result.start}} 至 {{result.end}} · {{result.model}} · {{new Date(result.generatedAt).toLocaleString('zh-CN')}}生成的快照，数据更新后需重新分析</p>
      <p>{{result.report.summary}}</p><p class="muted">工厂代号：{{ [...new Map(result.evidence.map(e => [e.factoryCode, e.factoryName])).entries()].map(([code,name]) => `${code}＝${name}`).join('；') }}</p>
      <div class="coverage"><span v-for="c in result.coverage" :key="c.source">{{c.source}}：{{c.status}}（{{c.count}}条）</span></div>
      <article v-for="(f,i) in result.report.findings" :key="i"><h3>{{f.title}} · {{({high:'重点关注',medium:'关注',low:'一般'} as Record<string,string>)[f.risk]}}</h3><p>{{f.analysis}}</p><ul><li v-for="a in f.actions" :key="a">{{a}}</li></ul>
        <p>依据：</p><ul><li v-for="e in result.evidence.filter(e=>f.evidence_ids.includes(e.id))" :key="e.id"><RouterLink :to="target(e)">{{e.factoryName}} · {{e.date}} · {{({quality_patrols:'巡查',orders:'订单',quality_inspections:'品质检验',monthly_scores:'月度评分',monthly_output:'产值'} as Record<string,string>)[e.source]}}</RouterLink> <small>记录 {{e.recordId}}</small></li></ul>
      </article>
      <h3>分析限制</h3><ul><li v-for="l in result.report.limitations" :key="l">{{l}}</li><li>结论基于本次数据快照，不代表未录入或范围外的实际情况。</li></ul>
    </div>
  </section>
</template>
<style scoped>
.ai-panel {border:1px solid #dce0ef;border-radius:12px;padding:22px;margin-bottom:24px;background:#fff} header,.controls,.coverage {display:flex;flex-wrap:wrap;align-items:center;gap:16px} header{justify-content:space-between} h2,h3{margin:0} p,li{line-height:1.7} .controls{margin:18px 0} label{display:flex;flex-wrap:wrap;gap:8px;align-items:center} .question{display:block} textarea{display:block;width:100%;margin:8px 0} input,select,textarea,button{font:inherit;color:#202635;background:white;border:1px solid #bec5d5;border-radius:6px;padding:8px 12px;max-width:100%} button.primary{background:#5146e5;color:white} button:disabled{opacity:.5;cursor:not-allowed}.error{color:#b42318}.muted{color:#687386;font-size:.9rem} .notice,details,.coverage{background:#f5f5ff;padding:12px;border-radius:8px} summary{cursor:pointer} article{border-top:1px solid #ddd;padding:18px 0}.result{margin-top:22px} small{color:#687386} @media(max-width:600px){.ai-panel{padding:14px}}
</style>
