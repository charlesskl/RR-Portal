import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { pdfTextRowsToAoa, purchaseOrderPdfItemsToAoa, type PositionedText } from './pdfTableRows'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type TextItem = {
  str: string
  transform: number[]
  width?: number
}

export async function readDeliveryPdfAsAoa(file: File) {
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const items: PositionedText[] = []

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const content = await page.getTextContent()
    for (const raw of content.items as TextItem[]) {
      const text = raw.str.trim()
      if (!text) continue
      items.push({
        text,
        x: raw.transform[4] ?? 0,
        y: (raw.transform[5] ?? 0) - pageNo * 10000,
        width: raw.width ?? text.length * 8,
      })
    }
  }

  const purchaseOrderRows = purchaseOrderPdfItemsToAoa(items, file.name)
  return purchaseOrderRows.length ? purchaseOrderRows : pdfTextRowsToAoa(items)
}
