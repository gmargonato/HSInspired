const { createServer } = require('vite')
const vfxLibrary = require('../config/vfx-templates.json')

function auditVfxBindings(cards) {
  const ids = new Set(vfxLibrary.templates.map((template) => template.id))
  let count = 0
  const visit = (value, cardId) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, cardId))
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'vfx') {
        if (!ids.has(nested)) throw new Error(`Unknown VFX key ${nested} on ${cardId}`)
        count += 1
      } else visit(nested, cardId)
    }
  }
  for (const card of cards) visit(card.effects, card.id)
  return count
}

;(async () => {
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  })
  try {
    const inventoryModule = await server.ssrLoadModule(
      '/src/game-rules/content/cards/capability-inventory.ts'
    )
    const capabilityModule = await server.ssrLoadModule(
      '/src/game-rules/match/effects/capability.ts'
    )
    const cardModule = await server.ssrLoadModule(
      '/src/game-rules/content/cards/card-catalog.ts'
    )
    const vfxBindingCount = auditVfxBindings(cardModule.CARD_CATALOG.all)
    inventoryModule.assertCapabilityOwnership()
    const ownershipKeys = new Set(
      inventoryModule.CAPABILITY_OWNERSHIP.map(
        (entry) => `${entry.family}:${entry.name}`
      )
    )
    const runtimeKeys = new Set(
      capabilityModule.RUNTIME_CAPABILITY_REGISTRY.map(
        (entry) => `${entry.family}:${entry.name}`
      )
    )
    if (
      ownershipKeys.size !== runtimeKeys.size ||
      [...ownershipKeys].some((key) => !runtimeKeys.has(key))
    ) {
      throw new Error('Runtime capability ownership is not closed over the schema.')
    }
    process.stdout.write(
      JSON.stringify(
        {
          ...inventoryModule.CAPABILITY_INVENTORY,
          vfxBindingCount,
          runtimeCapabilityCount: capabilityModule.RUNTIME_CAPABILITY_REGISTRY.length
        },
        null,
        2
      )
    )
  } finally {
    await server.close()
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
