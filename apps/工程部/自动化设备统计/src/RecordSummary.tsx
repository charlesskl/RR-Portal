import { Fragment } from 'react';
import { summarizeRecords, type SummaryRecord } from './record-summary';

type Props = {
  groups: ReturnType<typeof summarizeRecords<SummaryRecord>>;
  table: boolean;
  onAction: (mode: 'edit' | 'delete', record: SummaryRecord) => void;
};
export default function RecordSummary({ groups, table, onAction }: Props) {
  const total = groups.reduce((sum, group) => sum + group.production, 0);
  const count = groups.reduce((sum, group) => sum + group.records.length, 0);
  function details(group: Props['groups'][number]) {
    return <details className="summary-details">
      <summary>查看明细（{group.records.length} 条）</summary>
      <div className="summary-detail-list">{group.records.map(record => <div key={record.id} className="summary-detail-row">
        <div><strong>{record.production.toLocaleString()} 个</strong><p>{record.workshop} · {record.line} · {record.operator}</p><small>{record.note || '无备注'}</small></div>
        <div className="history-actions">
          <button className="text-action" aria-label={`编辑${record.equipment} ${record.date}记录${record.id}`} onClick={() => onAction('edit', record)}>编辑</button>
          <button className="text-action danger-action" aria-label={`删除${record.equipment} ${record.date}记录${record.id}`} onClick={() => onAction('delete', record)}>删除</button>
        </div>
      </div>)}</div>
    </details>;
  }
  if (table) return <div className="record-sheet" id="history-records">
    <div className="record-sheet-heading"><div><h3>厂区机器日汇总</h3><p>同一厂区、机器、日期合并产量</p></div><span>{groups.length} 组 · {count} 条上报</span></div>
    <div className="record-sheet-scroll" tabIndex={0} role="region" aria-label="厂区机器日汇总，可横向滚动">
      <table className="record-sheet-table summary-table"><thead><tr><th scope="col">厂区</th><th scope="col">机器</th><th scope="col">生产日期</th><th scope="col" className="sheet-number">汇总产量（个）</th><th scope="col">上报条数</th><th scope="col">明细 / 操作</th></tr></thead>
        <tbody>{groups.map(group => <tr key={group.key}><td>{group.factory}</td><td className="sheet-equipment">{group.equipment}</td><td className="sheet-date">{group.date}</td><td className="sheet-number sheet-production">{group.production.toLocaleString()}</td><td>{group.records.length}</td><td>{details(group)}</td></tr>)}
          {!groups.length && <tr><td colSpan={6} className="record-empty">暂无更新记录</td></tr>}
        </tbody><tfoot><tr><th colSpan={3} scope="row">产量合计</th><td className="sheet-number">{total.toLocaleString()}</td><td>{count}</td><td>{groups.length} 组</td></tr></tfoot>
      </table>
    </div>
  </div>;
  const factories = [...new Set(groups.map(group => group.factory))];
  return <div className="factory-summary-list" id="history-records">
    {!groups.length && <p className="record-empty">暂无更新记录</p>}
    {factories.map(factory => {
      const factoryGroups = groups.filter(group => group.factory === factory);
      const machines = [...new Set(factoryGroups.map(group => group.equipment))];
      return <section className="factory-summary" key={factory}>
        <header><h3>{factory}</h3><span>{machines.length} 类机器 · 合计 <b>{factoryGroups.reduce((sum, group) => sum + group.production, 0).toLocaleString()}</b> 个</span></header>
        {machines.map(machine => {
          const days = factoryGroups.filter(group => group.equipment === machine);
          return <div className="machine-summary" key={machine}><div className="machine-summary-heading"><h4>{machine}</h4><span>{days.length} 天 · {days.reduce((sum, group) => sum + group.production, 0).toLocaleString()} 个</span></div>
            {days.map(group => <Fragment key={group.key}><div className="day-summary"><time dateTime={group.date}>{group.date}</time><strong>{group.production.toLocaleString()} <small>个</small></strong><span>{group.records.length} 条上报</span></div>{details(group)}</Fragment>)}
          </div>;
        })}
      </section>;
    })}
  </div>;
}
