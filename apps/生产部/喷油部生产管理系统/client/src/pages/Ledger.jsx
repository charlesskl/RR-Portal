import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, DatePicker, Button, Space, message, Card, Statistic, Table } from 'antd';
import dayjs from 'dayjs';
import api from '../api';

const getLuckysheet = () => window.luckysheet;

function buildCelldata(columns, rows) {
  const celldata = [];
  columns.forEach((col, c) => {
    celldata.push({
      r: 0, c,
      v: { v: col.label, ct: { t: 's' }, bg: '#FFFDE7', bl: 1, ht: 0, vt: 0 },
    });
  });
  rows.forEach((row, ri) => {
    const r = ri + 1;
    columns.forEach((col, c) => {
      const val = row.values[col.key];
      const isEditable = !!col.editable;
      const cellValue = {
        v: val ?? '',
        m: val == null ? '' : String(val),
        ct: { t: typeof val === 'number' ? 'n' : 's' },
      };
      if (!isEditable) cellValue.bg = '#E6F4FF';
      celldata.push({ r, c, v: cellValue });
    });
  });
  return celldata;
}

function MonthlyView({ date, setDate, data, onReload }) {
  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        月份:
        <DatePicker
          picker="month"
          value={date}
          onChange={d => setDate(d || dayjs())}
          allowClear={false}
        />
        <Button onClick={onReload}>刷新</Button>
      </Space>
      <Card style={{ marginBottom: 16 }}>
        <Statistic
          title={`${date.format('YYYY年M月')} 总产值`}
          value={data.total_output || 0}
          precision={2}
          prefix="¥"
        />
      </Card>
      <div style={{ display: 'flex', gap: 16 }}>
        <Card title="按拉汇总" style={{ flex: 1 }}>
          <Table
            rowKey={(r) => r.line_id ?? r.line_name}
            size="small"
            pagination={false}
            dataSource={data.by_line || []}
            columns={[
              { title: '拉', dataIndex: 'line_name' },
              { title: '总产值', dataIndex: 'total_output', align: 'right', render: v => `¥${Number(v || 0).toFixed(2)}` },
              { title: '总工资', dataIndex: 'total_wage', align: 'right', render: v => `¥${Number(v || 0).toFixed(2)}` },
              { title: '工作天数', dataIndex: 'worker_days', align: 'right' },
            ]}
          />
        </Card>
        <Card title="按货号汇总" style={{ flex: 1 }}>
          <Table
            rowKey={(r) => r.product_id ?? r.code}
            size="small"
            pagination={false}
            dataSource={data.by_product || []}
            columns={[
              { title: '货号', dataIndex: 'code', width: 100 },
              { title: '货名', dataIndex: 'name' },
              { title: '总产值', dataIndex: 'total_output', align: 'right', render: v => `¥${Number(v || 0).toFixed(2)}` },
              { title: '生产天数', dataIndex: 'days', align: 'right', width: 80 },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

export default function Ledger() {
  const [activeTab, setActiveTab] = useState('daily');
  const [date, setDate] = useState(dayjs());
  const [data, setData] = useState({ columns: [], rows: [] });
  const containerRef = useRef(null);
  const lsRef = useRef(null);

  const [monthlyMonth, setMonthlyMonth] = useState(dayjs());
  const [monthlyData, setMonthlyData] = useState({ total_output: 0, by_line: [], by_product: [] });

  const load = async (d) => {
    const { data } = await api.get('/ledger', { params: { date: d.format('YYYY-MM-DD') } });
    setData(data);
  };

  const loadMonthly = useCallback(async () => {
    try {
      const m = monthlyMonth.format('YYYY-MM');
      const { data } = await api.get('/ledger/monthly', { params: { month: m } });
      setMonthlyData({
        total_output: data.total_output || 0,
        by_line: data.by_line || [],
        by_product: data.by_product || [],
      });
    } catch (e) {
      message.error('加载月视图失败: ' + e.message);
    }
  }, [monthlyMonth]);

  useEffect(() => { load(date); }, []);

  useEffect(() => {
    if (!data.columns.length) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) { message.error('Luckysheet 未加载'); return; }

    const celldata = buildCelldata(data.columns, data.rows);
    luckysheet.create({
      container: 'luckysheet-container',
      showtoolbar: false,
      showinfobar: false,
      showstatisticBar: false,
      sheetFormulaBar: false,
      enableAddRow: false,
      enableAddBackTop: false,
      data: [{
        name: '收支表',
        celldata,
        row: Math.max(data.rows.length + 2, 30),
        column: data.columns.length,
        config: {
          columnlen: data.columns.reduce((acc, _, i) => ({ ...acc, [i]: 110 }), {}),
        },
      }],
      hook: {
        cellUpdated(r, c, _oldVal, newVal) {
          if (r === 0) return;
          const col = data.columns[c];
          if (!col || !col.editable) return;
          const row = data.rows[r - 1];
          if (!row) return;
          const value = newVal && newVal.v != null ? newVal.v : '';
          api.post('/ledger/edits', {
            date: date.format('YYYY-MM-DD'),
            line_id: row.line_id,
            product_id: row.product_id,
            column_key: col.key,
            value,
          }).catch(e => message.error('保存失败: ' + e.message));
        },
      },
    });
    lsRef.current = luckysheet;
  }, [data]);

  useEffect(() => { load(date); }, [date]);

  useEffect(() => {
    if (activeTab === 'monthly') loadMonthly();
  }, [activeTab, loadMonthly]);

  const onExport = () => {
    const url = `/api/ledger/export?date=${date.format('YYYY-MM-DD')}`;
    window.open(url, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[{ key: 'daily', label: '日视图' }, { key: 'monthly', label: '月视图' }]}
      />
      <div
        style={{
          display: activeTab === 'daily' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        <Space style={{ marginBottom: 12 }}>
          日期:<DatePicker value={date} onChange={d => setDate(d || dayjs())} allowClear={false} />
          <Button onClick={() => load(date)}>刷新</Button>
          <Button type="primary" onClick={onExport}>导出 xlsx</Button>
        </Space>
        <div id="luckysheet-container" ref={containerRef} style={{ flex: 1, border: '1px solid #ddd' }} />
      </div>
      <div style={{ display: activeTab === 'monthly' ? 'block' : 'none', flex: 1, overflow: 'auto' }}>
        <MonthlyView
          date={monthlyMonth}
          setDate={setMonthlyMonth}
          data={monthlyData}
          onReload={loadMonthly}
        />
      </div>
    </div>
  );
}
