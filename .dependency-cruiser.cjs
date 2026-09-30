/** @type {import('dependency-cruiser').IConfiguration} */
const sceneOwners = [
  'main-menu',
  'collection',
  'deck-selection',
  'arena',
  'tavern-brawl',
  'settings',
  'match'
]
const sceneAdapter = '(?:[a-z0-9-]+-scene|settings-scenes)\\.ts$'

module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'no-game-rules-to-platform-or-presentation',
      severity: 'error',
      from: { path: '^src/game-rules/' },
      to: {
        path: '(^src/(desktop|application|scenes|visual-components|dev-tools)/|(^|/)(electron|pixi\\.js|node:|fs|path|url|dom))'
      }
    },
    {
      name: 'no-ipc-to-adapters',
      severity: 'error',
      from: { path: '^src/desktop/contracts/' },
      to: {
        path: '^src/(desktop/(main|preload)|application|scenes|visual-components|dev-tools)/'
      }
    },
    {
      name: 'no-main-to-renderer',
      severity: 'error',
      from: { path: '^src/desktop/main/' },
      to: {
        path: '^src/(desktop/preload|application|scenes|visual-components|dev-tools)/'
      }
    },
    {
      name: 'no-preload-to-implementation',
      severity: 'error',
      from: { path: '^src/desktop/preload/' },
      to: {
        path: '^src/(desktop/main|application|scenes|visual-components|dev-tools|game-rules)/'
      }
    },
    {
      name: 'no-visual-components-to-implementations',
      severity: 'error',
      from: { path: '^src/visual-components/' },
      to: {
        path: '^src/(scenes|application|dev-tools)/',
        pathNot: '^src/application/contracts/'
      }
    },
    {
      name: 'no-scene-internals-to-app',
      severity: 'error',
      from: {
        path: `^src/scenes/(?:${sceneOwners.join('|')})/`,
        pathNot: sceneAdapter
      },
      to: {
        path: '^src/application/',
        pathNot:
          '^src/application/(contracts/|match-seed\\.ts$|navigation/(?:app-route|game-route|card-preview-route)\\.ts$)'
      }
    },
    {
      name: 'no-view-to-scene-adapter',
      severity: 'error',
      from: {
        path: `^src/scenes/(?:${sceneOwners.join('|')})/`,
        pathNot: sceneAdapter
      },
      to: { path: `^src/scenes/.*${sceneAdapter}` }
    },
    ...sceneOwners.map((owner) => ({
      name: `no-${owner}-to-other-scene-internals`,
      severity: 'error',
      from: { path: `^src/scenes/${owner}/` },
      to: {
        path: `^src/scenes/(?:${sceneOwners.filter((other) => other !== owner).join('|')})/`
      }
    })),
    {
      name: 'no-scene-to-concrete-scene',
      severity: 'error',
      from: { path: '^src/scenes/' },
      to: {
        path: `^src/scenes/.*${sceneAdapter}`
      }
    },
    {
      name: 'no-production-to-development',
      severity: 'error',
      from: {
        path: '^src/(application|scenes|visual-components)/',
        pathNot: '^src/application/main\\.ts$'
      },
      to: { path: '^src/dev-tools/' }
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
    tsConfig: { fileName: 'tsconfig.web.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types']
    },
    exclude: ['(^|/)node_modules/', '(^|/)(dist|out|artifacts|dist-card-lab)/']
  }
}
