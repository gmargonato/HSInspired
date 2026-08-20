/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'no-game-to-platform-or-renderer',
      severity: 'error',
      from: { path: '^src/game' },
      to: {
        path: '(^src/(main|preload|renderer|shared)|(^|/)(electron|pixi\\.js|node:|fs|path|url|dom))'
      }
    },
    {
      name: 'no-ipc-to-adapters',
      severity: 'error',
      from: { path: '^src/shared/ipc' },
      to: { path: '^src/(main|preload|renderer)' }
    },
    {
      name: 'no-main-to-renderer',
      severity: 'error',
      from: { path: '^src/main' },
      to: { path: '^src/(preload|renderer)' }
    },
    {
      name: 'no-preload-to-implementation',
      severity: 'error',
      from: { path: '^src/preload' },
      to: { path: '^src/(main|renderer|game)' }
    },
    {
      name: 'no-ui-to-higher-layers',
      severity: 'error',
      from: { path: '^src/renderer/src/ui' },
      to: { path: '^src/renderer/src/(features|scenes|app)' }
    },
    {
      name: 'no-rendering-to-workflows',
      severity: 'error',
      from: { path: '^src/renderer/src/rendering' },
      to: { path: '^src/renderer/src/(features|scenes|app)' }
    },
    {
      name: 'no-feature-to-scenes',
      severity: 'error',
      from: { path: '^src/renderer/src/features' },
      to: { path: '^src/renderer/src/scenes' }
    },
    {
      name: 'no-deck-builder-to-collection-internals',
      severity: 'error',
      from: { path: '^src/renderer/src/features/deck-builder' },
      to: { path: '^src/renderer/src/features/collection' }
    },
    {
      name: 'no-collection-to-deck-builder-internals',
      severity: 'error',
      from: { path: '^src/renderer/src/features/collection' },
      to: { path: '^src/renderer/src/features/deck-builder' }
    },
    {
      name: 'no-scene-to-concrete-scene',
      severity: 'error',
      from: { path: '^src/renderer/src/scenes/(?!dev)' },
      to: {
        path: '^src/renderer/src/scenes/(?!transitions|dev)(?:[A-Z][^/]*Scene)\\.ts$'
      }
    },
    {
      name: 'no-production-to-development',
      severity: 'error',
      from: {
        path: '^src/renderer/src/(?!features/dev|scenes/dev|main\\.ts$)'
      },
      to: { path: '^src/renderer/src/(features/dev|scenes/dev)' }
    },
    {
      name: 'no-production-test-imports',
      severity: 'error',
      from: { pathNot: '\\.test\\.ts$' },
      to: { path: '\\.test\\.ts$' }
    },
    {
      name: 'no-unresolved-imports',
      severity: 'error',
      from: { path: '^src', pathNot: '(^|/)env\\.d\\.ts$' },
      to: { couldNotResolve: true }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.test.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']
    },
    exclude: ['(^|/)node_modules/', '(^|/)(dist|out|artifacts|dist-card-lab)/']
  }
}
