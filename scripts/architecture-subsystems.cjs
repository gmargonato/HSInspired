/**
 * Semantic architecture registry for the visual atlas.
 *
 * Order matters: specialised roots intentionally appear before their broader
 * presentation and platform counterparts.
 */
module.exports = {
  subsystems: [
    {
      id: 'ai-decisioning',
      name: 'AI decisioning',
      responsibility:
        'Builds fair observations and legal turn policies for one remote strategy choice.',
      roots: [
        'src/game-rules/match/ai/',
        'src/scenes/match/ai/',
        'src/desktop/main/services/azure-openai-ai-service',
        'src/desktop/main/services/ai-',
        'src/desktop/contracts/ipc/ai.ts'
      ],
      entryPoints: [
        'src/scenes/match/ai/ai-turn-controller.ts',
        'src/game-rules/match/ai/policy-planner.ts'
      ]
    },
    {
      id: 'targeting',
      name: 'Targeting & combat input',
      responsibility:
        'Turns player gestures into valid target, hero power, play, and combat actions.',
      roots: [
        'src/scenes/match/targeting/',
        'src/scenes/match/hand/game-hand-drag',
        'src/scenes/match/hand/hand-play-gesture',
        'src/scenes/match/hand/hand-drag'
      ],
      entryPoints: [
        'src/scenes/match/targeting/target-gesture.ts',
        'src/scenes/match/targeting/hero-power-targeting.ts'
      ]
    },
    {
      id: 'effects-resolution',
      name: 'Card effects & resolution',
      responsibility:
        'Executes card effects, triggers, queues, and reactive rule resolution.',
      roots: [
        'src/game-rules/match/effects/',
        'src/game-rules/content/cards/card-effects.ts'
      ],
      entryPoints: [
        'src/game-rules/match/effects/effect-runtime.ts',
        'src/game-rules/match/effects/resolution-queue.ts'
      ]
    },
    {
      id: 'match-engine',
      name: 'Match engine & state',
      responsibility:
        'Owns deterministic match setup, turns, validation, state transitions, and rule invariants.',
      roots: [
        'src/game-rules/match/rules/',
        'src/game-rules/match/match',
        'src/game-rules/match/turn-match.ts',
        'src/game-rules/match/opening-match',
        'src/game-rules/match/match-setup.ts',
        'src/game-rules/match/contracts.ts',
        'src/game-rules/match/rng.ts'
      ],
      entryPoints: [
        'src/game-rules/match/match.ts',
        'src/game-rules/match/turn-match.ts'
      ]
    },
    {
      id: 'card-content',
      name: 'Card content & catalog',
      responsibility:
        'Defines cards, heroes, expansions, capabilities, and immutable catalogs.',
      roots: ['src/game-rules/content/'],
      entryPoints: [
        'src/game-rules/content/cards/index.ts',
        'src/game-rules/content/heroes/index.ts'
      ]
    },
    {
      id: 'game-presentation',
      name: 'Game board presentation',
      responsibility:
        'Presents match state, board interaction feedback, history, HUD, and match results.',
      roots: ['src/scenes/match/'],
      entryPoints: [
        'src/scenes/match/board/game-board-view.ts',
        'src/scenes/match/game-board-session.ts'
      ]
    },
    {
      id: 'decks-collection',
      name: 'Decks & collection',
      responsibility:
        'Owns deck rules, collection browsing, deck creation, and deck selection.',
      roots: [
        'src/game-rules/decks/',
        'src/scenes/collection/',
        'src/scenes/deck-selection/',
        'src/visual-components/controls/deck-entry-button.ts',
        'src/application/contracts/deck-store.ts',
        'src/application/deck-store.ts'
      ],
      entryPoints: [
        'src/game-rules/decks/deck-validation.ts',
        'src/scenes/collection/collection-view.ts'
      ]
    },
    {
      id: 'arena-tavern',
      name: 'Arena & tavern modes',
      responsibility:
        'Implements arena runs and tavern-brawl presentation/model behaviour.',
      roots: ['src/game-rules/arena/', 'src/scenes/arena/', 'src/scenes/tavern-brawl/'],
      entryPoints: ['src/game-rules/arena/arena.ts', 'src/scenes/arena/arena-view.ts']
    },
    {
      id: 'navigation-scenes',
      name: 'Navigation & scenes',
      responsibility:
        'Composes routes, creates scenes, and owns full-screen lifecycle transitions.',
      roots: [
        'src/application/navigation/router.ts',
        'src/application/navigation/scene-navigator.ts',
        'src/application/navigation/scene-manager.ts',
        'src/application/navigation/',
        'src/visual-components/lifecycle/scene.ts',
        'src/application/contracts/scene-manager-port.ts',
        'src/application/match-seed.ts'
      ],
      entryPoints: [
        'src/application/navigation/scene-navigator.ts',
        'src/application/navigation/scene-manager.ts'
      ]
    },
    {
      id: 'menu-presentation',
      name: 'Menu screens & overlays',
      responsibility: 'Owns main-menu and settings scene presentation.',
      roots: ['src/scenes/main-menu/', 'src/scenes/settings/'],
      entryPoints: [
        'src/scenes/main-menu/main-menu-scene.ts',
        'src/scenes/settings/settings-scenes.ts'
      ]
    },
    {
      id: 'development-tools',
      name: 'Development tools',
      responsibility:
        'Owns standalone inspectors, labs, and guarded development runtime adapters.',
      roots: ['src/dev-tools/'],
      entryPoints: ['src/dev-tools/card-inspector/card-inspector-scene.ts']
    },
    {
      id: 'application-services',
      name: 'Application services',
      responsibility:
        'Composes renderer services and startup around injected persistence/navigation contracts.',
      roots: [
        'src/application/',
        'src/application/main.ts',
        'src/application/env.d.ts',
        'src/application/contracts/'
      ],
      entryPoints: ['src/application/main.ts', 'src/application/services.ts']
    },
    {
      id: 'persistence-ipc',
      name: 'Persistence & IPC',
      responsibility:
        'Bridges renderer contracts to Electron main-process repositories and services.',
      roots: ['src/desktop/main/', 'src/desktop/contracts/', 'src/desktop/preload/'],
      entryPoints: [
        'src/desktop/main/services/deck-ipc.ts',
        'src/desktop/preload/index.ts'
      ]
    },
    {
      id: 'rendering-assets',
      name: 'Rendering & assets',
      responsibility:
        'Provides reusable card/board rendering, layout, textures, asset scopes, and UI primitives.',
      roots: [
        'src/visual-components/cards/',
        'src/visual-components/assets/',
        'src/visual-components/controls/',
        'src/visual-components/effects/',
        'src/visual-components/layout/',
        'src/visual-components/animation/',
        'src/visual-components/lifecycle/',
        'src/visual-components/transitions/'
      ],
      entryPoints: [
        'src/visual-components/cards/card-view.ts',
        'src/visual-components/assets/asset-scope.ts'
      ]
    }
  ],
  flows: [
    {
      id: 'player-targeting',
      name: 'Player targeting',
      description:
        'A player gesture is converted into a legal target action, resolved by match rules, then reflected in presentation.',
      steps: [
        'Target gesture',
        'Targeting controller',
        'Game board session',
        'Match validation',
        'Effects / state',
        'Board presentation'
      ]
    },
    {
      id: 'ai-turn',
      name: 'AI turn execution',
      description:
        'The renderer starts an AI turn; the engine enumerates legal policies and the remote strategy chooses one for execution.',
      steps: [
        'AI turn controller',
        'Fair observation',
        'Engine-verified policies',
        'Legal commands',
        'Match engine',
        'Board presentation'
      ]
    },
    {
      id: 'route-to-scene',
      name: 'Route to scene',
      description:
        'Typed navigation constructs a scene, which composes local views/controllers and requests domain/shared services.',
      steps: [
        'App route',
        'Scene navigator',
        'Scene factory',
        'Scene-local views / controllers',
        'Shared presentation',
        'Game / shared contracts'
      ]
    }
  ]
}
