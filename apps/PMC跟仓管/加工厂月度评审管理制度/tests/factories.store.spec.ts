import { describe, it, expect } from 'vitest'
import { filterByCraft } from '../src/stores/factories'
import type { Factory } from '../src/types/factory'

const make = (id: string, craft: Factory['craft']): Factory =>
  ({ id, name: id, craft, status: 'active' })

describe('filterByCraft', () => {
  const all = [make('a', 'injection'), make('b', 'painting')]
  it('returns all when craft is null', () => {
    expect(filterByCraft(all, null).length).toBe(2)
  })
  it('filters to one craft', () => {
    expect(filterByCraft(all, 'painting').map((f) => f.id)).toEqual(['b'])
  })
})
