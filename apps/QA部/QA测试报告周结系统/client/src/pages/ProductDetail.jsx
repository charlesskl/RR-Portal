import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProduct } from '../api.js';

const STATUS_LABELS = { open: '未解决', recurring: '复发', resolved: '已解决' };

export default function ProductDetail() {
  const { productNo } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getProduct(productNo).then(setData).catch(e => setError(e.message));
  }, [productNo]);

  if (error) return <div className="page"><div className="error">{error}</div><Link to="/">返回产品列表</Link></div>;
  if (!data) return <div className="page">加载产品档案中…</div>;

  const { product, stages } = data;
  return (
    <div className="page lifecycle-page">
      <Link className="back-link" to="/">← 返回产品列表</Link>
      <div className="product-detail-head">
        <div>
          <div className="eyebrow">{product.customerName}</div>
          <h2>{product.productNo} · {product.productName || '未填写产品名称'}</h2>
          <p className="hint">共 {product.reportCount} 份测试报告，当前阶段 {product.currentStage || '未识别'}</p>
        </div>
        <div className={`product-health ${product.openCount ? 'has-open' : 'clear'}`}>
          <strong>{product.openCount}</strong>
          <span>项未解决</span>
        </div>
      </div>

      <div className="stage-panel">
        <h3>开发阶段</h3>
        <div className="stage-rail">
          {stages.map(stage => (
            <div key={stage} className={`stage-node ${product.completedStages.includes(stage) ? 'done' : ''} ${product.currentStage === stage ? 'current' : ''}`}>
              <i />
              <span>{stage}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="issue-section">
        <div className="section-heading">
          <div><h3>需要重点处理</h3><p>没有明确 PASS 的问题会一直保留在这里。</p></div>
          <span className="count-pill danger">{product.openIssues.length}</span>
        </div>
        {product.openIssues.length === 0 ? (
          <div className="all-clear">✓ 当前没有未解决问题</div>
        ) : (
          <div className="issue-grid">
            {product.openIssues.map(issue => <IssueCard key={issue.issueKey} issue={issue} />)}
          </div>
        )}
      </section>

      <section className="timeline-section">
        <div className="section-heading"><div><h3>测试报告时间线</h3><p>按 FS → EP → EP1 → PE2 → FEP → PP → PS 排列。</p></div></div>
        <div className="report-timeline">
          {product.reports.map(report => (
            <div className="timeline-report" key={report.id}>
              <div className="timeline-marker">{report.stage}</div>
              <div className="timeline-content">
                <Link to={`/reports/${report.id}`}><b>{report.originalName}</b></Link>
                <div className="timeline-meta">
                  <span>{formatDate(report.reportDate || report.uploadedAt)}</span>
                  <span className="danger-text">FAIL {report.failCount}</span>
                  <span className="success-text">PASS {report.passCount}</span>
                  {report.totalImages > 0 && <span>图片 {report.totalImages}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="resolved-section">
        <div className="section-heading">
          <div><h3>已解决问题</h3><p>只有后续报告明确 PASS 才会进入这里，历史仍可追溯。</p></div>
          <span className="count-pill success">{product.resolvedIssues.length}</span>
        </div>
        {product.resolvedIssues.length === 0 ? <p className="hint">暂无已解决问题</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>测试项目</th><th>首次发现</th><th>解决阶段</th><th>最后问题描述</th></tr></thead>
              <tbody>
                {product.resolvedIssues.map(issue => (
                  <tr key={issue.issueKey}>
                    <td><b>{issue.testItem}</b></td>
                    <td>{issue.firstSeenStage} · {formatDate(issue.firstSeenAt)}</td>
                    <td><span className="status-badge resolved">{issue.resolvedStage} PASS</span></td>
                    <td>{issue.latestDescription}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function IssueCard({ issue }) {
  return (
    <article className={`issue-card ${issue.status}`}>
      <div className="issue-card-head">
        <div><span className={`status-badge ${issue.status}`}>{STATUS_LABELS[issue.status]}</span><h4>{issue.testItem}</h4></div>
        {issue.recurrenceCount > 0 && <b className="recurrence-count">复发 {issue.recurrenceCount} 次</b>}
      </div>
      <p className="issue-description">{issue.latestDescription || '报告中未填写问题描述'}</p>
      <div className="issue-meta">
        <span>首次：{issue.firstSeenStage} · {formatDate(issue.firstSeenAt)}</span>
        <span>最近：{issue.lastSeenStage} · {formatDate(issue.lastSeenAt)}</span>
      </div>
      <div className="issue-history">
        {issue.history.map((event, index) => (
          <div className={`issue-event ${event.type}`} key={`${event.reportId}-${index}`}>
            <span>{event.stage}</span>
            <Link to={`/reports/${event.reportId}`}>{event.type === 'pass' ? '明确 PASS' : event.description || 'FAIL'}</Link>
          </div>
        ))}
      </div>
    </article>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
}
