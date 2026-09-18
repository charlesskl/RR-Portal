import { useRef, useState } from 'react';
export default function ProductionDays({ today, disabled }: { today: string; disabled: boolean }) {
  const nextId = useRef(1);
  const [days, setDays] = useState([{ id: 0, date: today, production: '' }]);
  return <fieldset className="production-days" disabled={disabled}>
    <legend>生产日期与对应数量</legend>
    <p>每行填写一个日期及当天产量，可一次提交多个日期。</p>
    {days.map((day, index) => <div className="production-day" key={day.id}>
      <label>生产日期 {index + 1}<input name="date" aria-label={`生产日期 ${index + 1}`} type="date" value={day.date} required onChange={e => setDays(current => current.map(item => item.id === day.id ? { ...item, date: e.target.value } : item))} /></label>
      <label>生产数量（个）{index + 1}<input name="production" aria-label={`生产数量 ${index + 1}`} type="number" min="1" step="1" value={day.production} required placeholder="请输入当天产量" onChange={e => setDays(current => current.map(item => item.id === day.id ? { ...item, production: e.target.value } : item))} /></label>
      <button type="button" className="text-action" disabled={days.length === 1} aria-label={`移除第 ${index + 1} 行`} onClick={() => setDays(current => current.filter(item => item.id !== day.id))}>移除</button>
    </div>)}
    <div className="production-days-footer"><button type="button" className="outline-button" disabled={days.length >= 366} onClick={() => setDays(current => [...current, { id: nextId.current++, date: '', production: '' }])}>＋ 添加日期</button><span>{days.length} 个日期 · 合计 {days.reduce((sum, day) => sum + (Number(day.production) || 0), 0).toLocaleString()} 个</span></div>
  </fieldset>;
}
