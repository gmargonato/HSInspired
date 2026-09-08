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
        'src/game/match/ai/',
        'src/renderer/features/game/ai-',
        'src/main/services/azure-openai-ai-service',
        'src/main/services/ai-',
        'src/shared/ipc/ai.ts'
      ],
      entryPoints: [
        'src/renderer/features/game/ai-turn-controller.ts',
        'src/game/match/ai/policy-planner.ts'
      ]
    },
    {
      id: 'targeting',
      name: 'Targeting & combat input',
      responsibility:
        'Turns player gestures into valid target, hero power, play, and combat actions.',
      roots: [
        'src/renderer/features/game/target-gesture',
        'src/renderer/features/game/hero-power-targeting',
        'src/renderer/features/game/game-card-targeting',
        'src/renderer/features/game/game-hand-drag',
        'src/renderer/features/game/hand-play-gesture',
        'src/renderer/features/game/hand-drag',
        'src/renderer/features/game/attack-line'
      ],
      entryPoints: [
        'src/renderer/features/game/target-gesture.ts',
        'src/renderer/features/game/hero-power-targeting.ts'
      ]
    },
    {
      id: 'effects-resolution',
      name: 'Card effects & resolution',
      responsibility:
        'Executes card effects, triggers, queues, and reactive rule resolution.',
      roots: ['src/game/match/effects/', 'src/game/content/cards/card-effects.ts'],
      entryPoints: [
        'src/game/match/effects/effect-runtime.ts',
        'src/game/match/effects/resolution-queue.ts'
      ]
    },
    {
      id: 'match-engine',
      name: 'Match engine & state',
      responsibility:
        'Owns deterministic match setup, turns, validation, state transitions, and rule invariants.',
      roots: [
        'src/game/match/rules/',
        'src/game/match/match',
        'src/game/match/turn-match.ts',
        'src/game/match/opening-match',
        'src/game/match/match-setup.ts',
        'src/game/match/contracts.ts',
        'src/game/match/rng.ts'
      ],
      entryPoints: ['src/game/match/match.ts', 'src/game/match/turn-match.ts']
    },
    {
      id: 'card-content',
      name: 'Card content & catalog',
      responsibility:
        'Defines cards, heroes, expansions, capabilities, and immutable catalogs.',
      roots: ['src/game/content/'],
      entryPoints: [
        'src/game/content/cards/index.ts',
        'src/game/content/heroes/index.ts'
      ]
    },
    {
      id: 'game-presentation',
      name: 'Game board presentation',
      responsibility:
        'Presents match state, board interaction feedback, history, HUD, and match results.',
      roots: ['src/renderer/features/game/'],
      entryPoints: [
        'src/renderer/features/game/game-board-view.ts',
        'src/renderer/features/game/game-board-session.ts'
      ]
    },
    {
      id: 'decks-collection',
      name: 'Decks & collection',
      responsibility:
        'Owns deck rules, collection browsing, deck creation, and deck selection.',
      roots: [
        'src/game/decks/',
        'src/renderer/features/collection/',
        'src/renderer/features/deck-builder/',
        'src/renderer/features/deck-selection/',
        'src/renderer/ui/deck-store.ts',
        'src/renderer/app/deck-store.ts'
      ],
      entryPoints: [
        'src/game/decks/deck-validation.ts',
        'src/renderer/features/collection/collection-view.ts'
      ]
    },
    {
      id: 'arena-tavern',
      name: 'Arena & tavern modes',
      responsibility:
        'Implements arena runs and tavern-brawl presentation/model behaviour.',
      roots: [
        'src/game/arena/',
        'src/renderer/features/arena/',
        'src/renderer/features/tavern-brawl/'
      ],
      entryPoints: [
        'src/game/arena/arena.ts',
        'src/renderer/features/arena/arena-view.ts'
      ]
    },
    {
      id: 'navigation-scenes',
      name: 'Navigation & scenes',
      responsibility:
        'Composes routes, creates scenes, and owns full-screen lifecycle transitions.',
      roots: [
        'src/renderer/app/router.ts',
        'src/renderer/app/scene-navigator.ts',
        'src/renderer/scenes/'
      ],
      entryPoints: [
        'src/renderer/app/scene-navigator.ts',
        'src/renderer/scenes/scene-manager.ts'
      ]
    },
    {
      id: 'persistence-ipc',
      name: 'Persistence & IPC',
      responsibility:
        'Bridges renderer contracts to Electron main-process repositories and services.',
      roots: ['src/main/services/', 'src/shared/ipc/', 'src/preload/'],
      entryPoints: ['src/main/services/deck-ipc.ts', 'src/preload/index.ts']
    },
    {
      id: 'rendering-assets',
      name: 'Rendering & assets',
      responsibility:
        'Provides reusable card/board rendering, layout, textures, asset scopes, and UI primitives.',
      roots: [
        'src/renderer/rendering/',
        'src/renderer/ui/asset-registry/',
        'src/renderer/ui/components/'
      ],
      entryPoints: [
        'src/renderer/rendering/cards/card-view.ts',
        'src/renderer/ui/asset-registry/asset-scope.ts'
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
        'Typed navigation constructs a scene, which composes its feature root and requests domain/shared services.',
      steps: [
        'App route',
        'Scene navigator',
        'Scene factory',
        'Feature root',
        'Rendering / UI',
        'Game / shared contracts'
      ]
    }
  ]
}
