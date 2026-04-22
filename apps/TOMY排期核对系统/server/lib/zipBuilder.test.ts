import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildZipBuffer } from './zipBuilder.js'

describe('buildZipBuffer', () => {
  it('returns a Buffer that starts with PK zip signature', async () => {
    const entries = [
      { name: 'test.txt', buffer: Buffer.from('hello world') },
    ]
    const result = await buildZipBuffer(entries)
    expect(result).toBeInstanceOf(Buffer)
    // ZIP files start with PK signature: 0x50 0x4B
    expect(result[0]).toBe(0x50)
    expect(result[1]).toBe(0x4b)
  })

  it('preserves folder paths for entries (DG/file.xlsx, ID/file.xlsx)', async () => {
    const entries = [
      { name: 'DG/schedule-DG.xlsx', buffer: Buffer.from('dg content') },
      { name: 'ID/schedule-ID.xlsx', buffer: Buffer.from('id content') },
    ]
    const result = await buildZipBuffer(entries)
    const zip = await JSZip.loadAsync(result)
    const fileNames = Object.keys(zip.files)
    expect(fileNames).toContain('DG/schedule-DG.xlsx')
    expect(fileNames).toContain('ID/schedule-ID.xlsx')
  })

  it('returns a valid (empty) ZIP buffer when given an empty entries array', async () => {
    const result = await buildZipBuffer([])
    expect(result).toBeInstanceOf(Buffer)
    // Still starts with PK signature
    expect(result[0]).toBe(0x50)
    expect(result[1]).toBe(0x4b)
    // Can be parsed as a valid ZIP
    const zip = await JSZip.loadAsync(result)
    expect(Object.keys(zip.files)).toHaveLength(0)
  })

  it('entry buffers are byte-identical when extracted (round-trip fidelity)', async () => {
    const originalContent = Buffer.from([0x01, 0x02, 0x03, 0xaa, 0xbb, 0xcc])
    const entries = [
      { name: 'data/file.bin', buffer: originalContent },
    ]
    const result = await buildZipBuffer(entries)
    const zip = await JSZip.loadAsync(result)
    const extracted = await zip.file('data/file.bin')!.async('nodebuffer')
    expect(Buffer.from(extracted)).toEqual(originalContent)
  })
})
