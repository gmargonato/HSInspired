import { Container, Sprite, type Renderer } from 'pixi.js'
import { gsap } from '../../animation/animations'
import type { Texture } from 'pixi.js'
import type { AnimationScope } from '../../animation/animations'
import {
  type AttackCharacterRef,
  type CharacterCombatantResult,
  type CharacterCombatResolvedEvent,
  type OpeningMatchEvent,
  type OpeningPlayerState,
  type PlayerId
} from '../../../game/match'
import { MinionView } from '../../rendering/minions/minion-view'
import { HeroView } from '../../rendering/heroes/hero-view'
import { WeaponView } from '../../rendering/weapons/weapon-view'
import type { GameAssets } from '../../ui/asset-registry'
import { DamageIndicatorView } from './damage-indicator-view'
import { HealIndicatorView } from './heal-indicator-view'
import { BOARD_TIMING, RESOLUTION_TIMING } from './game-presentation-timing'
import { completeTimeline } from './game-presentation-animation'
import { CombatAttackWarp } from './combat-attack-warp'
import type { BoardPositionController } from './board-position-controller'
import { MATCH_SHADOW_CONFIG } from '../../rendering/shadows/match-shadow-config'

export const COMBAT_ATTACKER_Z_INDEX = 100

/** Intentional pacing for the warp return leg: 1 = base timing, 2 = half speed. */
const WARP_RETURN_SLOWMO = 2
const MINION_DEATH_WIGGLE_ANGLE = 0.075

interface CombatViewPlacement {
  readonly parent: Container
  readonly index: number
  readonly zIndex: number
}

export type CombatView = MinionView | HeroView

interface ActiveCombatPresentation {
  readonly combatId: string
  readonly attacker: CombatView
  readonly defender: CombatView
  readonly attackerOrigin: { readonly x: number; readonly y: number }
  readonly defenderOrigin: { readonly x: number; readonly y: number }
  readonly attackerPlacement: CombatViewPlacement
  readonly attackerAttack: number
  impactStarted: boolean
  attackerReturned: boolean
  screenShake: Promise<void> | null
}

interface DeathGhostTemplate {
  readonly sourceInstanceId: string
  readonly snapshot: {
    readonly texture: Texture
    readonly globalPosition: { readonly x: number; readonly y: number }
    readonly worldScale: number
  }
}

interface CombatPresentationContext {
  findCharacter(
    ownerId: PlayerId,
    character: AttackCharacterRef
  ): CombatView | undefined
  findMinion(ownerId: PlayerId, instanceId: string): MinionView | undefined
  weaponView(ownerId: PlayerId): WeaponView | undefined
  presentedPlayer(ownerId: string): OpeningPlayerState
  removeMinion(view: MinionView): void
  removeWeapon(ownerId: PlayerId, view?: WeaponView): void
  layoutLocalRow(): void
  layoutRemoteRow(): void
  positions: BoardPositionController
  screenShake(attack: number): Promise<void>
  onImpact(): void
  renderer: Renderer
}

/** Owns combat animation state, overlays, death snapshots, and transient indicators.
 * Character views are borrowed from the board and returned to their original layers.
 */
export class GameCombatPresentation {
  readonly layer = new Container()
  readonly indicatorLayer = new Container()
  private readonly activeCombatPresentations = new Map<
    string,
    ActiveCombatPresentation
  >()
  private readonly deathGhostTemplates = new Map<string, DeathGhostTemplate>()
  private readonly deathBatchSources = new Map<string, readonly string[]>()
  private readonly activeDeathGhosts = new Set<Sprite>()
  private readonly combatPreviewMarkers = new Map<CombatView, Sprite>()
  private readonly indicatorSources = new Map<
    DamageIndicatorView | HealIndicatorView,
    CombatView
  >()
  private readonly activeWarps = new Map<MinionView, CombatAttackWarp>()

  constructor(
    private readonly assets: GameAssets,
    private readonly animations: Pick<AnimationScope, 'timeline' | 'cancel'>,
    private readonly context: CombatPresentationContext
  ) {
    // Keep registration stable while Pixi iterates its render callbacks.
    this.indicatorLayer.onRender = this.updateCharacterIndicators
  }

  beginLatestImpact(): void {
    const active = this.latestActiveCombat()
    if (active && !active.impactStarted) {
      active.impactStarted = true
      active.screenShake = this.context.screenShake(active.attackerAttack)
    }
  }

  returnLatestAttacker(): Promise<void> | undefined {
    const active = this.latestActiveCombat()
    if (active) return this.returnActiveCombatAttacker(active)
    return undefined
  }

