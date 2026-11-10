import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MatchLogRepository } from './match-log-repository'
import { MatchLogTranscript } from './match-log-transcript'
import type { JsonObject } from '../../contracts/ipc/ai'
import type { MatchLogRecord } from '../../contracts/ipc/match-logs'

describe('match log model attribution', () => {
  it.each(['easy', 'expert'])(
    'records %s difficulty, engine revision and resolved resources',
    async (aiDifficulty) => {
      const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
      try {
        const repository = new MatchLogRepository(root)
        await repository.initialize()
        const metadata = {
          aiDifficulty,
          aiResources: { turnBudgetMs: 60_000, planBudgetMs: 30_000 },
          aiEngine: { modelId: 'hardware-local-v2', policyRevision: 'test-policy' }
        }
        const matchId = await repository.start(7, metadata)
        await repository.finish(matchId, 'abandoned')
        const directoryName = (await readdir(root))[0]!
        const summary = JSON.parse(
          await readFile(join(root, directoryName, 'ai.json'), 'utf8')
        )
        expect(summary).toMatchObject(metadata)
        expect(summary).not.toHaveProperty('configuredModel')
        expect(summary).not.toHaveProperty('aiMode')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  it('records the responding model, not the configured API model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      const summaryPath = join(root, directoryName, 'ai.json')
      const started = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(started).toMatchObject({
        model: null,
        configuredModel: 'gpt-5.4-nano'
      })

      await repository.append(matchId, {
        stream: 'decisions',
        kind: 'response-received',
        timestamp: new Date().toISOString(),
        data: { modelId: 'hardware-local-v2' }
      })
      await repository.finish(matchId, 'abandoned')

      const finished = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(finished).toMatchObject({
        model: 'hardware-local-v2',
        modelsUsed: ['hardware-local-v2'],
        configuredModel: 'gpt-5.4-nano'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not claim an AI model when no response was received', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      await repository.finish(matchId, 'abandoned')
      const summary = JSON.parse(
        await readFile(join(root, directoryName, 'ai.json'), 'utf8')
      ) as Record<string, unknown>
      expect(summary).toMatchObject({ model: null, configuredModel: 'gpt-5.4-nano' })
      expect(summary).not.toHaveProperty('modelsUsed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// Gameplay presentation is tested beside persistence so the existing three-file
// contract and AI diagnostics remain covered when the human-readable log changes.
describe('readable match log', () => {
  it('writes the recording time and keeps deck metadata out of the gameplay header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const metadata = {
        curatedOpponent: {
          deckName: 'Test deck',
          classId: 'Mage',
          catalogVersion: 4,
          source: { title: 'Source title', url: 'https://example.com/deck' },
          strategy: { text: 'Verbose strategy text' }
        },
        generatedOpponent: {
          construction: [{ layer: 'curve', selected: 'card', reason: 'reason' }]
        }
      }
      const id = await repository.start(7, metadata)
      await repository.append(id, matchStart)
      await repository.finish(id, 'abandoned')
      const directory = join(root, (await readdir(root))[0]!)
      expect((await readdir(directory)).sort()).toEqual([
        'ai-conversation.txt',
        'ai.json',
        'match.txt'
      ])
      const summary = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8'))
      expect(summary).toMatchObject(metadata)
      const text = await readFile(join(directory, 'match.txt'), 'utf8')
      expect(text).toContain(
        `Started: ${summary.startedAt.replace('T', ' at ').replace('Z', ' UTC')}`
      )
      expect(text).toContain('Local Player (LP): Jaina Proudmoore (Mage)')
      expect(text).toContain('Remote Player (RP): Uther Lightbringer (Paladin)')
      expect(text).toContain('First player: RP')
      expect(text).toContain('Match abandoned before it ended.')
      for (const omitted of [
        'Catalog version',
        'Source title',
        'example.com',
        'Verbose strategy',
        'Opponent deck construction'
      ])
        expect(text).not.toContain(omitted)
      expect(await readFile(join(directory, 'ai-conversation.txt'), 'utf8')).toBe(
        'AI conversation\nA readable view of the context supplied, questions, choices, and results.\nAI explanations are returned explanations, not private internal reasoning.\nPrevious conversation is retained within the configured limits and is not repeated here.\n\n'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps interruption recovery with the same file and AI summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      await repository.start(7, {})
      await new MatchLogRepository(root).initialize()
      const directory = join(root, (await readdir(root))[0]!)
      expect(await readFile(join(directory, 'match.txt'), 'utf8')).toContain(
        'The previous session ended unexpectedly.'
      )
      expect(
        JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8'))
      ).toMatchObject({
        status: 'interrupted',
        recordingIncomplete: true
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('assigns LP/RP by role, not first-player order, and retains both opening hands', () => {
    const transcript = new MatchLogTranscript()
    const text = transcript.format(matchStart)
    expect(text).toBe(
      'Local Player (LP): Jaina Proudmoore (Mage)\n' +
        'Remote Player (RP): Uther Lightbringer (Paladin)\n' +
        'First player: RP\n\nOpening hands\n\n' +
        '- LP: Fireball.\n- RP: Chillwind Yeti.\n'
    )
    expect(
      transcript.format(
        command({
          events: [
            {
              type: 'mulligan-resolved',
              participantId: 'local',
              returnedCards: [{ cardId: 'basic_fireball' }],
              replacementCards: [{ cardId: 'basic_chillwind_yeti' }]
            },
            {
              type: 'mulligan-resolved',
              participantId: 'remote',
              returnedCards: [],
              replacementCards: []
            },
            {
              type: 'coin-granted',
              participantId: 'local',
              card: { instanceId: 'local:coin', cardId: 'basic_the_coin' }
            }
          ]
        })
      )
    ).toContain(
      '- LP replaces Fireball.\n- LP receives Chillwind Yeti.\n- RP keeps all opening cards.\n- LP receives The Coin.'
    )
  })

  it('groups turns and shortens only the active player, without moving end-turn effects', () => {
    const transcript = startedTranscript('remote')
    const text = transcript.format(
      command({
        command: { type: 'end-turn' },
        actor: 'remote',
        players: [{ participantId: 'remote', manaBefore: 1 }],
        events: [
          {
            type: 'card-drawn',
            participantId: 'remote',
            card: { instanceId: 'remote:draw-1', cardId: 'basic_fireball' }
          },
          {
            type: 'turn-started',
            participantId: 'local',
            turnNumber: 2,
            mana: { available: 2, maximum: 3, overloadLocked: 1 }
          },
          {
            type: 'card-drawn',
            participantId: 'local',
            card: { instanceId: 'local:draw-1', cardId: 'basic_chillwind_yeti' }
          },
          {
            type: 'card-drawn',
            participantId: 'remote',
            card: { instanceId: 'remote:draw-2', cardId: 'basic_fireball' }
          }
        ]
      })
    )
    expect(text).toBe(
      '- Ends the turn with 1 mana remaining.\n- Draws Fireball.\n\nTurn 2 - LP\n\nMana: 2/3\n\n- Has 1 mana crystals locked by Overload.\n- Draws Chillwind Yeti.\n- RP draws Fireball.\n'
    )
  })

  it('emits one opening turn heading when the engine supplies both start events', () => {
    const transcript = new MatchLogTranscript()
    transcript.format(matchStart)
    const text = transcript.format(
      command({
        events: [
          {
            type: 'opening-turn-started',
            participantId: 'remote',
            mana: { available: 1, maximum: 1 }
          },
          {
            type: 'turn-started',
            participantId: 'remote',
            turnNumber: 1,
            mana: { available: 1, maximum: 1 }
          }
        ]
      })
    )
    expect(text.match(/Turn 1 - RP/g)).toHaveLength(1)
    expect(text).toContain('Mana: 1/1')
  })

  it('keeps card placement, entry stats, targets, and action failures readable', () => {
    const transcript = startedTranscript('local')
    const played = transcript.format(
      command({
        command: { type: 'play-card', cardInstanceId: 'local:yeti', position: 0 },
        actor: 'local',
        source: { cardId: 'basic_chillwind_yeti', cost: 4 },
        events: [
          {
            type: 'minion-played',
            participantId: 'local',
            position: 0,
            minion: {
              instanceId: 'local:yeti',
              cardId: 'basic_chillwind_yeti',
              attack: 4,
              health: 5
            }
          },
          {
            type: 'minion-summoned',
            participantId: 'local',
            position: 0,
            minion: {
              instanceId: 'local:yeti',
              cardId: 'basic_chillwind_yeti',
              attack: 4,
              health: 5
            }
          }
        ]
      })
    )
    expect(played).toBe(
      '- Plays Chillwind Yeti for 4 mana, in board position 1.\n  - Chillwind Yeti enters with 4 attack and 5 health.\n'
    )
    const rejected = transcript.format(
      command({
        command: {
          type: 'play-card',
          cardInstanceId: 'local:fireball',
          targets: [{ kind: 'hero', participantId: 'remote' }]
        },
        actor: 'local',
        source: { cardId: 'basic_fireball', cost: 4 },
        accepted: false,
        code: 'not-enough-mana'
      })
    )
    expect(rejected).toContain(
      "Attempts to play Fireball for 4 mana, targeting RP's hero."
    )
    expect(rejected).toContain('The action fails because there is not enough mana.')
  })

  it.each([true, false])(
    'records final entry changes without duplicating entry or explicit effects (effect=%s)',
    (withEffect) => {
      const transcript = startedTranscript('local')
      const entry = {
        participantId: 'local',
        position: 0,
        minion: {
          instanceId: 'local:yeti',
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 5
        }
      }
      const text = transcript.format(
        command({
          actor: 'local',
          command: { type: 'play-card', cardInstanceId: 'local:yeti', position: 0 },
          source: { cardId: 'basic_chillwind_yeti', cost: 4 },
          events: [
            { type: 'minion-played', ...entry },
            ...(withEffect
              ? [
                  {
                    type: 'effect-resolved',
                    action: 'modify',
                    data: {
                      target: 'local:yeti',
                      attackBefore: 4,
                      attackAfter: 6,
                      healthBefore: 5,
                      healthAfter: 5
                    }
                  }
                ]
              : []),
            {
              type: 'minion-summoned',
              ...entry,
              minion: { ...entry.minion, attack: 6 }
            }
          ]
        })
      )
      expect(text.match(/enters with/g)).toHaveLength(1)
      expect(text).toContain('enters with 4 attack and 5 health.')
      expect(text.match(/now has/g)).toHaveLength(1)
      expect(text).toContain('now has 6 attack and 5 health.')
    }
  )

  it('keeps combat, duplicate-minion targets, damage, shields, deaths and the explicit winner', () => {
    const transcript = startedTranscript('local')
    const record = command({
      actor: 'local',
      command: {
        type: 'attack-character',
        attacker: { kind: 'minion', instanceId: 'local:yeti' },
        defender: { kind: 'minion', instanceId: 'remote:yeti-2' }
      },
      entities: [
        {
          id: 'local:yeti',
          participantId: 'local',
          cardId: 'basic_chillwind_yeti',
          position: 1
        },
        {
          id: 'remote:yeti-1',
          participantId: 'remote',
          cardId: 'basic_chillwind_yeti',
          position: 1
        },
        {
          id: 'remote:yeti-2',
          participantId: 'remote',
          cardId: 'basic_chillwind_yeti',
          position: 2
        }
      ],
      events: [
        {
          type: 'combat-started',
          combatId: 'combat',
          attacker: {
            participantId: 'local',
            character: { kind: 'minion', instanceId: 'local:yeti' }
          },
          defender: {
            participantId: 'remote',
            character: { kind: 'minion', instanceId: 'remote:yeti-2' }
          }
        },
        {
          type: 'effect-resolved',
          action: 'damage',
          data: { target: 'local:yeti', shieldConsumed: true }
        },
        {
          type: 'effect-resolved',
          action: 'damage',
          data: { target: 'remote:yeti-2', actualDamage: 4, healthAfter: 0 }
        },
        {
          type: 'death-batch-started',
          deaths: [{ kind: 'minion', instanceId: 'remote:yeti-2' }]
        },
        { type: 'match-ended', winnerId: 'local' }
      ]
    })
    const unchanged = structuredClone(record)
    const text = transcript.format(record)
    expect(text).toContain(
      "LP's Chillwind Yeti attacks RP's Chillwind Yeti in position 2."
    )
    expect(text).toContain(
      "LP's Chillwind Yeti's Divine Shield absorbs the damage and is removed."
    )
    expect(text).toContain(
      "RP's Chillwind Yeti in position 2 takes 4 damage and has 0 health remaining."
    )
    expect(text).toContain("RP's Chillwind Yeti in position 2 dies.")
    expect(text).toContain('- LP wins.')
    expect(record).toEqual(unchanged)
  })

  it('keeps fatigue, burns, healing, armor, secrets, transforms, choices and timeout events', () => {
    const transcript = startedTranscript('local')
    const text = transcript.format(
      command({
        actor: 'local',
        command: { type: 'timeout' },
        entities: [
          {
            id: 'remote:yeti',
            participantId: 'remote',
            cardId: 'basic_chillwind_yeti',
            position: 1
          }
        ],
        events: [
          { type: 'fatigue', participantId: 'local', amount: 2 },
          {
            type: 'card-burned',
            participantId: 'local',
            card: { instanceId: 'local:burn', cardId: 'basic_fireball' }
          },
          {
            type: 'character-healed',
            participantId: 'remote',
            character: { kind: 'hero' },
            amount: 3,
            healthAfter: 20
          },
          { type: 'armor-gained', participantId: 'local', amount: 2, armorAfter: 2 },
          {
            type: 'effect-resolved',
            action: 'transform',
            data: { target: 'remote:yeti', cardId: 'basic_sheep' }
          },
          {
            type: 'effect-resolved',
            action: 'reveal',
            controllerId: 'remote',
            data: { participantId: 'remote', cardId: 'classic_counterspell' }
          },
          {
            type: 'discover-started',
            participantId: 'local',
            candidates: [
              { cardId: 'basic_fireball' },
              { cardId: 'basic_chillwind_yeti' }
            ]
          },
          { type: 'match-ended', winnerId: null }
        ]
      })
    )
    for (const expected of [
      "LP's turn timer expires.",
      'The fatigue penalty is 2 damage.',
      'Fireball is burned.',
      "RP's hero restores 3 health and has 20 health remaining.",
      "LP's hero gains 2 armor",
      'transforms into Sheep.',
      'RP reveals Counterspell.',
      "LP's options: Fireball, Chillwind Yeti.",
      'The match ends in a draw.'
    ])
      expect(text).toContain(expected)
    expect(text).not.toContain('undefined')
  })
})

const matchStart: MatchLogRecord = {
  stream: 'events',
  kind: 'match-start',
  timestamp: '2026-11-10T14:50:31.678Z',
  data: {
    participants: [
      { participantId: 'remote', label: 'Remote Player', heroId: 'uther' },
      { participantId: 'local', label: 'Local Player', heroId: 'jaina' }
    ],
    firstPlayerId: 'remote',
    hands: [
      { participantId: 'remote', cards: ['basic_chillwind_yeti'] },
      { participantId: 'local', cards: ['basic_fireball'] }
    ]
  }
}
function command(data: JsonObject): MatchLogRecord {
  return {
    stream: 'events',
    kind: 'command',
    timestamp: matchStart.timestamp,
    data: { command: { type: 'confirm-mulligan' }, ...data }
  }
}
function startedTranscript(owner: string): MatchLogTranscript {
  const transcript = new MatchLogTranscript()
  transcript.format(matchStart)
  transcript.format(
    command({
      events: [
        {
          type: 'turn-started',
          participantId: owner,
          turnNumber: 1,
          mana: { available: 1, maximum: 1 }
        }
      ]
    })
  )
  return transcript
}
