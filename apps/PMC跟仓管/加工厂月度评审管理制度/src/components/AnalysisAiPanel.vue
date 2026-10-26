<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { pb } from '../pb'
import { configErrorMessage, isAnalysisConfig, type AnalysisConfig } from '../utils/analysisConfig'
import { chinaToday } from '../utils/dynamicAnalysis'
import { useAuthStore } from '../stores/auth'
import { allowedRegions } from '../utils/permissions'
import { REGION_LABELS, CRAFT_LABELS, regionOf, type Region, type Craft } from '../constants/roles'
import type { Factory } from '../types/factory'
const props=defineProps<{ factories: Factory[]; factoryId?:string }>()
const auth=useAuthStore()
const config=ref<AnalysisConfig|null>(null)
const configLoading=ref(false), configError=ref(''), configNeedsLogin=ref(false)
let configController:AbortController|null=null
const orderDateBasis=ref('order_date')
const statistics=ref<{coverage:{source:string;status:string;count:number}[];total:number;limit:number}|null>(null)
const error=ref(''), busy=ref(false), factory=ref(props.factoryId||'')
const region=ref<Region|''>(''),craft=ref<Craft|''>('')
const regionOptions=computed(()=>[...new Set(props.factories.map(f=>regionOf(f)).filter(r=>auth.role&&allowedRegions(auth.role).includes(r)))])
const regionFactories=computed(()=>props.factories.filter(f=>!region.value||regionOf(f)===region.value))
const craftOptions=computed(()=>[...new Set(regionFactories.value.map(f=>f.craft))])
const scopeFactories=computed(()=>regionFactories.value.filter(f=>!craft.value||f.craft===craft.value))
watch(region,()=>{craft.value='';if(!props.factoryId)factory.value='';clear()})
watch(craft,()=>{if(!props.factoryId)factory.value='';clear()})
watch([regionOptions,craftOptions,scopeFactories],()=>{
  if(props.factoryId)return
  if(region.value&&!regionOptions.value.includes(region.value)){resetScope();return}
  if(craft.value&&!craftOptions.value.includes(craft.value)){craft.value='';factory.value='';clear();return}
  if(factory.value&&!scopeFactories.value.some(f=>f.id===factory.value)){factory.value='';clear()}
})
const end=ref(chinaToday()), start=ref(chinaToday(new Date(Date.now()-29*86400000)))
const question=ref('哪些工厂需要优先跟进？请结合巡查、品质、交期、评分和产值说明依据、数据不足及建议。')
interface Evidence {id:string;factoryCode:string;factoryId:string;factoryName:string;source:string;recordId:string;date:string;craft:string;region:string}
interface Report { report:{summary:string;limitations:string[];findings:{title:string;risk:string;analysis:string;actions:string[];evidence_ids:string[]}[]}; evidence:Evidence[]; coverage:{source:string;status:string;count:number}[]; model:string; generatedAt:string; start:string; end:string }
const result=ref<Report|null>(null)
let generation=0,configGeneration=0,disposed=false,controller:AbortController|null=null
function clear(){generation++;controller?.abort();controller=null;result.value=null;statistics.value=null;busy.value=false;error.value=''}
function resetScope(){region.value='';craft.value='';factory.value=props.factoryId||'';clear()}
async function loadConfig(){
  const current=++configGeneration
  configController?.abort()
  const request=new AbortController();configController=request
  configLoading.value=true;configError.value='';configNeedsLogin.value=false;config.value=null
  try {
    // Retry only this free, read-only request once on transient failures.
    for(let attempt=0;attempt<2;attempt++){
      const timeout=setTimeout(()=>request.abort(),10000)
      try {
        const c=await pb.send('/api/factory-review/analysis-ai/config',{method:'GET',signal:request.signal,requestKey:null})
        if(disposed||current!==configGeneration)return
        if(!isAnalysisConfig(c)){configError.value='AI配置接口返回格式异常，请管理员检查后端版本和代理地址。';return}
        config.value=c;return
      } catch(e:any) {
        if(disposed||current!==configGeneration)return
        const status=Number(e?.status||e?.response?.status||0)
        if(attempt===0&&!request.signal.aborted&&(status===0||status>=500))continue
        configNeedsLogin.value=status===401
        configError.value=configErrorMessage(e)
        return
      } finally {clearTimeout(timeout)}
    }
  } finally {if(current===configGeneration){configLoading.value=false;configController=null}}
}
async function generate(previewOnly=false){
  if(busy.value||(!previewOnly&&!config.value?.enabled))return
  clear();const current=generation;busy.value=true;controller=new AbortController()
  const body={start:start.value,end:end.value,factory:factory.value,region:region.value,craft:craft.value,question:question.value,orderDateBasis:orderDateBasis.value}
  try{
    const counts=await pb.send('/api/factory-review/analysis-ai',{method:'POST',body:{...body,preview:true},signal:controller.signal,requestKey:null})
    if(current!==generation)return
    statistics.value=counts
    if(previewOnly)return
    if(counts.total>counts.limit){error.value=`分析总明细 ${counts.total} 条，超过 ${counts.limit} 条上限，请参考各类数量缩小范围；尚未调用AI。`;return}
    const report=await pb.send<Report>('/api/factory-review/analysis-ai',{method:'POST',body,signal:controller.signal,requestKey:null})
    if(current===generation)result.value=report
  }
  catch(e:any){if(current===generation)error.value=e?.response?.message && e.response.message !== 'Something went wrong while processing your request.' ? e.response.message : 'AI分析请求处理失败，请稍后重试；若仍失败，请联系管理员检查后端日志。'}
  finally{if(current===generation){busy.value=false;controller=null}}
}
watch([start,end,factory,question,orderDateBasis],()=>clear())
watch(()=>props.factoryId,()=>resetScope())
const stop=pb.authStore.onChange(()=>{resetScope();configGeneration++;config.value=null;configError.value='';configLoading.value=false;configController?.abort();if(pb.authStore.record)void loadConfig()})
onMounted(loadConfig);onScopeDispose(()=>{disposed=true;configGeneration++;configController?.abort();clear();stop()})
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
    <header><h2>AI综合分析</h2><span>{{configLoading?'正在读取配置…':configError?'配置状态未知':config?.enabled?'服务已配置':config?'待配置服务':'配置尚未读取'}}</span></header>
    <p>选择范围并提问后生成一次分析。发送所选范围内的授权业务明细及问题；工厂以代号传给模型，不读取联系人字段、照片和订单价格。AI建议需人工核实，不会修改业务记录。</p>
    <p v-if="config && !config.enabled" class="notice">{{config.reason}}。当前规则预警仍正常使用。</p>
    <details v-if="auth.role==='admin'"><summary>AI服务配置入口（管理员）</summary>
      <p>支持阿里云百炼千问和OpenAI。请运维在服务器环境中填写以下配置并重新创建加工厂服务；这里不接收、不显示密钥。测试版使用独立的 TEST 配置，不共用正式密钥。</p>
      <ul><li>FACTORY_REVIEW_AI_PROVIDER=qwen：阿里云百炼千问；openai：OpenAI</li><li>FACTORY_REVIEW_AI_ENABLED=true：开通后启用</li><li>FACTORY_REVIEW_AI_API_KEY：专用API密钥</li><li>FACTORY_REVIEW_AI_MODEL：百炼控制台可用的模型ID（如 qwen3-max）</li><li>FACTORY_REVIEW_AI_BASE_URL：千问默认北京地域 https://dashscope.aliyuncs.com/compatible-mode/v1；可填写控制台同地域的业务空间专属地址。OpenAI默认 https://api.openai.com/v1</li></ul>
      <p>完成后刷新配置状态，先用测试数据验证。每个账号每分钟最多1次、每天最多20次；仅在主动点击时调用，失败请求也占用调用额度。测试配置前缀为 FACTORY_REVIEW_TEST_AI_。</p>
      <button :disabled="busy||configLoading" @click="loadConfig">刷新配置状态</button>
    </details>
    <div class="controls"><label>开始日期<input type="date" v-model="start" :max="end" :disabled="busy" /></label><label>结束日期<input type="date" v-model="end" :min="start" :max="chinaToday()" :disabled="busy" /></label><label v-if="!factoryId">厂区<select v-model="region" :disabled="busy" aria-label="分析厂区"><option value="">全部厂区</option><option v-for="r in regionOptions" :key="r" :value="r">{{REGION_LABELS[r]}}</option></select></label><label v-if="!factoryId">部门<select v-model="craft" :disabled="busy" aria-label="分析部门"><option value="">全部部门</option><option v-for="c in craftOptions" :key="c" :value="c">{{CRAFT_LABELS[c]}}</option></select></label><label v-if="!factoryId">分析工厂<select v-model="factory" :disabled="busy" aria-label="分析工厂"><option value="">所选范围全部工厂</option><option v-for="f in scopeFactories" :key="f.id" :value="f.id">{{f.name}}</option></select></label></div>
    <label>订单日期口径<select v-model="orderDateBasis" :disabled="busy" aria-label="订单日期口径"><option value="order_date">按下单时间（与货期管理一致）</option><option value="delivery_date">按约定交货时间</option></select></label>
    <label class="question">希望分析的问题<textarea v-model="question" maxlength="600" rows="3" :disabled="busy" /></label>
    <p class="muted">订单按所选日期口径、巡查按检查日期、检验按送货日期筛选；评分和产值按涉及的整月分析，不含无日期及范围外记录。最多180天；500条上限为订单、巡查、品质检验、评分和产值的合计，并非仅订单数量。</p>
    <button :disabled="busy||!start||!end" @click="generate(true)">统计分析范围（不调用AI）</button>
    <div v-if="statistics" class="coverage" role="status"><strong>合计 {{statistics.total}} 条 / 上限 {{statistics.limit}} 条</strong><span v-for="c in statistics.coverage" :key="c.source">{{c.source}}：{{c.count}}条（{{c.status}}）</span></div>
    <button class="primary" :disabled="!config?.enabled||busy||!start||!end||question.trim().length<2" @click="generate(false)">{{busy?'AI正在分析…':'生成综合分析'}}</button>
    <p v-if="configError" role="alert" class="error">{{configError}} <RouterLink v-if="configNeedsLogin" to="/login">重新登录</RouterLink><button v-else :disabled="configLoading" @click="loadConfig">重试配置</button></p>
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
