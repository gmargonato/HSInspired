/** Vite discovers the catalog at startup/build; URLs do not decode textures. */
const cornerUrls = import.meta.glob('../../../assets/images/table/corner-*.png', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

export const TABLE_CORNERS = Object.entries(cornerUrls)
  .map(([path, source]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -4)
    return { id, label: id.slice('corner-'.length), source }
  })
  .sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'en', { numeric: true }) ||
      a.id.localeCompare(b.id)
  )