  captureDeathMarker(
    instanceId: string,
    snapshot: DeathGhostTemplate['snapshot']
  ): void {
    this.deathGhostTemplates.set(instanceId, { sourceInstanceId: instanceId, snapshot })
  }

  dispose(): void {
    this.indicatorLayer.onRender = null
    this.indicatorSources.clear()
    this.clearCombatPreview()
    this.activeCombatPresentations.clear()
    this.deathGhostTemplates.clear()
    this.deathBatchSources.clear()
    for (const warp of this.activeWarps.values()) warp.dispose()
    this.activeWarps.clear()
    for (const ghost of this.activeDeathGhosts) {
      if (!ghost.destroyed) {
        ghost.removeFromParent()
        ghost.destroy({ children: true })
      }
    }
    this.activeDeathGhosts.clear()
    // The board still owns and disposes borrowed character views.
    for (const child of [...this.layer.children]) {
      if (child instanceof MinionView || child instanceof HeroView) {
        child.shadow.minimumHeight = 0
        child.removeFromParent()
      }
    }
    this.layer.destroy({ children: true })
    this.indicatorLayer.destroy({ children: true })
  }

  syncCombatPreviewMarkers(lethalViews: readonly CombatView[]): void {
    const desired = new Set(lethalViews)
    for (const [view, marker] of this.combatPreviewMarkers) {
      if (desired.has(view)) continue
      if (!marker.destroyed) {
        marker.removeFromParent()
        marker.destroy()
      }
      this.combatPreviewMarkers.delete(view)
    }
    for (const view of desired) {
      if (!this.combatPreviewMarkers.has(view)) {
        this.combatPreviewMarkers.set(view, this.createDeathMarker(view))
      }
    }
    this.updateCombatMarkerPositions()
  }

  updateCombatMarkerPositions(): void {
    for (const [view, marker] of this.combatPreviewMarkers) {
      if (view.destroyed || !view.parent || marker.destroyed) {
        if (!marker.destroyed) {
          marker.removeFromParent()
          marker.destroy()
        }
        this.combatPreviewMarkers.delete(view)
        continue
      }
      this.positionDeathMarker(marker, view)
    }
  }

  clearCombatPreview(): void {
    for (const marker of this.combatPreviewMarkers.values()) {
      if (!marker.destroyed) {
        marker.removeFromParent()
        marker.destroy()
      }
    }
    this.combatPreviewMarkers.clear()
  }

  async presentCombatStarted(
    event: Extract<OpeningMatchEvent, { type: 'combat-started' }>
  ): Promise<void> {
    const attacker = this.context.findCharacter(
      event.attacker.participantId,
      event.attacker.character
    )
    const defender = this.context.findCharacter(
      event.defender.participantId,
      event.defender.character
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) return

    if (attacker instanceof HeroView)
      attacker.setTransientImmune(event.attacker.immune === true)
    if (defender instanceof HeroView)
      defender.setTransientImmune(event.defender.immune === true)

    const attackerOrigin = { x: attacker.x, y: attacker.y }
    const defenderOrigin = { x: defender.x, y: defender.y }
    const attackerGlobal = attacker.parent.toGlobal(attacker.position)
    const defenderGlobal = defender.parent.toGlobal(defender.position)
    const attackerPlacement = this.promoteCombatViewForCombat(attacker)
    const active: ActiveCombatPresentation = {
      combatId: event.combatId,
      attacker,
      defender,
      attackerOrigin,
      defenderOrigin,
      attackerPlacement,
      attackerAttack: event.attacker.attack,
      impactStarted: false,
      attackerReturned: false,
      screenShake: null
    }
    this.activeCombatPresentations.set(event.combatId, active)

    const contactGlobal = {
      x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
      y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
    }
    const contact = attacker.parent.toLocal(contactGlobal)
    const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

    try {
      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)
      if (
        this.layer.destroyed ||
        attacker.destroyed ||
        defender.destroyed ||
        !attacker.parent
      )
        return

      const lunge = this.animations.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      await completeTimeline(lunge)
      if (this.layer.destroyed) return
      this.context.onImpact()
    } catch (error) {
      this.activeCombatPresentations.delete(event.combatId)
      this.restoreHeroImmunity(attacker, event.attacker.participantId)
      this.restoreHeroImmunity(defender, event.defender.participantId)
      if (!attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      throw error
    }
  }

