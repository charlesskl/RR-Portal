// 子路径部署: vite --base /pi-outsource/ 时 BASE_URL = '/pi-outsource/'
// 所有 API 请求前缀为 /pi-outsource/api/...，命中 nginx 的 /pi-outsource/api/ location
export const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

const json = (r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t || r.statusText); });
const f = (path, opts) => fetch(BASE + path, opts).then(json);

export const api = {
  // orders
  listOrders:    ()      => f('/api/orders'),
  createOrder:   (b)     => f('/api/orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  updateOrder:   (id, b) => f(`/api/orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  deleteOrder:   (id)    => f(`/api/orders/${id}`, { method:'DELETE' }),

  // suppliers
  listSuppliers: ()      => f('/api/suppliers'),
  createSupplier:(b)     => f('/api/suppliers', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  updateSupplier:(id, b) => f(`/api/suppliers/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  deleteSupplier:(id)    => f(`/api/suppliers/${id}`, { method:'DELETE' }),

  // pc
  listPc:        ()      => f('/api/pc-orders'),
  createPc:      (b)     => f('/api/pc-orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  updatePc:      (id, b) => f(`/api/pc-orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }),
  deletePc:      (id)    => f(`/api/pc-orders/${id}`, { method:'DELETE' }),

  // stats
  summary:       ()      => f('/api/stats/summary'),

  // pdf import
  parsePdf:      (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return f('/api/parse-pdf', { method: 'POST', body: fd });
  },
  parsePdfAi:    (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return f('/api/parse-pdf-ai', { method: 'POST', body: fd });
  },

  // mold mappings
  listMoldMappings: ()           => f('/api/mold-mappings'),
  saveMoldMappings: (mappings)   => f('/api/mold-mappings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mappings }),
  }),
  updateMoldMapping: (code, body) => f(`/api/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
  deleteMoldMapping: (code) => f(`/api/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  }),
  moldFactoryMap: () => f('/api/mold-factory-map'),

  // workshops (autocomplete options for 车间)
  listWorkshops: () => f('/api/workshops'),

  // Bulk-rename a supplier across orders + mappings + suppliers list
  renameSupplier: (from, to) => f('/api/suppliers/rename', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to }),
  }),
  importPdfRows: (body)  => f('/api/import-pdf-rows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),

  // excel export
  exportAllUrl:  ()      => BASE + '/api/orders/export.xlsx',
  exportRows:    (rows, filename, sheet_name) => fetch(BASE + '/api/export-excel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows, filename, sheet_name }),
  }).then((r) => r.ok ? r.blob() : r.text().then((t) => { throw new Error(t); })),
};

