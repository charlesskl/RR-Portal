import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync('pb_hooks/qms_inspections.pb.js', 'utf8')
function setup(options: { permissions?: object; region?: string; crafts?: string[]; records?: object[]; fail?: boolean; factories?: object[]; wrongCompany?: boolean } = {}) {
  let handler: any
  const send = vi.fn(({ url }: { url: string }) => {
    if (options.fail) throw new Error('offline')
    if (url.endsWith('/api/companies')) return { statusCode: 200, json: { companies: [
      { id: 'dg-xingxin', site: '东莞', name: '东莞兴信' },
      { id: 'dg-huajia', site: '东莞', name: '东莞华嘉' },
      { id: 'hy-huakang-a', site: '河源', name: '华康A' },
    ] } }
    return { statusCode: 200, json: { company: options.wrongCompany ? 'wrong' : url.split('company=')[1], records: options.records || [
      { id: 1, supplier: '  伟创 ', productName: '小熊', qty: 100, secret: 'private' },
      { id: 2, supplier: '伟创二厂' }, { id: 3, supplier: '湖南工厂' },
      { id: 4, supplier: '' }, { id: 5, supplier: '喷油工厂' },
    ], users: [{ password: 'never-return' }] } }
  })
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  const record = (data: any) => ({ id: data.id, getString: (key: string) => data[key] || '' })
  runInNewContext(source, {
    routerAdd: (_method: string, _path: string, fn: any) => { handler = fn },
    $apis: { requireAuth: () => null },
    $os: { getenv: () => '' }, $http: { send }, ApiError,
    ForbiddenError: Error, BadRequestError: Error,
    $app: { findRecordsByFilter: () => (options.factories || [
      { id: 'a', name: '伟创', craft: 'sewing' },
      { id: 'b', name: '湖南工厂', region: 'hunan', craft: 'sewing' },
      { id: 'c', name: '喷油工厂', craft: 'painting' },
    ]).map(record) },
  })
  const auth = { collection: () => ({ name: 'users' }),
    getString: (key: string) => key === 'permissions' ? JSON.stringify(options.permissions || {}) : '',
    get: () => options.crafts || ['sewing'] }
  const invoke = (user: any = auth) => handler({ auth: user,
    request: { url: { query: () => ({ get: () => options.region || 'dongguan' }) } },
    json: (_code: number, data: any) => data,
  })
  return { invoke, send }
}

describe('QMS inspection bridge', () => {
  it('matches exact trimmed names and restricts factories by region and craft', () => {
    const { invoke } = setup()
    const data = invoke()
    expect(data.factories).toEqual([{ id: 'a', name: '伟创' }])
    expect(data.records).toHaveLength(2)
    expect(data.records.map((r: any) => r.recordKey)).toEqual(['dg-xingxin:1', 'dg-huajia:1'])
    expect(data.records[0]).toMatchObject({ id: 1, supplier: '伟创', qty: 100 })
    expect(JSON.stringify(data)).not.toMatch(/secret|password|never-return/)
  })
  it('reads only companies in the requested region and rejects a wrong source', () => {
    const { invoke, send } = setup()
    invoke()
    expect(send.mock.calls.map(([arg]) => arg.url)).toEqual([
      'http://qc:3400/api/companies',
      'http://qc:3400/api/bootstrap?company=dg-xingxin',
      'http://qc:3400/api/bootstrap?company=dg-huajia',
    ])
    expect(setup({ wrongCompany: true }).invoke).toThrow('子公司数据异常')
  })
  it('rejects unauthenticated requests', () => { expect(() => setup().invoke(null)).toThrow() })
  it.each([{ 'quality.view': false }, { 'region.dongguan': false }])('enforces permissions %j', permissions => {
    const { invoke, send } = setup({ permissions })
    expect(invoke).toThrow(); expect(send).not.toHaveBeenCalled()
  })
  it('rejects invalid regions', () => { expect(setup({ region: 'all' }).invoke).toThrow() })
  it('does not load all QMS data when no factory matches', () => {
    const { invoke, send } = setup({ factories: [] })
    expect(invoke().records).toEqual([]); expect(send).not.toHaveBeenCalled()
  })
  it('returns a retriable error if QMS is down', () => {
    expect(setup({ fail: true }).invoke).toThrow('品质管理系统暂时无法连接')
  })
})