  async presentCombatResolved(
    event: Extract<
      OpeningMatchEvent,
      { type: 'minion-combat-resolved' | 'character-combat-resolved' }
    >
  ): Promise<void> {
    const combatId = event.combatId
    const active = combatId ? this.activeCombatPresentations.get(combatId) : undefined
    if (!active) {
      if (event.type === 'minion-combat-resolved') await this.presentMinionCombat(event)
      else await this.presentCharacterCombat(event)
      return
    }
    this.activeCombatPresentations.delete(combatId!)
    const attacker = active.attacker
    const defender = active.defender
    try {
      if (!attacker.destroyed) this.setCombatViewFinalStats(attacker, event.attacker)
      if (!defender.destroyed) this.setCombatViewFinalStats(defender, event.defender)

      if (!active.impactStarted) {
        active.impactStarted = true
        active.screenShake = this.context.screenShake(active.attackerAttack)
        await this.wait(RESOLUTION_TIMING.combatImpactPause)
        if (this.layer.destroyed) return
      }
      const screenShake = active.screenShake ?? Promise.resolve()

      const attackerDestroyed = event.attacker.destroyed
      const defenderDestroyed = event.defender.destroyed
      const settle = (
        view: CombatView,
        origin: { readonly x: number; readonly y: number },
        destroyed: boolean
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        const attackerAlreadyReturned = view === attacker && active.attackerReturned
        if (attackerAlreadyReturned && !destroyed) return Promise.resolve()
        const returningNow = view === attacker && !attackerAlreadyReturned
        if (destroyed && view instanceof MinionView) {
          const destination = returningNow
            ? this.attackerReturnPosition(view, active.attackerPlacement, origin)
            : undefined
          return (async () => {
            if (destination) {
              await this.returnAttackerWithWarp(view, destination, true, () =>
                this.updateCombatMarkerPositions()
              )
            }
            await this.animateMinionDeath(view, BOARD_TIMING.combatDeath, 0.7)
          })()
        }
        if (returningNow && view instanceof MinionView) {
          return this.returnAttackerWithWarp(
            view,
            this.attackerReturnPosition(view, active.attackerPlacement, origin),
            false,
            () => this.updateCombatMarkerPositions()
          )
        }
        const timeline = this.animations.timeline()
        if (returningNow) {
          const destination = this.attackerReturnPosition(
            view,
            active.attackerPlacement,
            origin
          )
          timeline.to(view, {
            x: destination.x,
            y: destination.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
        } else {
          // Returned attackers and stationary defenders already belong to the row.
          timeline.to({}, { duration: BOARD_TIMING.combatReturn })
        }
        timeline.eventCallback('onUpdate', () => {
          this.updateCombatMarkerPositions()
        })
        return completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, active.attackerOrigin, attackerDestroyed),
        settle(defender, active.defenderOrigin, defenderDestroyed),
        screenShake
      ])
      if (this.layer.destroyed) return

      if (attackerDestroyed && attacker instanceof MinionView)
        this.context.removeMinion(attacker)
      else if (active.attackerPlacement && !attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, active.attackerPlacement)
      if (defenderDestroyed && defender instanceof MinionView)
        this.context.removeMinion(defender)
      this.context.layoutLocalRow()
      this.context.layoutRemoteRow()
    } finally {
      this.restoreHeroImmunity(attacker, event.attacker.participantId)
      this.restoreHeroImmunity(defender, event.defender.participantId)
      if (attacker.destroyed) this.context.positions.endMotion(attacker)
      if (!attacker.destroyed)
        this.restoreCombatViewAfterCombat(attacker, active.attackerPlacement)
      this.clearCombatPreview()
    }
  }

  private restoreHeroImmunity(view: CombatView, ownerId: PlayerId): void {
    if (view instanceof HeroView && !view.destroyed) {
      view.setImmune(this.context.presentedPlayer(ownerId).hero.immune === true)
      view.setTransientImmune(false)
    }
  }

  async presentDeathBatchStarted(
    event: Extract<OpeningMatchEvent, { type: 'death-batch-started' }>
  ): Promise<void> {
    this.deathBatchSources.set(
      event.batchId,
      event.deaths.map((death) => death.instanceId)
    )
    const animations: Promise<void>[] = []
    const views = new Map<string, MinionView | WeaponView>()
    for (const death of event.deaths) {
      const view =
        death.kind === 'minion'
          ? this.context.findMinion(death.participantId, death.instanceId)
          : this.context.weaponView(death.participantId)?.instanceId ===
              death.instanceId
            ? this.context.weaponView(death.participantId)
            : undefined
      if (!view || view.destroyed) continue
      if (view instanceof MinionView) view.setCanAttack(false)
      if (death.hasDeathrattle && !this.deathGhostTemplates.has(death.instanceId)) {
        view.setDeathrattle(true)
        const snapshot = view.getAbilityMarkerSnapshot('deathrattle')
        if (snapshot)
          this.deathGhostTemplates.set(death.instanceId, {
            sourceInstanceId: death.instanceId,
            snapshot
          })
      }
      views.set(death.instanceId, view)
      if (view instanceof MinionView) {
        animations.push(
          this.animateMinionDeath(view, RESOLUTION_TIMING.deathCollapse, 0.72)
        )
        continue
      }
      const targetScale = view.scale.x * 0.72
      const timeline = this.animations.timeline()
      timeline.to(view, {
        alpha: 0,
        duration: RESOLUTION_TIMING.deathCollapse,
        ease: 'power2.in'
      })
      timeline.to(
        view.scale,
        {
          x: targetScale,
          y: targetScale,
          duration: RESOLUTION_TIMING.deathCollapse,
          ease: 'power2.in'
        },
        0
      )
      animations.push(completeTimeline(timeline))
    }
    await Promise.all(animations)
    for (const death of event.deaths) {
      const view = views.get(death.instanceId)
      if (view instanceof MinionView) this.context.removeMinion(view)
      else if (view instanceof WeaponView)
        this.context.removeWeapon(death.participantId, view)
    }
  }

