import { describe, expect, it } from 'vitest'
import { fillMissingToolHs, toolHsCandidates } from './toolHsMatch'

describe('工具 HS 字典候选', () => {
  const dictionary = [
    { keyword: '模', hsCN: '001', hsID: '002' },
    { keyword: '边模', hsCN: '003', hsID: '004' },
    { keyword: '', hsCN: '999' },
  ]
  it('显示所有名称匹配，具体关键词在前，编码保留前导零', () => {
    expect(toolHsCandidates({ name_zh: '大边模' }, dictionary).map(d => d.keyword)).toEqual(['边模', '模'])
    expect(fillMissingToolHs({}, dictionary[0]).hs_cn).toBe('001')
  })
  it('没有字典命中不推断，货号及类别不参与匹配', () => {
    expect(toolHsCandidates({ name_zh: '未知', product_code: '模', tool_kind: '工具' }, dictionary)).toEqual([])
    expect(toolHsCandidates({ name_zh: '模' }, [])).toEqual([])
  })
  it('已填的一国编码不被覆盖，不推荐与现有编码冲突的组合', () => {
    expect(toolHsCandidates({ name_zh: '大边模', hs_cn: '001' }, dictionary)).toEqual([dictionary[0]])
    expect(fillMissingToolHs({ id: 8, revision: 3, hs_cn: 'keep' }, dictionary[0])).toMatchObject({ id: 8, revision: 3, hs_cn: 'keep', hs_id: '002' })
  })
  it('两国均已填写或字典无可补的字段时不推荐', () => {
    expect(toolHsCandidates({ name_zh: '模', hs_cn: '001', hs_id: '002' }, dictionary)).toEqual([])
    expect(toolHsCandidates({ name_zh: '模', hs_cn: '001' }, [{ keyword: '模', hsCN: '001' }])).toEqual([])
  })
  it('空白视为缺失，已填写的格式不更改', () => {
    expect(fillMissingToolHs({ hs_cn: '  ', hs_id: ' 002 ' }, dictionary[0])).toMatchObject({ hs_cn: '001', hs_id: ' 002 ' })
  })
})
