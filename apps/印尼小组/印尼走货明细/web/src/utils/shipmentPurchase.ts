// Matches exported purchase amount: purchase unit price × delivery weight.
export function shipmentPurchaseAmount(item: { price?: number; kg?: number }) {
  return (Number(item.price) || 0) * (Number(item.kg) || 0)
}