  completeDeathBatch(batchId: string): void {
    for (const instanceId of this.deathBatchSources.get(batchId) ?? [])
      this.deathGhostTemplates.delete(instanceId)
    this.deathBatchSources.delete(batchId)
  }

  async presentDeathrattleGhost(
    instanceId: string,
    fallbackSnapshot?: DeathGhostTemplate['snapshot']
  ): Promise<void> {
    const template =
      this.deathGhostTemplates.get(instanceId) ??
      (fallbackSnapshot
        ? { sourceInstanceId: instanceId, snapshot: fallbackSnapshot }
        : undefined)
    // A synthetic Deathrattle activation (for example Feign Death) does not
    // enter a death batch, so there may be no captured marker. Keep the same
    // pacing even when the source view is unavailable.
    if (!template) {
      await this.wait(RESOLUTION_TIMING.deathrattleGhost)
      return
    }
    const ghost = new Sprite(template.snapshot.texture)
    ghost.anchor.set(0.5)
    const local = this.layer.toLocal(template.snapshot.globalPosition)
    ghost.position.set(local.x, local.y)
    ghost.scale.set(template.snapshot.worldScale)
    ghost.alpha = 1
    ghost.zIndex = 1250
    ghost.label = `game.deathrattle.${instanceId}`
    ghost.eventMode = 'none'
    this.layer.addChild(ghost)
    this.activeDeathGhosts.add(ghost)
    const cleanup = (): void => {
      this.activeDeathGhosts.delete(ghost)
      if (!ghost.destroyed) ghost.destroy({ children: true })
    }
    const timeline = this.animations.timeline()
    timeline.to(
      ghost.scale,
      {
        x: template.snapshot.worldScale * 2,
        y: template.snapshot.worldScale * 2,
        duration: RESOLUTION_TIMING.deathrattleGhost,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      ghost,
      {
        alpha: 0,
        duration: RESOLUTION_TIMING.deathrattleGhost,
        ease: 'power2.in'
      },
      0
    )
    try {
      await completeTimeline(timeline)
    } finally {
      cleanup()
    }
  }

  private async presentMinionCombat(
    event: Extract<OpeningMatchEvent, { type: 'minion-combat-resolved' }>
  ): Promise<void> {
    const attacker = this.context.findMinion(
      event.attacker.participantId,
      event.attacker.instanceId
    )
    const defender = this.context.findMinion(
      event.defender.participantId,
      event.defender.instanceId
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) {
      this.clearCombatPreview()
      return
    }

    let attackerPlacement: CombatViewPlacement | null = null
    try {
      const attackerOrigin = { x: attacker.x, y: attacker.y }
      const defenderOrigin = { x: defender.x, y: defender.y }
      const attackerGlobal = attacker.parent.toGlobal(attacker.position)
      const defenderGlobal = defender.parent.toGlobal(defender.position)
      attackerPlacement = this.promoteCombatViewForCombat(attacker)
      const contactGlobal = {
        x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
        y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
      }
      const contact = attacker.parent.toLocal(contactGlobal)
      const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)
      if (
        this.layer.destroyed ||
        attacker.destroyed ||
        defender.destroyed ||
        !attacker.parent
      )
        return

      const lunge = this.animations.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      // Only the attacker moves during the attack wind-up and lunge. The
      // defender remains planted and is updated at impact instead.
      await completeTimeline(lunge)
      if (this.layer.destroyed) return

      this.setCombatViewStats(attacker, event.attacker)
      this.setCombatViewStats(defender, event.defender)
      followDeathMarkers()
      const screenShake = this.context.screenShake(event.attacker.attack)
      this.context.onImpact()
      await this.wait(BOARD_TIMING.combatImpact)
      if (this.layer.destroyed) return

      const attackerDamageTaken = event.attacker.divineShieldConsumed
        ? 0
        : event.attacker.attemptedDamage
      const defenderDamageTaken = event.defender.divineShieldConsumed
        ? 0
        : event.defender.attemptedDamage
      this.showDamageIndicator(attacker, attackerDamageTaken)
      this.showDamageIndicator(defender, defenderDamageTaken)

      const settle = async (
        view: MinionView,
        origin: { x: number; y: number }
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        const destroyed =
          view === attacker ? event.attacker.destroyed : event.defender.destroyed

        if (view === attacker) {
          await this.returnAttackerWithWarp(
            view,
            this.attackerReturnPosition(view, attackerPlacement!, origin),
            destroyed,
            followDeathMarkers
          )
          if (destroyed)
            await this.animateMinionDeath(view, BOARD_TIMING.combatDeath, 0.7)
          return
        }
        if (destroyed) {
          await this.animateMinionDeath(view, BOARD_TIMING.combatDeath, 0.7)
          return
        }
        const timeline = this.animations.timeline()
        timeline.to(view, {
          x: origin.x,
          y: origin.y,
          duration: BOARD_TIMING.combatReturn,
          ease: 'power2.out'
        })
        timeline.eventCallback('onUpdate', followDeathMarkers)
        return completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, attackerOrigin),
        settle(defender, defenderOrigin),
        screenShake
      ])
      if (this.layer.destroyed) return

