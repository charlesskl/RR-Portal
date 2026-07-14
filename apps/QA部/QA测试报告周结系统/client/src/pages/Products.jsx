import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCustomers, listProducts } from '../api.js';

const STAGES = ['FS', 'EP', 'EP1', 'PE2', 'FEP', 'PP', 'PS'];

export default function Products() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { listCustomers().then(r => setCustomers(r.list || [])); }, []);
  useEffect(() => {
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      listProducts(customerId, query)
        .then(r => setProducts(r.list || []))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [customerId, query]);

  const stats = useMemo(() => ({
    products: products.length,
    open: products.reduce((sum, product) => sum + product.openCount, 0),
    recurring: products.reduce((sum, product) => sum + product.recurringCount, 0),
    completed: products.filter(product => product.status === 'completed').length
  }), [products]);

  return (
    <div className="page lifecycle-page">
      <div className="page-heading">
        <div>
          <h2>产品测试生命周期</h2>
          <p className="hint">按测试报告货号归档，从 FS 到 PS 跟踪所有测试与问题闭环。</p>
        </div>
        <Link className="btn-link" to="/upload">+ 上传测试报告</Link>
      </div>

      <div className="stat-grid">
        <StatCard label="产品数量" value={stats.products} tone="blue" />
        <StatCard label="未解决问题" value={stats.open} tone={stats.open ? 'red' : 'green'} />
        <StatCard label="复发问题" value={stats.recurring} tone={stats.recurring ? 'purple' : 'green'} />
        <StatCard label="已完成产品" value={stats.completed} tone="green" />
      </div>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="搜索货号、产品名或客户"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <select value={customerId} onChange={event => setCustomerId(event.target.value)}>
          <option value="">全部客户</option>
          {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <p className="hint">加载产品档案中…</p>}
      {!loading && products.length === 0 && (
        <div className="empty-state">
          <h3>暂无产品档案</h3>
          <p>上传第一份测试报告后，系统会根据报告中的货号自动建立产品档案。</p>
          <Link className="btn-link" to="/upload">上传报告</Link>
        </div>
      )}
      {!loading && products.length > 0 && (
        <div className="product-list">
          {products.map(product => (
            <Link className="product-card" key={product.productNo} to={`/products/${encodeURIComponent(product.productNo)}`}>
              <div className="product-card-main">
                <div className="product-title-row">
                  <span className="product-no">{product.productNo}</span>
                  <StatusBadge status={product.status} openCount={product.openCount} recurringCount={product.recurringCount} />
                </div>
                <h3>{product.productName || '未填写产品名称'}</h3>
                <div className="product-meta">
                  <span>客户：{product.customerName}</span>
                  <span>报告：{product.reportCount} 份</span>
                  <span>当前阶段：<b>{product.currentStage || '未识别'}</b></span>
                </div>
                <StageRail completed={product.completedStages || []} current={product.currentStage} />
              </div>
              <div className="issue-counts">
                <div><strong className={product.openCount ? 'danger-text' : 'success-text'}>{product.openCount}</strong><span>未解决</span></div>
                <div><strong className={product.recurringCount ? 'purple-text' : ''}>{product.recurringCount}</strong><span>复发</span></div>
                <div><strong className="success-text">{product.resolvedCount}</strong><span>已解决</span></div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status, openCount, recurringCount }) {
  if (recurringCount > 0) return <span className="status-badge recurring">有复发问题</span>;
  if (openCount > 0) return <span className="status-badge open">有未解决问题</span>;
  if (status === 'completed') return <span className="status-badge resolved">已完成</span>;
  return <span className="status-badge clear">开发中 · 暂无遗留</span>;
}

function StageRail({ completed, current }) {
  return (
    <div className="stage-rail compact">
      {STAGES.map(stage => (
        <div key={stage} className={`stage-node ${completed.includes(stage) ? 'done' : ''} ${current === stage ? 'current' : ''}`}>
          <i />
          <span>{stage}</span>
        </div>
      ))}
    </div>
  );
}
