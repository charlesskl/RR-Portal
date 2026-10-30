import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const material = (id: number) => ({ id, product_code: 'TEST-ONLY', name_zh: `合成物料${id}`, name_en: `Synthetic material ${id}`,
  spec: '10*20MM', category: '五金', unit_kg: 'KGM', net_per_pc: .2, weight_per_carton: 2, length: 10, width: 20, height: 5, hs_cn: '7318159090', hs_id: '73181590' })
const items = Array.from({ length: 68 }, (_, index) => ({ id: index + 1, seq: index + 1, material_id: index + 1,
  qty: 100 + index, kg: (100 + index) * .2, cartons: 2, weighing_qty: 10, qty_per_carton: '50',
  purchase_unit: '个', price: .5, supplier: '合成供应商', po_no: `TEST-PO-${index + 1}`, po_date: '2026-10-01',
  material_snapshot: material(index + 1), contract_no: `CONTRACT-${index + 1}` }))
const summaries = [
  { id: 11, container_no: 'TEST-68-ROWS', item_count: 68 },
  { id: 12, container_no: 'TEST-LOAD-FAILURE', item_count: 1 },
  { id: 13, container_no: 'TEST-SLOW-MATERIALS', item_count: 2 },
  { id: 14, container_no: 'TEST-MERGED-CARTONS', item_count: 4 },
].map(row => ({ ...row, customer: 'RRI', container_count: 1, rate: .93, status: 'draft', ship_date: '2026-11-02' }))

export default defineConfig({ plugins: [react(), {
  name: 'synthetic-shipment-read-only-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (!url.pathname.startsWith('/api/')) return next()
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      const send = (data: unknown, status = 200, delay = 0) => setTimeout(() => {
        res.statusCode = status; res.end(JSON.stringify(data))
      }, delay)
      if (req.method !== 'GET') return send({ error: '隔离回归环境禁止写入' }, 405)
      if (url.pathname === '/api/shipments') return send(summaries)
      if (url.pathname === '/api/shipments/12') return send({ error: '合成加载失败' }, 503, 300)
      if (url.pathname.startsWith('/api/shipments/')) {
        const id = Number(url.pathname.split('/').at(-1)), summary = summaries.find(row => row.id === id)
        const detailItems = id === 11 ? items : id === 13 ? items.slice(0, 2).map(item => ({ ...item, material_snapshot: undefined }))
          : [
            { ...items[0], material_snapshot: undefined, outbound_id: 1, material_id: 1, po_no: 'PO-A', contract_no: 'GROUP-CONTRACT', carton_group: 'SHARED', cartons: 4 },
            { ...items[1], material_snapshot: undefined, outbound_id: 2, material_id: 1, po_no: 'PO-B', contract_no: 'GROUP-CONTRACT', carton_group: 'SHARED', cartons: 4 },
            { ...items[2], material_snapshot: undefined, outbound_id: 3, material_id: 2, po_no: 'PO-A', carton_group: 'SHARED', cartons: 4 },
            { ...items[3], material_snapshot: undefined, outbound_id: 4, material_id: 3 },
          ]
        return send({ ...summary, items: detailItems }, 200, 650)
      }
      if (url.pathname === '/api/materials/by-ids') return send((url.searchParams.get('ids') || '').split(',').map(Number).map(material), 200, 900)
      if (url.pathname === '/api/dictionaries') return send({ suppliers: [], hs: [], translations: [] })
      if (url.pathname === '/api/customers') return send(['RRI'])
      if (url.pathname === '/api/outbound/allocatable') return send(items.map(row => ({ outbound_id: row.id, material_id: row.material_id, allocatable_qty: 100000, qty: 100000 })))
      return send([])
    })
  },
}], server: { host: '127.0.0.1', port: 5196, strictPort: true } })