      if (event.attacker.destroyed) this.context.removeMinion(attacker)
      else if (attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      if (event.defender.destroyed) this.context.removeMinion(defender)
      this.context.layoutLocalRow()
      this.context.layoutRemoteRow()
    } finally {
      if (attacker.destroyed) this.context.positions.endMotion(attacker)
      if (!attacker.destroyed && attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      this.clearCombatPreview()
    }
  }

  private async presentCharacterCombat(
    event: CharacterCombatResolvedEvent
  ): Promise<void> {
    const attacker = this.context.findCharacter(
      event.attacker.participantId,
      event.attacker.character
    )
    const defender = this.context.findCharacter(
      event.defender.participantId,
      event.defender.character
    )
    if (!attacker || !defender || !attacker.parent || !defender.parent) {
      this.clearCombatPreview()
      return
    }

    let attackerPlacement: CombatViewPlacement | null = null
    try {
      const attackerOrigin = { x: attacker.x, y: attacker.y }
      const defenderOrigin = { x: defender.x, y: defender.y }
      const attackerGlobal = attacker.parent.toGlobal(attacker.position)
      const defenderGlobal = defender.parent.toGlobal(defender.position)
      attackerPlacement = this.promoteCombatViewForCombat(attacker)
      const contactGlobal = {
        x: attackerGlobal.x + (defenderGlobal.x - attackerGlobal.x) * 0.62,
        y: attackerGlobal.y + (defenderGlobal.y - attackerGlobal.y) * 0.62
      }
      const contact = attacker.parent.toLocal(contactGlobal)
      const followDeathMarkers = (): void => this.updateCombatMarkerPositions()

      this.updateCombatMarkerPositions()
      await this.wait(BOARD_TIMING.combatWindupPause)
      if (
        this.layer.destroyed ||
        attacker.destroyed ||
        defender.destroyed ||
        !attacker.parent
      )
        return

      const lunge = this.animations.timeline()
      lunge.to(attacker, {
        x: contact.x,
        y: contact.y,
        duration: BOARD_TIMING.combatLunge,
        ease: 'power2.in'
      })
      lunge.eventCallback('onUpdate', followDeathMarkers)
      await completeTimeline(lunge)
      if (this.layer.destroyed) return

      this.setCombatViewStats(attacker, event.attacker)
      this.setCombatViewStats(defender, event.defender)
      followDeathMarkers()
      const screenShake = this.context.screenShake(event.attacker.attack)
      this.context.onImpact()
      await this.wait(BOARD_TIMING.combatImpact)
      if (this.layer.destroyed) return

      const damageTaken = (combatant: CharacterCombatantResult): number =>
        combatant.divineShieldConsumed ? 0 : combatant.attemptedDamage
      this.showDamageIndicator(attacker, damageTaken(event.attacker))
      this.showDamageIndicator(defender, damageTaken(event.defender))

      const settle = async (
        view: CombatView,
        origin: { x: number; y: number },
        destroyed: boolean
      ): Promise<void> => {
        if (view.destroyed) return Promise.resolve()
        // Heroes remain visible at zero Health so the terminal state is clear;
        // attacking minions return home before their death collapse.
        if (view === attacker) {
          const destination = this.attackerReturnPosition(
            view,
            attackerPlacement!,
            origin
          )
          if (view instanceof MinionView) {
            await this.returnAttackerWithWarp(
              view,
              destination,
              destroyed,
              followDeathMarkers
            )
            if (destroyed)
              await this.animateMinionDeath(view, BOARD_TIMING.combatDeath, 0.7)
            return
          }
          const timeline = this.animations.timeline()
          timeline.to(view, {
            x: destination.x,
            y: destination.y,
            duration: BOARD_TIMING.combatReturn,
            ease: 'power2.out'
          })
          timeline.eventCallback('onUpdate', followDeathMarkers)
          await completeTimeline(timeline)
          return
        }
        if (destroyed && view instanceof MinionView) {
          await this.animateMinionDeath(view, BOARD_TIMING.combatDeath, 0.7)
          return
        }
        const timeline = this.animations.timeline()
        timeline.to(view, {
          x: origin.x,
          y: origin.y,
          duration: BOARD_TIMING.combatReturn,
          ease: 'power2.out'
        })
        timeline.eventCallback('onUpdate', followDeathMarkers)
        await completeTimeline(timeline)
      }

      await Promise.all([
        settle(attacker, attackerOrigin, event.attacker.destroyed),
        settle(defender, defenderOrigin, event.defender.destroyed),
        screenShake
      ])
      if (this.layer.destroyed) return

      if (event.attacker.destroyed && attacker instanceof MinionView) {
        this.context.removeMinion(attacker)
      } else if (attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      if (event.defender.destroyed && defender instanceof MinionView) {
        this.context.removeMinion(defender)
      }
      this.context.layoutLocalRow()
      this.context.layoutRemoteRow()
    } finally {
      if (attacker.destroyed) this.context.positions.endMotion(attacker)
      if (!attacker.destroyed && attackerPlacement) {
        this.restoreCombatViewAfterCombat(attacker, attackerPlacement)
      }
      this.clearCombatPreview()
    }
  }

  private createDeathMarker(view: CombatView): Sprite {
    const marker = new Sprite(this.assets.minionWillDie)
    marker.anchor.set(0.5)
    marker.scale.set(0.8)
    this.positionDeathMarker(marker, view)
    marker.zIndex = 1000
    marker.eventMode = 'none'
    const ref = view instanceof HeroView ? 'hero' : (view.instanceId ?? 'unknown')
    marker.label = `game.character.will-die.${ref}`
    this.layer.addChild(marker)
    return marker
  }

  private positionDeathMarker(marker: Sprite, view: CombatView): void {
    const global = view.parent
      ? view.parent.toGlobal(view.position)
      : view.getGlobalPosition()
    const local = this.layer.toLocal(global)
    marker.position.set(local.x, local.y - 15)
  }

  showDamageIndicatorForCharacter(
    ownerId: PlayerId,
    character: AttackCharacterRef,
    amount: number
  ): void {
    const view = this.context.findCharacter(ownerId, character)
    if (view) this.showDamageIndicator(view, amount)
  }

  showHealIndicatorForCharacter(
    ownerId: PlayerId,
    character: AttackCharacterRef,
    amount: number
  ): void {
    const view = this.context.findCharacter(ownerId, character)
    if (view) this.showHealIndicator(view, amount)
  }

  showDamageIndicator(view: CombatView, amount: number): DamageIndicatorView | null {
    if (amount <= 0) return null

    const indicator = new DamageIndicatorView(this.assets.damageIndicator, amount)
    return this.showCharacterIndicator(indicator, view)
  }

  showHealIndicator(view: CombatView, amount: number): HealIndicatorView | null {
    if (amount <= 0) return null

    const indicator = new HealIndicatorView(this.assets.healIndicator, amount)
    return this.showCharacterIndicator(indicator, view)
  }

  private showCharacterIndicator<T extends DamageIndicatorView | HealIndicatorView>(
    indicator: T,
    view: CombatView
  ): T {
    this.positionCharacterIndicator(indicator, view)
    indicator.scale.set(0)
    indicator.zIndex = 1100
    this.indicatorLayer.addChild(indicator)
    this.indicatorSources.set(indicator, view)

    const timeline = this.animations.timeline()
    const finish = (): void => {
      if (!indicator.destroyed) indicator.destroy({ children: true })
    }
    indicator.once('destroyed', () => {
      this.indicatorSources.delete(indicator)
      this.animations.cancel(timeline)
    })
    timeline.to(indicator.scale, {
      x: 1,
      y: 1,
      duration: BOARD_TIMING.characterIndicatorGrow,
      ease: 'back.out(1.7)'
    })
    timeline.to(indicator, {
      alpha: 1,
      duration: BOARD_TIMING.characterIndicatorHold
    })
    timeline.to(indicator, {
      alpha: 0,
      duration: BOARD_TIMING.characterIndicatorFade,
      ease: 'power2.in'
    })
    timeline.eventCallback('onComplete', finish)
    timeline.eventCallback('onInterrupt', finish)
    return indicator
  }

  /** Follow the displayed character, independently of which animation moves it. */
  private readonly updateCharacterIndicators = (): void => {
    const board = this.indicatorLayer.parent
    for (const [indicator, view] of this.indicatorSources) {
      let ancestor: Container | null = view.destroyed ? null : view.parent
      while (ancestor && ancestor !== board) ancestor = ancestor.parent
      if (indicator.destroyed || !board || ancestor !== board) {
        // A removed character leaves its burst at the last displayed position.
        this.indicatorSources.delete(indicator)
        continue
      }
      this.positionCharacterIndicator(indicator, view)
    }
  }

  private positionCharacterIndicator(
    indicator: DamageIndicatorView | HealIndicatorView,
    view: CombatView
  ): void {
    const global = view.parent
      ? view.parent.toGlobal(view.position)
      : view.getGlobalPosition()
    const local = this.indicatorLayer.toLocal(global)
    indicator.position.set(local.x, local.y - (view instanceof HeroView ? 5 : 15))
  }

  private latestActiveCombat(): ActiveCombatPresentation | undefined {
    let latest: ActiveCombatPresentation | undefined
    for (const presentation of this.activeCombatPresentations.values())
      latest = presentation
    return latest
  }

  private async returnActiveCombatAttacker(
    active: ActiveCombatPresentation
  ): Promise<void> {
    const attacker = active.attacker
    if (active.attackerReturned || attacker.destroyed) return

    const destination = this.attackerReturnPosition(
      attacker,
      active.attackerPlacement,
      active.attackerOrigin
    )
    if (attacker instanceof MinionView) {
      await this.returnAttackerWithWarp(attacker, destination, false, () =>
        this.updateCombatMarkerPositions()
      )
    } else {
      const timeline = this.animations.timeline()
      timeline.to(attacker, {
        x: destination.x,
        y: destination.y,
        duration: BOARD_TIMING.combatReturn,
        ease: 'power2.out'
      })
      timeline.eventCallback('onUpdate', () => {
        this.updateCombatMarkerPositions()
      })
      await completeTimeline(timeline)
    }
    active.attackerReturned = true
    if (!attacker.destroyed)
      this.restoreCombatViewAfterCombat(attacker, active.attackerPlacement)
  }

  /** Swaps a returning minion for its perspective warp; null keeps the plain return. */
  private beginReturnWarp(view: MinionView, tiltScale = 1): CombatAttackWarp | null {
    if (view.destroyed || !view.parent || this.activeWarps.has(view)) return null
    try {
      const warp = new CombatAttackWarp(this.context.renderer, view, tiltScale)
      this.activeWarps.set(view, warp)
      return warp
    } catch (error) {
      // A failed snapshot must never break the combat sequence; the attacker
      // simply returns without warping, but the failure must be visible.
      console.warn('[CombatWarp] snapshot failed — plain return fallback', error)
      return null
    }
  }

  private endReturnWarp(view: MinionView, warp: CombatAttackWarp): void {
    if (this.activeWarps.get(view) === warp) this.activeWarps.delete(view)
    warp.dispose()
  }

  /** Runs the attacker's return tween and restores a dying minion on arrival. */
  private async returnAttackerWithWarp(
    view: MinionView,
    destination: { readonly x: number; readonly y: number },
    finishWarpOnLanding: boolean,
    onUpdate: () => void
  ): Promise<void> {
    const timeline = this.animations.timeline()
    const warp = this.beginReturnWarp(view, WARP_RETURN_SLOWMO)
    timeline.to(view, {
      x: destination.x,
      y: destination.y,
      duration: BOARD_TIMING.combatReturn * WARP_RETURN_SLOWMO,
      ease: 'power2.out'
    })
    timeline.eventCallback('onUpdate', onUpdate)
    await completeTimeline(timeline)
    if (warp) {
      if (finishWarpOnLanding) {
        this.endReturnWarp(view, warp)
      } else {
        // Linger briefly after landing so the tilt visibly relaxes before the
        // real minion view is restored.
        gsap.delayedCall(BOARD_TIMING.combatWarpLinger * WARP_RETURN_SLOWMO, () =>
          this.endReturnWarp(view, warp)
        )
      }
    }
  }

  private animateMinionDeath(
    view: MinionView,
    deathDuration: number,
    scaleMultiplier: number
  ): Promise<void> {
    if (view.destroyed) return Promise.resolve()
    const warp = this.activeWarps.get(view)
    if (warp) this.endReturnWarp(view, warp)

    const initialRotation = view.rotation
    const pulseDuration = BOARD_TIMING.minionDeathWiggle / 4
    const angle = MINION_DEATH_WIGGLE_ANGLE
    const timeline = this.animations.timeline()
    timeline
      .to(view, {
        rotation: initialRotation + angle,
        duration: pulseDuration,
        ease: 'sine.inOut'
      })
      .to(view, {
        rotation: initialRotation - angle,
        duration: pulseDuration,
        ease: 'sine.inOut'
      })
      .to(view, {
        rotation: initialRotation + angle * 0.55,
        duration: pulseDuration,
        ease: 'sine.inOut'
      })
      .to(view, {
        rotation: initialRotation,
        duration: pulseDuration,
        ease: 'sine.inOut'
      })
    const deathStart = BOARD_TIMING.minionDeathWiggle
    timeline
      .to(view, { alpha: 0, duration: deathDuration, ease: 'power2.in' }, deathStart)
      .to(
        view.scale,
        {
          x: view.scale.x * scaleMultiplier,
          y: view.scale.y * scaleMultiplier,
          duration: deathDuration,
          ease: 'power2.in'
        },
        deathStart
      )
    timeline.eventCallback('onUpdate', () => this.updateCombatMarkerPositions())
    return completeTimeline(timeline)
  }

  private attackerReturnPosition(
    view: CombatView,
    placement: CombatViewPlacement,
    origin: { readonly x: number; readonly y: number }
  ): { x: number; y: number } {
    // The visible row, not the final match snapshot, owns slots during resolution.
    const resting =
      view instanceof MinionView
        ? this.context.positions.restingPosition(view)
        : undefined
    if (resting) return resting
    return view.parent!.toLocal(placement.parent.toGlobal(origin))
  }

  private setCombatViewStats(
    view: CombatView,
    result: {
      readonly attack: number
      readonly healthAfter: number
      readonly armorAfter?: number
    }
  ): void {
    if (view instanceof HeroView) {
      const player = view.ownerId
        ? this.context.presentedPlayer(view.ownerId)
        : undefined
      view.setStats(
        result.attack,
        result.healthAfter,
        result.armorAfter ?? 0,
        player?.hero.maxHealth ?? result.healthAfter
      )
    } else {
      view.setStats(result.attack, result.healthAfter)
    }
  }

  private setCombatViewFinalStats(
    view: CombatView,
    result: {
      readonly attack: number
      readonly healthAfter: number
      readonly armorAfter?: number
    }
  ): void {
    if (view instanceof HeroView) {
      const ownerId = view.ownerId
      if (ownerId) {
        const player = this.context.presentedPlayer(ownerId)
        view.setHealthAndArmor(
          player.hero.health,
          player.hero.armor,
          player.hero.maxHealth
        )
        return
      }
    } else if (view.ownerId && view.instanceId) {
      const player = this.context.presentedPlayer(view.ownerId)
      const minion = player.board.find(
        (candidate) => candidate.instanceId === view.instanceId
      )
      if (minion) {
        view.setStats(minion.attack, minion.health, minion.maxHealth)
        return
      }
    }
    this.setCombatViewStats(view, result)
  }

  private promoteCombatViewForCombat(view: CombatView): CombatViewPlacement {
    const parent = view.parent
    if (!parent) {
      throw new Error('Cannot promote a combat character without a board parent.')
    }

    const placement = {
      parent,
      index: parent.getChildIndex(view),
      zIndex: view.zIndex
    }
    const global = view.getGlobalPosition()
    this.context.positions.beginMotion(view)
    view.shadow.minimumHeight = MATCH_SHADOW_CONFIG.combatHeight
    this.layer.addChild(view)
    const local = this.layer.toLocal(global)
    view.position.set(local.x, local.y)
    view.zIndex = COMBAT_ATTACKER_Z_INDEX
    return placement
  }

  private restoreCombatViewAfterCombat(
    view: CombatView,
    placement: CombatViewPlacement
  ): void {
    view.shadow.minimumHeight = 0
    if (view.destroyed || view.parent === placement.parent) {
      if (!view.destroyed) view.zIndex = placement.zIndex
      this.context.positions.endMotion(view)
      return
    }

    const global = view.getGlobalPosition()
    placement.parent.addChildAt(
      view,
      Math.min(placement.index, placement.parent.children.length)
    )
    const local = placement.parent.toLocal(global)
    view.position.set(local.x, local.y)
    view.zIndex = placement.zIndex
    this.context.positions.endMotion(view)
  }

  private wait(duration: number): Promise<void> {
    return completeTimeline(this.animations.timeline().to({}, { duration }))
  }
}
