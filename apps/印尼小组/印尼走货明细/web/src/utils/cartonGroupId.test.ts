import { afterEach, expect, it, vi } from 'vitest'
import { createCartonGroupId } from './cartonGroupId'

afterEach(() => vi.unstubAllGlobals())

it('uses native randomUUID when available', () => {
  const randomUUID = vi.fn(() => 'native-id')
  vi.stubGlobal('crypto', { randomUUID })
  expect(createCartonGroupId()).toBe('native-id')
  expect(randomUUID).toHaveBeenCalledOnce()
})

it('supports HTTP environments without randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(1) })
  expect(createCartonGroupId()).toBe('01010101-0101-4101-8101-010101010101')
})

it('keeps groups distinct even without crypto within the same millisecond', () => {
  vi.stubGlobal('crypto', undefined)
  const ids = Array.from({ length: 1000 }, () => createCartonGroupId())
  expect(new Set(ids).size).toBe(1000)
  expect(ids.every(id => id.startsWith('carton-'))).toBe(true)
})
