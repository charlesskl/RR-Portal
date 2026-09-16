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
  // Resolve ambiguity across the entire region before applying department permissions.
  const regionalFactories = $app.findRecordsByFilter('factories', '', 'name', 0, 0)
    .filter((f) => (f.getString('region') || 'dongguan') === region)
    .map((f) => ({ id: f.id, name: f.getString('name'), craft: f.getString('craft') }))
  const factories = regionalFactories.filter((f) => !crafts.length || crafts.includes(f.craft))
    .map((f) => ({ id: f.id, name: f.name }))
  if (!factories.length) return e.json(200, { factories, records: [] })
  function fullKey(value) {
    return normalize(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  }
  function aliasKey(value) {
    // Only remove known geographic prefixes and trailing legal/industry words.
    // No arbitrary substring matching: 伟创二厂 must not become 伟创.
    let key = fullKey(value)
      .replace(/^(广东省|湖南省)/, '')
      .replace(/^(东莞市|河源市|邵阳市|冷水江市|新邵县|新宁县|邵阳县|隆回县|东安县)/, '')
      .replace(/^(清溪镇|清溪)/, '')
    let previous
    do {
      previous = key
      key = key.replace(/(有限责任公司|股份有限公司|有限公司|公司|加工厂|制品厂|玩具厂|塑胶厂|电子厂|厂|五金|塑胶|塑料|电子|玩具|制品|加工|制造|制衣|服装|缝纫|毛绒|实业|科技)$/, '')
    } while (previous !== key)
    return key
  }
  function matchFactory(supplier) {
    const key = fullKey(supplier)
    if (!key) return null
    const exact = regionalFactories.filter((f) => fullKey(f.name) === key)
    let candidates = exact
    if (!exact.length) {
      const alias = aliasKey(supplier)
      if (alias.length < 2) return null
      candidates = regionalFactories.filter((f) => aliasKey(f.name) === alias)
    }
    if (candidates.length !== 1) return null
    return factories.find((f) => f.id === candidates[0].id) || null
  }
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
    data.records.forEach((r) => {
      const factory = matchFactory(r.supplier)
      if (!factory) return
      const row = {}
      fields.forEach((key) => { row[key] = r[key] == null ? '' : r[key] })
      row.supplier = normalize(r.supplier)
      row.factoryId = factory.id
      row.factoryName = factory.name
      row.company = company.id
      row.companyName = company.name
      row.recordKey = company.id + ':' + r.id
      records.push(row)
    })
  })
  return e.json(200, { factories, records })
}, $apis.requireAuth('users'))
