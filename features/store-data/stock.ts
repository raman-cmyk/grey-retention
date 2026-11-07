/** A catalogue product as the Store tab needs it. */
export type CatalogueProduct = {
  id: string
  title: string
  url: string | null
  stock: number
  stockObservedAt: string
  /** A sample (fixture) product. */
  sample: boolean
}

export type StockReport = {
  total: number
  outOfStock: CatalogueProduct[]
  /** In stock, but `lowStockAt` or fewer left. */
  low: CatalogueProduct[]
  /**
   * Stock not checked in the last 24 hours. Scheduling refuses a campaign
   * that features such a product until its stock is checked again.
   */
  stale: CatalogueProduct[]
  /** Every product is a sample product. */
  sample: boolean
}

/** "Low stock" means this many or fewer left. */
export const lowStockAt = 5

const DAY = 24 * 3600 * 1000

/** Stock alerts from the workspace's own catalogue. */
export function stockReport(
  products: CatalogueProduct[],
  now: Date
): StockReport {
  const stale = (p: CatalogueProduct) => {
    const at = Date.parse(p.stockObservedAt)
    return !Number.isFinite(at) || now.getTime() - at > DAY
  }
  const byStock = (a: CatalogueProduct, b: CatalogueProduct) =>
    a.stock - b.stock || a.title.localeCompare(b.title)
  return {
    total: products.length,
    outOfStock: products.filter((p) => p.stock <= 0),
    low: products
      .filter((p) => p.stock > 0 && p.stock <= lowStockAt)
      .sort(byStock),
    stale: products.filter(stale),
    sample: products.length > 0 && products.every((p) => p.sample)
  }
}
