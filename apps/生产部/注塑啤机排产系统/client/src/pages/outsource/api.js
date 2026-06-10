const json = (r) => r.ok ? r.json() : r.text().then((t) => { throw new Error(t || r.statusText); });

export const api = {
  // orders
  listOrders:    ()      => fetch('/api/outsource/orders').then(json),
  createOrder:   (b)     => fetch('/api/outsource/orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updateOrder:   (id, b) => fetch(`/api/outsource/orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deleteOrder:   (id)    => fetch(`/api/outsource/orders/${id}`, { method:'DELETE' }).then(json),

  // suppliers
  listSuppliers: ()      => fetch('/api/outsource/suppliers').then(json),
  createSupplier:(b)     => fetch('/api/outsource/suppliers', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updateSupplier:(id, b) => fetch(`/api/outsource/suppliers/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deleteSupplier:(id)    => fetch(`/api/outsource/suppliers/${id}`, { method:'DELETE' }).then(json),

  // pc
  listPc:        ()      => fetch('/api/outsource/pc-orders').then(json),
  createPc:      (b)     => fetch('/api/outsource/pc-orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  updatePc:      (id, b) => fetch(`/api/outsource/pc-orders/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(b) }).then(json),
  deletePc:      (id)    => fetch(`/api/outsource/pc-orders/${id}`, { method:'DELETE' }).then(json),

  // stats
  summary:       ()      => fetch('/api/outsource/stats/summary').then(json),

  // pdf import
  parsePdf:      (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/outsource/parse-pdf', { method: 'POST', body: fd }).then(json);
  },
  parsePdfAi:    (file)  => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/outsource/parse-pdf-ai', { method: 'POST', body: fd }).then(json);
  },

  // mold mappings
  listMoldMappings: ()           => fetch('/api/outsource/mold-mappings').then(json),
  saveMoldMappings: (mappings)   => fetch('/api/outsource/mold-mappings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mappings }),
  }).then(json),
  updateMoldMapping: (code, body) => fetch(`/api/outsource/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json),
  deleteMoldMapping: (code) => fetch(`/api/outsource/mold-mappings/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  }).then(json),
  moldFactoryMap: () => fetch('/api/outsource/mold-factory-map').then(json),

  // workshops (autocomplete options for 车间)
  listWorkshops: () => fetch('/api/outsource/workshops').then(json),
  workshopOrder: () => fetch('/api/outsource/workshop-order').then(json),
  listPmcs: () => fetch('/api/outsource/pmcs').then(json),

  // Bulk-rename a supplier across orders + mappings + suppliers list
  renameSupplier: (from, to) => fetch('/api/outsource/suppliers/rename', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to }),
  }).then(json),
  importPdfRows: (body)  => fetch('/api/outsource/import-pdf-rows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(json),

  // excel export
  exportAllUrl:  ()      => '/api/outsource/orders/export.xlsx',
  exportRows:    (rows, filename, sheet_name) => fetch('/api/outsource/export-excel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows, filename, sheet_name }),
  }).then((r) => r.ok ? r.blob() : r.text().then((t) => { throw new Error(t); })),
};

