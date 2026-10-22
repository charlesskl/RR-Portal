import { expect, it, vi } from 'vitest'
import { overdueMoreThan50, resolveRiskBatch } from '../src/utils/analysisBulkResolve'
import type { AnalysisIssue } from '../src/utils/dynamicAnalysis'
const issue = (date: string, kind = 'delivery') => ({ date, kind } as AnalysisIssue)
it('uses strict 50-day cutoff, includes correction and excludes rating changes and invalid dates', () => {
 expect(overdueMoreThan50(issue('2026-09-02'), '2026-10-22')).toBe(false)
 expect(overdueMoreThan50(issue('2026-09-01'), '2026-10-22')).toBe(true)
 expect(overdueMoreThan50(issue('2026-09-01','correction'), '2026-10-22')).toBe(true)
 expect(overdueMoreThan50(issue('2026-09-01','grade'), '2026-10-22')).toBe(false)
 expect(overdueMoreThan50(issue('2026-02-30'), '2026-10-22')).toBe(false)
})
it('writes every item once with bounded concurrency', async () => {
 let running=0, max=0
 const write=vi.fn(async()=>{running++;max=Math.max(max,running);await Promise.resolve();running--})
 const result=await resolveRiskBatch([1,2,3,4,5,6,7,8,9],()=>true,write,()=>{})
 expect(result.done).toBe(9);expect(write).toHaveBeenCalledTimes(9);expect(max).toBeLessThanOrEqual(4)
})
it('stops after failed batch and reports successful writes',async()=>{
 const write=vi.fn(async(n:number)=>{if(n===2)throw Error('offline')})
 expect(await resolveRiskBatch([1,2,3,4,5],()=>true,write,()=>{})).toEqual({done:3,failed:true,stopped:false})
 expect(write).toHaveBeenCalledTimes(4)
})
it('does not continue after account change or unmount',async()=>{
 let active=true
 const write=vi.fn(async()=>{active=false})
 const result=await resolveRiskBatch([1,2,3,4,5],()=>active,write,()=>{})
 expect(result.stopped).toBe(true);expect(write).toHaveBeenCalledTimes(1)
})
