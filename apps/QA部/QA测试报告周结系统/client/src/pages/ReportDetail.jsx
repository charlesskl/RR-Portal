import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReport } from '../api.js';
import ReportView from '../ReportView.jsx';

export default function ReportDetail() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getReport(id)
      .then(r => setReport(r.report))
      .catch(e => setError(e.message));
  }, [id]);

  if (error) return <div className="page"><div className="error">{error}</div><Link to="/reports">返回</Link></div>;
  if (!report) return <div className="page">加载中…</div>;

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}><Link to="/reports">← 返回列表</Link></div>
      <ReportView report={report} headingLevel="h2" />
    </div>
  );
}
