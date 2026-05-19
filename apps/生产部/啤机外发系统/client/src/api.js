const json = (r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t || r.statusText); });

export const api = {
  // orders
  listOrders:    ()      => fetch('/api/orders').then(json),
  createOrder:   (b)     => fetch('/api/orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updateOrder:   (id, b) => fetch(`/api/orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deleteOrder:   (id)    => fetch(`/api/orders/${id}`, { method:'DELETE' }).then(json),

  // suppliers
  listSuppliers: ()      => fetch('/api/suppliers').then(json),
  createSupplier:(b)     => fetch('/api/suppliers', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updateSupplier:(id, b) => fetch(`/api/suppliers/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deleteSupplier:(id)    => fetch(`/api/suppliers/${id}`, { method:'DELETE' }).then(json),

  // pc
  listPc:        ()      => fetch('/api/pc-orders').then(json),
  createPc:      (b)     => fetch('/api/pc-orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updatePc:      (id, b) => fetch(`/api/pc-orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deletePc:      (id)    => fetch(`/api/pc-orders/${id}`, { method:'DELETE' }).then(json),

  // stats
  summary:       ()      => fetch('/api/stats/summary').then(json),

  // pdf import
  parsePdf:      (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/parse-pdf', { method: 'POST', body: fd }).then(json);
  },
  parsePdfAi:    (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/parse-pdf-ai', { method: 'POST', body: fd }).then(json);
  },

  // mold mappings
  listMoldMappings: ()           => fetch('/api/mold-mappings').then(json),
  saveMoldMappings: (mappings)   => fetch('/api/mold-mappings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mappings }),
  }).then(json),
  updateMoldMapping: (code, body) => fetch(`/api/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json),
  deleteMoldMapping: (code) => fetch(`/api/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  }).then(json),
  moldFactoryMap: () => fetch('/api/mold-factory-map').then(json),

  // workshops (autocomplete options for 车间)
  listWorkshops: () => fetch('/api/workshops').then(json),

  // Bulk-rename a supplier across orders + mappings + suppliers list
  renameSupplier: (from, to) => fetch('/api/suppliers/rename', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to }),
  }).then(json),
  importPdfRows: (body)  => fetch('/api/import-pdf-rows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(json),

  // excel export
  exportAllUrl:  ()      => '/api/orders/export.xlsx',
  exportRows:    (rows, filename, sheet_name) => fetch('/api/export-excel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows, filename, sheet_name }),
  }).then((r) => r.ok ? r.blob() : r.text().then((t) => { throw new Error(t); })),
};

