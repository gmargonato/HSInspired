import { Container } from 'pixi.js'
import { BASIC_HERO_POWER_UPGRADES } from '../../../../game/content/hero-powers'
import type { OpeningMatchEvent, PlayerId } from '../../../../game/match'
import type { AnimationScope } from '../../../animation/animations'
import type { GameAssets } from '../../../ui/asset-registry'
import type { HeroPowerView } from '../hero-power-view'
import { runScreenShake } from '../screen-shake'
import { WarriorArmorUpEffect } from './warrior-armor-up-effect'
import { WARRIOR_ARMOR_UP } from './warrior-armor-up-layout'
import { WarriorTankUpEffect } from './warrior-tank-up-effect'
import { WARRIOR_TANK_UP } from './warrior-tank-up-layout'
import { PriestHealEffect } from './priest-heal-effect'
import { ShamanTotemEffect } from './shaman-totem-effect'
import { WarlockLifeTapEffect } from './warlock-life-tap-effect'

export type HeroPowerPlaybackRequest = Pick<
  Extract<OpeningMatchEvent, { type: 'hero-power-used' }>,
  'participantId' | 'heroPowerId' | 'target'
>

type EffectFactory = (
  assets: GameAssets,
  animations: Pick<AnimationScope, 'timeline' | 'cancel'>,
  board: Container,
  onShake: (shake: Promise<void>) => void
) => Container & { released: Promise<void>; finished: Promise<void>; dispose(): void }

const EFFECTS = new Map<string, EffectFactory>([
  [
    'shaman-totemic-call',
    (assets, animations) =>
      new ShamanTotemEffect(
        { artwork: assets.summonTotem, spotlight: assets.playSpotlight1 },
        animations
      )
  ],
  [
    'warrior-armor-up',
    (assets, animations, board, onShake) =>
      new WarriorArmorUpEffect(
        {
          swirl: assets.heroPowerAura4,
          rays: [assets.heroPowerAura1, assets.heroPowerAura2, assets.heroPowerAura3]
        },
        animations,
        () => onShake(runScreenShake(board, animations, WARRIOR_ARMOR_UP.shake))
      )
  ],
  [
    'warrior-tank-up',
    (assets, animations, board, onShake) =>
      new WarriorTankUpEffect(
        {
          hammer: assets.tankUpHammer,
          particle: assets.playSpotlight1,
          shockwave: assets.effectCircle1,
          flash: assets.playSpotlight1
        },
        animations,
        () => onShake(runScreenShake(board, animations, WARRIOR_TANK_UP.shake))
      )
  ],
  [
    'warlock-life-tap',
    (assets, animations) =>
      new WarlockLifeTapEffect({ swirl: assets.heroPowerAura4 }, animations)
  ]
])

const START_DURING_FLIP = new Set<string>(['shaman-totemic-call'])

const TARGETING_EFFECTS = new Map<
  string,
  (
    assets: GameAssets,
    animations: Pick<AnimationScope, 'timeline' | 'cancel'>
  ) => PriestHealEffect
>([
  [
    'priest-lesser-heal',
    (assets, animations) =>
      new PriestHealEffect(
        {
          spotlight: assets.playSpotlight5,
          aura: assets.heroPowerAura1
        },
        animations
      )
  ]
])

// Register each animation once; its upgraded power shares the same factory.
// Upgraded powers with an explicit entry above keep their unique effect.
for (const [basicId, upgradedId] of Object.entries(BASIC_HERO_POWER_UPGRADES)) {
  const factory = EFFECTS.get(basicId)
  if (factory && !EFFECTS.has(upgradedId)) EFFECTS.set(upgradedId, factory)
  if (START_DURING_FLIP.has(basicId)) START_DURING_FLIP.add(upgradedId)
  const targeting = TARGETING_EFFECTS.get(basicId)
  if (targeting) TARGETING_EFFECTS.set(upgradedId, targeting)
}

/** The preview and match playback share this availability lookup. */
export function hasHeroPowerEffect(heroPowerId: string): boolean {
  return EFFECTS.has(heroPowerId) || TARGETING_EFFECTS.has(heroPowerId)
}

