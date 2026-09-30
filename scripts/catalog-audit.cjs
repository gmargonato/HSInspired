const { createServer } = require('vite')

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
