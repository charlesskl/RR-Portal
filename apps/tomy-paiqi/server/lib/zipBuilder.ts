import archiver from 'archiver'
import { PassThrough } from 'stream'

export interface ZipEntry {
  name: string
  buffer: Buffer
}

/**
 * Builds a ZIP archive from in-memory buffers and returns it as a Buffer.
 * Each entry's name can include folder paths (e.g., "DG/file.xlsx").
 */
export async function buildZipBuffer(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } })
    const pass = new PassThrough()
    const chunks: Buffer[] = []

    pass.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    pass.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    pass.on('error', (err: Error) => {
      reject(err)
    })

    archive.on('error', (err: Error) => {
      reject(err)
    })

    archive.on('warning', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        reject(err)
      }
    })

    archive.pipe(pass)

    for (const entry of entries) {
      archive.append(entry.buffer, { name: entry.name })
    }

    archive.finalize()
  })
}
