// pb_hooks/score_calc.pb.js
// 服务端权威算分：total_score = sum(score_items[].score)，并据评级线写 grade。
// 防止前端篡改总分；与前端 utils/grading.ts 规则保持一致。
//
// 注意（PB 0.23 JSVM 两个坑）：
// 1) 钩子主体内不要调用自定义命名函数（即使只传纯数据也会让钩子崩溃返回400），逻辑必须完全内联。
// 2) JSON 字段 e.record.get('score_items') 返回 JSONRaw 的「字节数组」，
//    需把字节解码回字符串再 JSON.parse。本钩子只回写 total_score/grade，不动 score_items。
onRecordCreateRequest((e) => {
  const raw = e.record.get('score_items')
  let str = ''
  if (typeof raw === 'string') str = raw
  else if (raw && raw.length) { for (let i = 0; i < raw.length; i++) str += String.fromCharCode(raw[i]) }
  let items = []
  try { items = str ? JSON.parse(str) : [] } catch (_) { items = [] }
  let total = 0
  for (const it of items) total += Number(it.score) || 0
  let grade = 'D'
  if (total >= 90) grade = 'A'
  else if (total >= 80) grade = 'B'
  else if (total >= 70) grade = 'C'
  e.record.set('total_score', total)
  e.record.set('grade', grade)
  return e.next()
}, 'monthly_scores')

onRecordUpdateRequest((e) => {
  const raw = e.record.get('score_items')
  let str = ''
  if (typeof raw === 'string') str = raw
  else if (raw && raw.length) { for (let i = 0; i < raw.length; i++) str += String.fromCharCode(raw[i]) }
  let items = []
  try { items = str ? JSON.parse(str) : [] } catch (_) { items = [] }
  let total = 0
  for (const it of items) total += Number(it.score) || 0
  let grade = 'D'
  if (total >= 90) grade = 'A'
  else if (total >= 80) grade = 'B'
  else if (total >= 70) grade = 'C'
  e.record.set('total_score', total)
  e.record.set('grade', grade)
  return e.next()
}, 'monthly_scores')
