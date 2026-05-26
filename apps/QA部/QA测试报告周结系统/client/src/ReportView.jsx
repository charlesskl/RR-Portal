import SheetImages from './SheetImages.jsx';

export default function ReportView({ report, showSummary = true, headingLevel = 'h3' }) {
  if (!report) return null;
  const Heading = headingLevel;
  return (
    <div className="report-view">
      <Heading className="report-view-title">{report.originalName}</Heading>
      {showSummary && (
        <div className="summary">
          <span>客户：<b>{report.customerName}</b></span>
          <span>归属周：<b>{report.weekKey}</b></span>
          <span>有效行数：{report.totalRows}</span>
          <span>不合格行数：<b style={{ color: '#dc2626' }}>{report.failCount}</b></span>
          {report.totalImages > 0 && <span>附图：<b>{report.totalImages}</b> 张</span>}
          <span>上传时间：{new Date(report.uploadedAt).toLocaleString('zh-CN')}</span>
        </div>
      )}
      {report.sheets.map(sh => (
        <div key={sh.sheetId} className="sheet-block">
          <h4>Sheet: {sh.name}（{sh.totalRows} 行 / 不合格 {sh.failCount} 行）</h4>
          {sh.failRows.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>行号</th>
                    {sh.headers.map((h, i) => <th key={i}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sh.failRows.map(row => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      {sh.headers.map((_, i) => {
                        const c = row.cells[i];
                        return (
                          <td key={i} className={c && c.isRed ? 'red-cell' : ''}>
                            {c ? c.value : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="hint">本 Sheet 无不合格行</p>}
          <SheetImages sheet={sh} />
        </div>
      ))}
    </div>
  );
}
