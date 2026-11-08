import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match'
import {
  createAiFixture,
  type AiFixtureOptions
} from '../../../game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../game-board-session'
import { aiActions } from './ai-context'
import { LocalAiDecisionApi } from './local-ai-decision-api'

// Exercise the production planner, not a scripted policy. Fixed work avoids hardware timing oracles.
const card = (name: string): string => {
  const result = CARD_CATALOG.all.find((c) => c.name === name)
  if (!result) throw new Error(`Unknown fixture card: ${name}`)
  return result.id
}
const hand = (...names: string[]) => names.map(card)
const minion = (name: string, overrides: Record<string, unknown> = {}) => ({
  cardId: card(name),
  ...overrides
})
const enemy = (count = 3) =>
  Array.from({ length: count }, () => minion('Boulderfist Ogre'))
type Result = Awaited<ReturnType<typeof run>>
async function run(options: Partial<AiFixtureOptions>, seed: number) {
  const f = createAiFixture({
    seed,
    aiHeroId: 'uther',
    opponentHeroId: 'jaina',
    aiMana: 10,
    aiMaximumMana: 10,
    aiHeroPowerAvailable: false,
    aiDeck: hand('Wisp', 'Wisp', 'Wisp', 'Wisp', 'Wisp', 'Wisp'),
    ...options
  })
  const session = new GameBoardSession({
    setup: f.setup,
    decks: f.decks,
    checkpoint: f.checkpoint
  })
  const line: string[] = []
  const plays: string[] = []
  for (let step = 0; step < 18; step++) {
    const state = session.getState()
    if (state.activePlayerId !== f.aiParticipantId || state.phase === 'ended') break
    const actions = aiActions(
      session,
      enumerateLegalCommands(
        {
          getState: session.match.getState,
          getPlayInput: session.match.getPlayInput!,
          getLegality: session.match.getLegality!
        },
        f.aiParticipantId
      )
    )
    const decision = await new LocalAiDecisionApi(session, undefined, {
      workBudget: 128,
      profile: 'expert'
    }).decide({
      matchId: `shortlist-${seed}`,
      requestId: `${seed}-${step}`,
      expectedRevision: state.revision,
      phase: 'action',
      allowInspection: false,
      messages: [],
      actionIds: actions.map((a) => a.id)
    })
    if (!('actionId' in decision.choice)) throw new Error('Expected action choice')
    const id = decision.choice.actionId
    const action = actions.find((a) => a.id === id)!
    expect(action).toBeDefined()
    if (action.command.type === 'play-card') {
      const instanceId = action.command.cardInstanceId
      const held = state.players
        .find((p) => p.participantId === f.aiParticipantId)!
        .hand.find((c) => c.instanceId === instanceId)!
      plays.push(CARD_CATALOG.require(held.cardId).name)
    }
    line.push(action.description)
    const result = session.match.dispatch(action.command)
    expect(result.accepted, JSON.stringify(action.command)).toBe(true)
    if (action.command.type === 'end-turn') break
  }
  const state = session.getState()
  return {
    line,
    plays,
    state,
    me: state.players.find((p) => p.participantId === f.aiParticipantId)!,
    foe: state.players.find((p) => p.participantId === f.localParticipantId)!
  }
}
interface Case {
  name: string
  options: Partial<AiFixtureOptions>
  check?: (r: Result) => void
}
const cases: Case[] = [
  {
    name: 'Dragon Ramp: Nestmatron refunds before spending on Twilight Drake',
    options: {
      aiHeroId: 'malfurion',
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: hand('Desert Nestmatron', 'Twilight Drake', 'Primordial Drake')
    },
    check: (r) =>
      expect(r.plays.slice(0, 2)).toEqual(['Desert Nestmatron', 'Twilight Drake'])
  },
  {
    name: 'Dragon Ramp: diagnostic Whelp versus Faerie with expensive Dragon payoffs',
    options: {
      aiHeroId: 'malfurion',
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: hand(
        'Splish-Splash Whelp',
        'Faerie Dragon',
        'Azure Drake',
        'Emerald Explorer'
      )
    }
    // A future ramp-versus-tempo preference is diagnostic, not a proven lethal oracle.
  },
  {
    name: 'Dragon Ramp: Nourish draws when ramp is capped',
    options: { aiHeroId: 'malfurion', aiHand: hand('Nourish') },
    check: (r) => expect(r.me.hand.length + r.me.board.length).toBeGreaterThanOrEqual(3)
  },
  {
    name: 'Libram: Justice precedes Consecration to clear large threats',
    options: {
      aiHand: hand('Libram of Justice', 'Consecration'),
      opponentBoard: enemy(),
      aiHealth: 12
    },
    check: (r) => {
      expect(r.foe.board).toHaveLength(0)
      expect(r.plays.indexOf('Libram of Justice')).toBeLessThan(
        r.plays.indexOf('Consecration')
      )
    }
  },
  {
    name: 'Libram: Pyromancer precedes Justice for seven-mana reset',
    options: {
      aiMana: 7,
      aiMaximumMana: 7,
      aiHand: hand('Wild Pyromancer', 'Libram of Justice'),
      opponentBoard: enemy(),
      aiHealth: 12
    },
    check: (r) => {
      expect(r.foe.board).toHaveLength(0)
      expect(r.plays.slice(0, 2)).toEqual(['Wild Pyromancer', 'Libram of Justice'])
    }
  },
  {
    name: 'Libram: Attendant discount unlocks Hope stabilization',
    options: {
      aiMana: 9,
      aiMaximumMana: 9,
      aiHealth: 4,
      aiHand: hand('Aldor Attendant', 'Libram of Hope'),
      opponentBoard: enemy(1)
    },
    check: (r) => {
      expect(r.plays.slice(0, 2)).toEqual(['Aldor Attendant', 'Libram of Hope'])
      expect(r.me.hero.health).toBeGreaterThan(4)
    }
  },
  {
    name: 'Showdown: flood discounts Giant before Beam removes enemy tokens',
    options: { aiMana: 10, aiHand: hand('Showdown!', 'Sea Giant', 'Prismatic Beam') },
    check: (r) => {
      expect(r.plays).toContain('Sea Giant')
      expect(r.plays).toContain('Prismatic Beam')
      expect(r.plays.indexOf('Sea Giant')).toBeLessThan(
        r.plays.indexOf('Prismatic Beam')
      )
      expect(r.foe.board).toHaveLength(0)
    }
  },
  {
    name: 'Showdown: Battlemaster converts two ready Giants into lethal',
    options: {
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: hand('Battleground Battlemaster'),
      aiBoard: [
        minion('Sea Giant', { ready: true }),
        minion('Sea Giant', { ready: true })
      ],
      opponentHealth: 30
    },
    check: (r) => expect(r.foe.hero.health).toBeLessThanOrEqual(0)
  },
  {
    name: 'Showdown: Beam clears discounted enemy swarm',
    options: {
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: hand('Prismatic Beam'),
      opponentBoard: Array.from({ length: 4 }, () => minion('Bloodfen Raptor')),
      aiHealth: 9
    },
    check: (r) => expect(r.foe.board).toHaveLength(0)
  },
  {
    name: 'Glowfly: Swarm before Lotus preserves spell count and buffs summons',
    options: {
      aiHeroId: 'malfurion',
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: hand(
        'Glowfly Swarm',
        'Mark of the Lotus',
        'Soul of the Forest',
        'Savage Roar'
      )
    },
    check: (r) => {
      expect(r.plays.slice(0, 2)).toEqual(['Glowfly Swarm', 'Mark of the Lotus'])
      expect(r.me.board.filter((m) => m.attack >= 3)).toHaveLength(3)
    }
  },
  {
    name: 'Beast Swarm: Ingenuity buffs a tutored Beast before developing it',
    options: {
      aiHeroId: 'rexxar',
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: hand("Scavenger's Ingenuity"),
      aiDeck: hand('Springpaw', 'Savannah Highmane')
    },
    check: (r) => {
      expect(r.plays).toContain("Scavenger's Ingenuity")
      expect(
        r.me.board.some((m) => m.attack >= 3) ||
          r.me.hand.some((c) => (c.enchantments?.length ?? 0) > 0)
      ).toBe(true)
    }
  },
  {
    name: 'Secret Burn: Flakmage before Secret clears enemy board',
    options: {
      aiHeroId: 'jaina',
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: hand('Arcane Flakmage', 'Counterspell'),
      opponentBoard: Array.from({ length: 3 }, () => minion('Bloodfen Raptor')),
      aiHealth: 6
    },
    check: (r) => {
      expect(r.plays.slice(0, 2)).toEqual(['Arcane Flakmage', 'Counterspell'])
      expect(r.foe.board).toHaveLength(0)
    }
  },
  {
    name: 'Mech Swarm: Shark before cheap Mechs produces lethal',
    options: {
      aiHeroId: 'jaina',
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: hand('Mecha-Shark', 'Mecharoo', 'Clockwork Gnome'),
      opponentHealth: 6
    },
    check: (r) => expect(r.foe.hero.health).toBeLessThanOrEqual(0)
  },
  {
    name: 'Mech Swarm: Galvanizer discount unlocks both Mechs',
    options: {
      aiHeroId: 'jaina',
      aiMana: 3,
      aiMaximumMana: 3,
      aiHand: hand('Galvanizer', 'Mecharoo', 'Security Automaton')
    },
    check: (r) => expect(r.plays).toHaveLength(3)
  },
  {
    name: 'Handbuff: Smugglers Run buffs Champion into Charge lethal',
    options: {
      aiMana: 5,
      aiMaximumMana: 5,
      aiHand: hand("Smuggler's Run", 'Chillblade Champion'),
      opponentHealth: 4
    },
    check: (r) => expect(r.foe.hero.health).toBeLessThanOrEqual(0)
  },
  {
    name: 'Pirate Oil: weapon attack precedes legacy Flurry lethal',
    options: {
      aiHeroId: 'valeera',
      aiMana: 2,
      aiMaximumMana: 2,
      aiHand: hand('Blade Flurry'),
      aiWeapon: { cardId: card('Shadowblade'), durability: 2 },
      opponentHealth: 6
    },
    check: (r) => expect(r.foe.hero.health).toBeLessThanOrEqual(0)
  },
  {
    name: 'Dragon Priest: activated Duskbreaker resets a lethal enemy board',
    options: {
      aiHeroId: 'anduin',
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: hand('Duskbreaker', 'Azure Drake'),
      opponentBoard: Array.from({ length: 3 }, () => minion('Bloodfen Raptor')),
      aiHealth: 8
    },
    check: (r) => expect(r.foe.board).toHaveLength(0)
  },
  {
    name: 'Skipper Enrage: Inner Rage activates Grommash Charge lethal',
    options: {
      aiHeroId: 'garrosh',
      aiMana: 8,
      aiMaximumMana: 8,
      aiHand: hand('Grommash Hellscream', 'Inner Rage'),
      opponentHealth: 12
    },
    check: (r) => expect(r.foe.hero.health).toBeLessThanOrEqual(0)
  },
  {
    name: 'Elemental Curve: Forgeborn discount unlocks Tar Creeper',
    options: {
      aiHeroId: 'thrall',
      aiMana: 6,
      aiMaximumMana: 6,
      aiHand: hand('Granite Forgeborn', 'Tar Creeper')
    },
    check: (r) =>
      expect(r.plays.slice(0, 2)).toEqual(['Granite Forgeborn', 'Tar Creeper'])
  },
  {
    name: 'Skipper Enrage: Skipper triggers Wrangler to produce a Boom Bot',
    options: {
      aiHeroId: 'garrosh',
      aiMana: 4,
      aiMaximumMana: 4,
      aiHand: hand('Risky Skipper', 'Bomb Wrangler'),
      opponentBoard: [minion('Wisp')]
    },
    check: (r) => {
      expect(r.plays.slice(0, 2)).toEqual(['Risky Skipper', 'Bomb Wrangler'])
      expect(
        r.me.board.some((m) => CARD_CATALOG.require(m.cardId).name === 'Boom Bot')
      ).toBe(true)
    }
  },
  {
    name: 'Secret Burn: avoids Aluneth when its end-turn fatigue is lethal',
    options: {
      aiHeroId: 'jaina',
      aiMana: 6,
      aiMaximumMana: 6,
      aiHealth: 5,
      aiHand: hand('Aluneth'),
      aiDeck: [],
      aiFatigueDamage: 1
    },
    check: (r) => {
      expect(r.plays).not.toContain('Aluneth')
      expect(r.me.hero.health).toBeGreaterThan(0)
    }
  },
  {
    name: 'Cube Demon: Dark Pact Lackey recruits Voidlord to survive',
    options: {
      aiHeroId: 'guldan',
      aiMana: 1,
      aiMaximumMana: 1,
      aiHand: hand('Dark Pact'),
      aiBoard: [minion('Possessed Lackey')],
      aiDeck: hand('Voidlord'),
      aiHealth: 4,
      opponentBoard: enemy(2)
    },
    check: (r) => {
      expect(r.me.board.some((m) => m.cardId === card('Voidlord'))).toBe(true)
      expect(r.me.hero.health).toBeGreaterThan(4)
    }
  },
  {
    name: 'Dragon Ramp: Golem counts Dragons before cheap activator is spent',
    options: {
      aiHeroId: 'malfurion',
      aiMana: 9,
      aiMaximumMana: 9,
      aiHand: hand('Dragon Golem', 'Faerie Dragon', 'Azure Drake')
    },
    check: (r) => {
      expect(r.plays[0]).toBe('Dragon Golem')
      expect(
        r.me.board.filter((m) => CARD_CATALOG.require(m.cardId).name === 'Dragon Golem')
      ).toHaveLength(3)
    }
  }
]

describe('shortlisted decks: production planner strategy probes', () => {
  cases.forEach((c, index) =>
    it(
      c.name,
      async () => {
        const result = await run(c.options, 0x5700 + index)
        console.log(
          JSON.stringify({
            scenario: c.name,
            seed: 0x5700 + index,
            line: result.line,
            plays: result.plays,
            aiHealth: result.me.hero.health,
            enemyHealth: result.foe.hero.health,
            aiBoard: result.me.board.map((m) => ({
              name: CARD_CATALOG.require(m.cardId).name,
              attack: m.attack,
              health: m.health
            })),
            enemyBoard: result.foe.board.length
          })
        )
        c.check?.(result)
      },
      120_000
    )
  )
})
