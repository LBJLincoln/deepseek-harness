/** Split `items` into 1-based pages of `size` items each. */
export function paginate(items, page, size) {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('size must be a positive integer')
  if (!Number.isInteger(page) || page <= 0) throw new RangeError('page must be a positive integer')
  const pages = Math.floor(items.length / size)
  const start = page * size
  return { page, pages, items: items.slice(start, start + size) }
}
