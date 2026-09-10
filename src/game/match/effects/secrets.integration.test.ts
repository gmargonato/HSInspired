import { describe, expect, it } from 'vitest'
import { createMatchScenario } from '../testing/match-scenario-builder'

function player(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
) {
  return scenario.match
    .getState()
    .players.find((candidate) => candidate.participantId === participantId)!
}

function setMana(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string
): void {
  expect(
    scenario.match.dispatch({
      type: 'dev-set-mana',
      participantId,
      available: 10,
      maximum: 10
    }).accepted
  ).toBe(true)
}

function addAndPlaySecret(
  scenario: ReturnType<typeof createMatchScenario>,
  participantId: string,
  cardId: string
): void {
  expect(
    scenario.match.dispatch({ type: 'dev-add-card', participantId, cardId }).accepted
  ).toBe(true)
  const secret = player(scenario, participantId).hand.find(
    (card) => card.cardId === cardId
  )
  expect(secret).toBeDefined()
  expect(
    scenario.match.dispatch({
      type: 'play-card',
      participantId,
      cardInstanceId: secret!.instanceId
    }).accepted
  ).toBe(true)
}

function armSecretsForOpponentTurn(
  scenario: ReturnType<typeof createMatchScenario>,
  activePlayerId: string,
  secretController: string,
  cardIds: readonly string[]
): void {
  setMana(scenario, activePlayerId)
  setMana(scenario, secretController)
  expect(
    scenario.match.dispatch({
      type: 'end-turn',
      participantId: activePlayerId
    }).accepted
  ).toBe(true)
  for (const cardId of cardIds) {
    addAndPlaySecret(scenario, secretController, cardId)
  }
  expect(
    scenario.match.dispatch({
      type: 'end-turn',
      participantId: secretController
    }).accepted
  ).toBe(true)
}