/** Owns power activation choreography while the board retains outcome handling. */
export class HeroPowerEffectsPresenter {
  readonly layer = new Container()
  private active: ReturnType<EffectFactory> | null = null
  private shake: Promise<void> = Promise.resolve()
  private disposed = false
  private targeting: {
    participantId: PlayerId
    heroPowerId: string
    effect: PriestHealEffect
  } | null = null

  constructor(
    private readonly views: ReadonlyMap<PlayerId, HeroPowerView>,
    private readonly assets: GameAssets,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>,
    private readonly board: Container
  ) {
    this.layer.label = 'game.hero-power-effects'
    this.layer.eventMode = 'none'
    this.layer.interactiveChildren = false
  }

  async reveal(): Promise<void> {
    await Promise.all([...this.views.values()].map((view) => view.flipUp()))
  }

  async refresh(participantId: PlayerId): Promise<void> {
    await this.views.get(participantId)?.flipUp()
  }

  async syncAvailability(participantId: PlayerId, available: boolean): Promise<void> {
    const view = this.views.get(participantId)
    if (!view || view.destroyed) return
    await (available ? view.flipUp() : view.flipDown())
  }

  use(event: Extract<OpeningMatchEvent, { type: 'hero-power-used' }>): Promise<void> {
    return this.play(event)
  }

  startTargeting(participantId: PlayerId, heroPowerId: string): void {
    if (this.disposed) return
    if (
      this.targeting?.participantId === participantId &&
      this.targeting.heroPowerId === heroPowerId
    )
      return
    this.cancelTargeting()
    const view = this.views.get(participantId)
    const factory = TARGETING_EFFECTS.get(heroPowerId)
    if (!view || view.destroyed || !factory) return
    const effect = factory(this.assets, this.animations)
    // A sibling of the flipping face keeps the sunlight circular and behind it.
    effect.position.copyFrom(view.card.position)
    effect.scale.set(view.card.scale.y)
    view.addChildAt(effect, 0)
    this.targeting = { participantId, heroPowerId, effect }
  }

  cancelTargeting(): void {
    this.targeting?.effect.dispose()
    this.targeting = null
  }

  async play(event: HeroPowerPlaybackRequest): Promise<void> {
    await this.finish()
    if (this.disposed) return
    const view = this.views.get(event.participantId)
    if (!view) return
    if (TARGETING_EFFECTS.has(event.heroPowerId)) {
      // Remote powers have no local targeting interaction, so begin on activation.
      this.startTargeting(event.participantId, event.heroPowerId)
      const effect = this.targeting?.effect
      this.targeting = null
      if (!effect) return
      this.active = effect
      await view.flipDown()
      if (this.disposed || view.destroyed) {
        effect.dispose()
        return
      }
      effect.release()
      await effect.released
      return
    }
    const factory = EFFECTS.get(event.heroPowerId)
    if (factory && START_DURING_FLIP.has(event.heroPowerId)) {
      const effect = factory(this.assets, this.animations, this.board, () => undefined)
      effect.position.copyFrom(this.layer.toLocal(view.card.getGlobalPosition()))
      effect.scale.set(1)
      this.layer.addChild(effect)
      this.active = effect
      await view.flipDown()
      if (this.disposed || view.destroyed) {
        effect.dispose()
        return
      }
      await effect.released
      return
    }
    await view.flipDown()
    if (this.disposed || view.destroyed || !factory) return

    const effect = factory(this.assets, this.animations, this.board, (shake) => {
      this.shake = shake
    })
    effect.position.copyFrom(this.layer.toLocal(view.card.getGlobalPosition()))
    effect.scale.set(view.card.scale.y)
    this.layer.addChild(effect)
    this.active = effect
    // Each effect chooses when outcomes resume; the batch waits for its visual tail.
    await effect.released
  }

  async finish(): Promise<void> {
    const active = this.active
    await Promise.all([active?.finished, this.shake])
    if (this.active === active) this.active = null
  }

  dispose(): void {
    this.disposed = true
    this.cancelTargeting()
    this.active?.dispose()
    this.active = null
    this.layer.destroy({ children: true })
  }
}
