// Read-only bridge: match QMS suppliers against authorized factories on the server.
routerAdd('GET', '/api/factory-review/qms-inspections', (e) => {
  const auth = e.auth
  if (!auth || auth.collection().name !== 'users') throw new ForbiddenError('请登录加工厂系统')
  let permissions = {}
  try { permissions = JSON.parse(auth.getString('permissions') || '{}') || {} } catch (_) {}
  const region = e.request.url.query().get('region')
  if (!['dongguan', 'hunan', 'heyuan'].includes(region)) throw new BadRequestError('请选择有效厂区')
  if (permissions['quality.view'] === false || permissions['region.' + region] === false) {
    throw new ForbiddenError('没有该厂区的品质管理查看权限')
  }
  let crafts = auth.get('crafts')
  if (!Array.isArray(crafts) || !crafts.length) crafts = auth.getString('craft') ? [auth.getString('craft')] : []
  const normalize = (value) => String(value || '').trim()
  const factories = $app.findRecordsByFilter('factories', '', 'name', 0, 0)
    .filter((f) => (f.getString('region') || 'dongguan') === region &&
      (!crafts.length || crafts.includes(f.getString('craft'))))
    .map((f) => ({ id: f.id, name: f.getString('name') }))
  const names = factories.map((f) => normalize(f.name)).filter(Boolean)
  if (!names.length) return e.json(200, { factories, records: [] })
  const base = ($os.getenv('FACTORY_REVIEW_QMS_URL') || 'http://qc:3400').replace(/\/$/, '')
  function readQms(path) {
    let response
    try { response = $http.send({ url: base + path, method: 'GET', timeout: 5 }) }
    catch (_) { throw new ApiError(502, '品质管理系统暂时无法连接，请稍后重试') }
    if (response.statusCode !== 200 || !response.json) {
      throw new ApiError(502, '品质管理系统返回异常，请稍后重试')
    }
    return response.json
  }
  const directory = readQms('/api/companies')
  if (!Array.isArray(directory.companies)) throw new ApiError(502, '品质管理系统厂区清单异常')
  const site = { dongguan: '东莞', hunan: '湖南', heyuan: '河源' }[region]
  const companies = directory.companies.filter((c) => c.site === site && c.id && c.name)
  if (!companies.length) throw new ApiError(502, '品质管理系统未配置该厂区的子公司')
  // Never forward bootstrap users, credentials, or unmatched supplier records.
  const fields = ['id', 'date', 'inspDate', 'supplier', 'client', 'productNo', 'productName',
    'deliveryNo', 'orderNo', 'type', 'qty', 'sampleQty', 'fail', 'defectRate', 'result',
    'defect', 'qc', 'remark']
  const records = []
  companies.forEach((company) => {
    const data = readQms('/api/bootstrap?company=' + encodeURIComponent(company.id))
    if (data.company !== company.id || !Array.isArray(data.records)) {
      throw new ApiError(502, '品质管理系统子公司数据异常，请稍后重试')
    }
    data.records.filter((r) => names.includes(normalize(r.supplier))).forEach((r) => {
      const row = {}
      fields.forEach((key) => { row[key] = r[key] == null ? '' : r[key] })
      row.supplier = normalize(r.supplier)
      row.company = company.id
      row.companyName = company.name
      row.recordKey = company.id + ':' + r.id
      records.push(row)
    })
  })
  return e.json(200, { factories, records })
}, $apis.requireAuth('users'))