describe('Secret runtime', () => {
  it('masks a facedown Secret from its opponent and rejects a duplicate play', () => {
    const scenario = createMatchScenario({ seed: 1300 })
    scenario.confirmBothMulligans()
    const controller = scenario.match.getState().activePlayerId!
    const opponent = scenario.participants.find(
      (participantId) => participantId !== controller
    )!
    setMana(scenario, controller)
    addAndPlaySecret(scenario, controller, 'classic_counterspell')

    const getPublicState = scenario.match.getPublicState
    expect(getPublicState).toBeDefined()
    if (!getPublicState) return
    const ownerView = getPublicState(controller)
    const opponentView = getPublicState(opponent)
    const ownerSecret = ownerView.players.find(
      (candidate) => candidate.participantId === controller
    )!.secrets[0]
    const opponentSecret = opponentView.players.find(
      (candidate) => candidate.participantId === controller
    )!.secrets[0]
    expect(ownerSecret?.cardId).toBe('classic_counterspell')
    expect(opponentSecret?.cardId).toBeNull()

    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: controller,
        cardId: 'classic_counterspell'
      }).accepted
    ).toBe(true)
    const duplicate = player(scenario, controller).hand.find(
      (card) => card.cardId === 'classic_counterspell'
    )!
    const before = scenario.match.getState()
    const rejected = scenario.match.dispatch({
      type: 'play-card',
      participantId: controller,
      cardInstanceId: duplicate.instanceId
    })
    expect(rejected.accepted).toBe(false)
    expect(scenario.match.getState()).toEqual(before)
  })

  it('allows a sixth distinct Secret and consumes its hand card', () => {
    const scenario = createMatchScenario({ seed: 1304 })
    scenario.confirmBothMulligans()
    const controller = scenario.match.getState().activePlayerId!
    const secretIds = [
      'classic_counterspell',
      'classic_ice_barrier',
      'classic_mirror_entity',
      'classic_spellbender',
      'classic_vaporize'
    ]
    for (const cardId of secretIds) {
      setMana(scenario, controller)
      addAndPlaySecret(scenario, controller, cardId)
    }
    expect(player(scenario, controller).secrets).toHaveLength(5)

    setMana(scenario, controller)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: controller,
        cardId: 'classic_ice_block'
      }).accepted
    ).toBe(true)
    const sixth = player(scenario, controller).hand.find(
      (card) => card.cardId === 'classic_ice_block'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: controller,
      cardInstanceId: sixth.instanceId
    })
    expect(result.accepted).toBe(true)
    expect(player(scenario, controller).secrets).toHaveLength(6)
    expect(
      player(scenario, controller).hand.some(
        (card) => card.instanceId === sixth.instanceId
      )
    ).toBe(false)
  })

  it('counters a spell, consumes the Secret, and emits one public reveal', () => {
    const scenario = createMatchScenario({
      seed: 1301,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_counterspell')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const healthBefore = player(scenario, secretController).hero.health
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, secretController).hero.health).toBe(healthBefore)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
    expect(
      result.events.filter(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'reveal' &&
          typeof event.data?.secretId === 'string'
      )
    ).toHaveLength(1)
  })

  it('dispatches on-secret-revealed listeners after a consumed Secret is public', () => {
    const scenario = createMatchScenario({
      seed: 1317,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-add-card',
        participantId: secretController,
        cardId: 'classic_eaglehorn_bow'
      }).accepted
    ).toBe(true)
    const bow = player(scenario, secretController).hand.find(
      (card) => card.cardId === 'classic_eaglehorn_bow'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: secretController,
        cardInstanceId: bow.instanceId
      }).accepted
    ).toBe(true)
    setMana(scenario, secretController)
    addAndPlaySecret(scenario, secretController, 'classic_counterspell')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).weapon).toMatchObject({
      cardId: 'classic_eaglehorn_bow',
      durability: 3
    })
  })

  it('replays a Secret interrupt with identical state, events, and trace', () => {
    const playScenario = () => {
      const scenario = createMatchScenario({
        seed: 1318,
        cardId: 'basic_arcane_shot'
      })
      scenario.confirmBothMulligans()
      const caster = scenario.match.getState().activePlayerId!
      const secretController = scenario.participants.find(
        (participantId) => participantId !== caster
      )!
      armSecretsForOpponentTurn(scenario, caster, secretController, [
        'classic_counterspell'
      ])
      const spell = player(scenario, caster).hand.find(
        (card) => card.cardId === 'basic_arcane_shot'
      )!
      return scenario.match.dispatch({
        type: 'play-card',
        participantId: caster,
        cardInstanceId: spell.instanceId,
        targets: [{ kind: 'hero', participantId: secretController }]
      })
    }

    expect(playScenario()).toEqual(playScenario())
  })

  it('reflects hero damage through Eye for an Eye after the matching damage event', () => {
    const scenario = createMatchScenario({
      seed: 1311,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    armSecretsForOpponentTurn(scenario, caster, secretController, [
      'classic_eye_for_an_eye'
    ])

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const casterHealthBefore = player(scenario, caster).hero.health
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, caster).hero.health).toBe(casterHealthBefore - 2)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('keeps Mirror Entity hidden when the controller board is full', () => {
    const scenario = createMatchScenario({
      seed: 1302,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const minionPlayer = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== minionPlayer
    )!
    setMana(scenario, minionPlayer)
    setMana(scenario, secretController)
    for (let index = 0; index < 7; index += 1) {
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: secretController,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
    }
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: minionPlayer })
        .accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_mirror_entity')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const minion = player(scenario, minionPlayer).hand.find(
      (card) => card.cardId === 'basic_acidic_swamp_ooze'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: minionPlayer,
      cardInstanceId: minion.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).secrets).toHaveLength(1)
    expect(
      result.events.some(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'reveal' &&
          typeof event.data?.secretId === 'string'
      )
    ).toBe(false)
  })

  it('keeps a Secret facedown for a non-matching opposing spell', () => {
    const scenario = createMatchScenario({
      seed: 1308,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_mirror_entity')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).secrets).toHaveLength(1)
    expect(
      result.events.some(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'reveal' &&
          typeof event.data?.secretId === 'string'
      )
    ).toBe(false)
  })

  it('resolves matching Secrets in play order and keeps an invalidated later Secret hidden', () => {
    const scenario = createMatchScenario({
      seed: 1309,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const minionPlayer = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== minionPlayer
    )!
    setMana(scenario, minionPlayer)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: minionPlayer
      }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_snipe')
    addAndPlaySecret(scenario, secretController, 'classic_mirror_entity')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const minion = player(scenario, minionPlayer).hand.find(
      (card) => card.cardId === 'basic_acidic_swamp_ooze'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: minionPlayer,
      cardInstanceId: minion.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(player(scenario, minionPlayer).board).toHaveLength(0)
    const remainingSecrets = player(scenario, secretController).secrets ?? []
    expect(remainingSecrets).toHaveLength(1)
    expect(remainingSecrets[0]?.cardId).toBe('classic_mirror_entity')
    const revealCardIds = result.events.flatMap((event) =>
      event.type === 'effect-resolved' &&
      event.action === 'reveal' &&
      typeof event.data?.secretId === 'string'
        ? [event.data.cardId]
        : []
    )
    expect(revealCardIds).toEqual(['classic_snipe'])
  })

  it('keeps Avenge hidden when its final friendly minion dies', () => {
    const scenario = createMatchScenario({
      seed: 1303,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secretController,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'naxxramas_avenge')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const target = player(scenario, secretController).board[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: secretController,
          instanceId: target.instanceId
        }
      ]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).secrets).toHaveLength(1)
  })

  it("redirects an attack to Noble Sacrifice's defender before combat resolves", () => {
    const scenario = createMatchScenario({ seed: 1310 })
    scenario.confirmBothMulligans()
    const attackerController = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== attackerController
    )!
    setMana(scenario, attackerController)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: attackerController
      }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_noble_sacrifice')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: attackerController,
        cardId: 'basic_stonetusk_boar'
      }).accepted
    ).toBe(true)
    const attacker = player(scenario, attackerController).board[0]!
    const heroHealthBefore = player(scenario, secretController).hero.health

    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: attackerController,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'hero' }
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).hero.health).toBe(heroHealthBefore)
    expect(
      player(scenario, secretController).board.some(
        (minion) => minion.cardId === 'classic_defender'
      )
    ).toBe(false)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('returns an attacking minion and summons Snakes from their matching attack events', () => {
    const scenario = createMatchScenario({ seed: 1312 })
    scenario.confirmBothMulligans()
    const attackerController = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== attackerController
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secretController,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    armSecretsForOpponentTurn(scenario, attackerController, secretController, [
      'classic_freezing_trap',
      'classic_snake_trap'
    ])
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: attackerController,
        cardId: 'basic_stonetusk_boar'
      }).accepted
    ).toBe(true)
    const attacker = player(scenario, attackerController).board[0]!
    const defender = player(scenario, secretController).board[0]!
    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: attackerController,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'minion', instanceId: defender.instanceId }
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, attackerController).board).toHaveLength(0)
    expect(
      player(scenario, attackerController).hand.some(
        (card) => card.instanceId === attacker.instanceId && card.currentCost === 3
      )
    ).toBe(true)
    expect(
      player(scenario, secretController).board.filter(
        (minion) => minion.cardId === 'classic_snake'
      )
    ).toHaveLength(3)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('resurrects and copies a friendly minion when Redemption and Duplicate share its death event', () => {
    const scenario = createMatchScenario({
      seed: 1313,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secretController,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    armSecretsForOpponentTurn(scenario, caster, secretController, [
      'classic_redemption',
      'naxxramas_duplicate'
    ])

    const target = player(scenario, secretController).board[0]!
    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: secretController,
          instanceId: target.instanceId
        }
      ]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).board).toMatchObject([
      { cardId: 'basic_acidic_swamp_ooze', health: 1 }
    ])
    expect(
      player(scenario, secretController).hand.filter(
        (card) => card.cardId === 'basic_acidic_swamp_ooze'
      )
    ).toHaveLength(2)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('reduces a newly played opposing minion to one Health through Repentance', () => {
    const scenario = createMatchScenario({
      seed: 1314,
      cardId: 'basic_acidic_swamp_ooze'
    })
    scenario.confirmBothMulligans()
    const minionPlayer = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== minionPlayer
    )!
    armSecretsForOpponentTurn(scenario, minionPlayer, secretController, [
      'classic_repentance'
    ])

    const minion = player(scenario, minionPlayer).hand.find(
      (card) => card.cardId === 'basic_acidic_swamp_ooze'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: minionPlayer,
      cardInstanceId: minion.instanceId,
      position: 0
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, minionPlayer).board).toMatchObject([
      { cardId: 'basic_acidic_swamp_ooze', health: 1 }
    ])
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('destroys a minion before its hero attack can resolve through Vaporize', () => {
    const scenario = createMatchScenario({
      seed: 1315,
      cardId: 'basic_stonetusk_boar'
    })
    scenario.confirmBothMulligans()
    const attackerController = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== attackerController
    )!
    armSecretsForOpponentTurn(scenario, attackerController, secretController, [
      'classic_vaporize'
    ])
    const minion = player(scenario, attackerController).hand.find(
      (card) => card.cardId === 'basic_stonetusk_boar'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: attackerController,
        cardInstanceId: minion.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const attacker = player(scenario, attackerController).board[0]!
    const heroHealthBefore = player(scenario, secretController).hero.health

    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: attackerController,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'hero' }
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, attackerController).board).toHaveLength(0)
    expect(player(scenario, secretController).hero.health).toBe(heroHealthBefore)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('resolves Explosive Trap and Ice Barrier before hero combat damage', () => {
    const scenario = createMatchScenario({
      seed: 1316,
      cardId: 'basic_stonetusk_boar'
    })
    scenario.confirmBothMulligans()
    const attackerController = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== attackerController
    )!
    armSecretsForOpponentTurn(scenario, attackerController, secretController, [
      'classic_explosive_trap',
      'classic_ice_barrier'
    ])
    const minion = player(scenario, attackerController).hand.find(
      (card) => card.cardId === 'basic_stonetusk_boar'
    )!
    expect(
      scenario.match.dispatch({
        type: 'play-card',
        participantId: attackerController,
        cardInstanceId: minion.instanceId,
        position: 0
      }).accepted
    ).toBe(true)
    const attacker = player(scenario, attackerController).board[0]!
    const heroHealthBefore = player(scenario, secretController).hero.health

    const result = scenario.match.dispatch({
      type: 'attack-character',
      participantId: attackerController,
      attacker: { kind: 'minion', instanceId: attacker.instanceId },
      defender: { kind: 'hero' }
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, attackerController).board).toHaveLength(0)
    expect(player(scenario, secretController).hero.health).toBe(heroHealthBefore)
    expect(player(scenario, secretController).hero.armor).toBe(8)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('redirects a targeted spell through Spellbender before damage resolves', () => {
    const scenario = createMatchScenario({
      seed: 1305,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'dev-summon-minion',
        participantId: secretController,
        cardId: 'basic_acidic_swamp_ooze'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_spellbender')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const spell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const originalTarget = player(scenario, secretController).board[0]!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: spell.instanceId,
      targets: [
        {
          kind: 'minion',
          participantId: secretController,
          instanceId: originalTarget.instanceId
        }
      ]
    })

    expect(result.accepted).toBe(true)
    expect(
      player(scenario, secretController).board.find(
        (minion) => minion.instanceId === originalTarget.instanceId
      )?.health
    ).toBe(2)
    expect(
      player(scenario, secretController).board.find(
        (minion) => minion.cardId === 'classic_spellbender_minion'
      )?.health
    ).toBe(1)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
  })

  it('destroys enemy Secrets without exposing their card identity', () => {
    const scenario = createMatchScenario({
      seed: 1306,
      cardId: 'classic_flare'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_ice_barrier')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const flare = player(scenario, caster).hand.find(
      (card) => card.cardId === 'classic_flare'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: flare.instanceId
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
    expect(
      result.events.some(
        (event) =>
          event.type === 'effect-resolved' &&
          event.action === 'destroy-secrets' &&
          event.data?.count === 1
      )
    ).toBe(true)
  })

  it('ignores nonlethal damage, then prevents lethal damage through Ice Block', () => {
    const scenario = createMatchScenario({
      seed: 1307,
      cardId: 'basic_arcane_shot'
    })
    scenario.confirmBothMulligans()
    const caster = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== caster
    )!
    setMana(scenario, caster)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: secretController,
        health: 3
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: caster }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_ice_block')
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const firstSpell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const nonlethal = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: firstSpell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })
    expect(nonlethal.accepted).toBe(true)
    expect(player(scenario, secretController).hero.health).toBe(1)
    expect(player(scenario, secretController).secrets).toHaveLength(1)

    const lethalSpell = player(scenario, caster).hand.find(
      (card) => card.cardId === 'basic_arcane_shot'
    )!
    const result = scenario.match.dispatch({
      type: 'play-card',
      participantId: caster,
      cardInstanceId: lethalSpell.instanceId,
      targets: [{ kind: 'hero', participantId: secretController }]
    })

    expect(result.accepted).toBe(true)
    expect(player(scenario, secretController).hero.health).toBe(1)
    expect(player(scenario, secretController).secrets).toHaveLength(0)
    expect(result.events.some((event) => event.type === 'match-ended')).toBe(false)
  })

  for (const secretOwnerKind of ['human', 'ai'] as const) {
    it(`expires Ice Block before ${secretOwnerKind === 'human' ? 'local' : 'remote'} owner start-of-turn fatigue`, () => {
      const scenario = createMatchScenario({
        seed: secretOwnerKind === 'human' ? 1308 : 1309,
        cardId: 'basic_arcane_shot'
      })
      scenario.confirmBothMulligans()
      const initialPlayer = scenario.match.getState().activePlayerId!
      const secretController = scenario.match
        .getState()
        .players.find(
          (candidate) => candidate.controllerKind === secretOwnerKind
        )!.participantId
      const attacker = scenario.participants.find(
        (participantId) => participantId !== secretController
      )!

      setMana(scenario, initialPlayer)
      setMana(scenario, attacker)
      setMana(scenario, secretController)
      expect(
        scenario.match.dispatch({
          type: 'dev-summon-minion',
          participantId: attacker,
          cardId: 'basic_acidic_swamp_ooze'
        }).accepted
      ).toBe(true)
      if (initialPlayer !== secretController) {
        expect(
          scenario.match.dispatch({
            type: 'end-turn',
            participantId: initialPlayer
          }).accepted
        ).toBe(true)
      }
      expect(
        scenario.match.dispatch({
          type: 'dev-set-hero',
          participantId: secretController,
          health: 2
        }).accepted
      ).toBe(true)
      addAndPlaySecret(scenario, secretController, 'classic_ice_block')
      expect(
        scenario.match.dispatch({
          type: 'dev-modify-deck',
          participantId: secretController,
          action: 'destroy'
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'dev-set-fatigue',
          participantId: secretController,
          nextDamage: 1
        }).accepted
      ).toBe(true)
      expect(
        scenario.match.dispatch({
          type: 'end-turn',
          participantId: secretController
        }).accepted
      ).toBe(true)

      setMana(scenario, attacker)
      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: attacker,
          cardId: 'basic_arcane_shot'
        }).accepted
      ).toBe(true)
      const lethalSpell = player(scenario, attacker).hand.findLast(
        (card) => card.cardId === 'basic_arcane_shot'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: attacker,
          cardInstanceId: lethalSpell.instanceId,
          targets: [{ kind: 'hero', participantId: secretController }]
        }).accepted
      ).toBe(true)
      expect(player(scenario, secretController).hero).toMatchObject({
        health: 2,
        immune: true
      })
      expect(player(scenario, secretController).secrets).toHaveLength(0)

      const attackingMinion = player(scenario, attacker).board[0]!
      expect(
        scenario.match.getLegality!(attacker).legalAttackTargets[
          attackingMinion.instanceId
        ]?.some((target) => target.kind === 'hero')
      ).toBe(false)
      expect(
        scenario.match.dispatch({
          type: 'attack-character',
          participantId: attacker,
          attacker: { kind: 'minion', instanceId: attackingMinion.instanceId },
          defender: { kind: 'hero' }
        })
      ).toMatchObject({ accepted: false, code: 'invalid-target' })
      expect(player(scenario, attacker).board[0]?.attacksUsedThisTurn ?? 0).toBe(0)

      expect(
        scenario.match.dispatch({
          type: 'dev-add-card',
          participantId: attacker,
          cardId: 'classic_coldlight_oracle'
        }).accepted
      ).toBe(true)
      const oracle = player(scenario, attacker).hand.find(
        (card) => card.cardId === 'classic_coldlight_oracle'
      )!
      expect(
        scenario.match.dispatch({
          type: 'play-card',
          participantId: attacker,
          cardInstanceId: oracle.instanceId,
          position: player(scenario, attacker).board.length
        }).accepted
      ).toBe(true)
      expect(player(scenario, secretController).hero.health).toBe(2)
      expect(player(scenario, secretController).fatigueDamage).toBe(3)

      const transition = scenario.match.dispatch({
        type: 'end-turn',
        participantId: attacker
      })
      expect(transition.accepted).toBe(true)
      expect(player(scenario, secretController).hero).toMatchObject({
        health: 0,
        immune: false
      })
      expect(player(scenario, secretController).fatigueDamage).toBe(4)
      expect(transition.state).toMatchObject({
        phase: 'ended',
        winnerId: attacker,
        loserId: secretController
      })
    })
  }

  it('does not trigger an armed Ice Block for fatal fatigue on its owner turn', () => {
    const scenario = createMatchScenario({ seed: 1310 })
    scenario.confirmBothMulligans()
    const attacker = scenario.match.getState().activePlayerId!
    const secretController = scenario.participants.find(
      (participantId) => participantId !== attacker
    )!
    setMana(scenario, attacker)
    setMana(scenario, secretController)
    expect(
      scenario.match.dispatch({ type: 'end-turn', participantId: attacker }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'dev-set-hero',
        participantId: secretController,
        health: 1
      }).accepted
    ).toBe(true)
    addAndPlaySecret(scenario, secretController, 'classic_ice_block')
    expect(
      scenario.match.dispatch({
        type: 'dev-modify-deck',
        participantId: secretController,
        action: 'destroy'
      }).accepted
    ).toBe(true)
    expect(
      scenario.match.dispatch({
        type: 'end-turn',
        participantId: secretController
      }).accepted
    ).toBe(true)

    const transition = scenario.match.dispatch({
      type: 'end-turn',
      participantId: attacker
    })

    expect(transition.accepted).toBe(true)
    expect(player(scenario, secretController).hero.health).toBe(0)
    expect(player(scenario, secretController).secrets).toHaveLength(1)
    expect(transition.state).toMatchObject({
      phase: 'ended',
      winnerId: attacker,
      loserId: secretController
    })
  })
})
