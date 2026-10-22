import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
const m=vi.hoisted(()=>({create:vi.fn(async(body:any)=>({id:body.issue_key,...body})),update:vi.fn(),list:vi.fn(async()=>[{id:'saved',issue_key:'already',status:'resolved'}])}))
vi.mock('../src/pb',()=>({pb:{collection:()=>({getFullList:m.list,create:m.create,update:m.update}),authStore:{record:{id:'owner'},onChange:()=>()=>{}}}}))
vi.mock('../src/composables/useDynamicAnalysis',async()=>{const {ref}=await import('vue');return {useDynamicAnalysis:()=>({factories:ref([]),loading:ref(false),errors:ref([]),readFailed:ref(false),updated:ref(''),refresh:vi.fn(),result:ref({issues:[['old','2026-09-01','delivery'],['boundary','2026-09-02','delivery'],['already','2026-08-01','delivery'],['grade','2026-08-01','grade']].map(([key,date,kind])=>({key,date,kind,factory:'f',level:'high'}))})})}})
import Panel from '../src/components/DynamicAnalysisPanel.vue'
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks()})
it('confirms exact eligible count and writes only owner followups, skipping resolved and boundary rows',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T00:00:00Z'))
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
 const w=mount(Panel,{global:{stubs:{AnalysisAiPanel:true,RouterLink:true}}});await flushPromises()
 await w.find('.bulk-actions button').trigger('click');await flushPromises()
 expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 项风险'))
 expect(m.create).toHaveBeenCalledExactlyOnceWith({owner:'owner',issue_key:'old',status:'resolved'})
 expect(m.update).not.toHaveBeenCalled();expect(w.text()).toContain('已成功标记 1 项')
 w.unmount()
})
it('does not write when confirmation is cancelled',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));vi.spyOn(window,'confirm').mockReturnValue(false)
 const w=mount(Panel,{global:{stubs:{AnalysisAiPanel:true,RouterLink:true}}});await flushPromises()
 await w.find('.bulk-actions button').trigger('click');expect(m.create).not.toHaveBeenCalled();w.unmount()
})
