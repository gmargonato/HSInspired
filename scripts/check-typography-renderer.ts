import 'pixi.js/unsafe-eval'
import {
  Application,
  Assets,
  Container,
  Rectangle,
  Sprite,
  Text,
  Texture
} from 'pixi.js'
import { ipcRenderer } from 'electron'
import {
  outlinedTextStyle,
  type TextOutline
} from '../src/visual-components/text-style'
import { CardView } from '../src/visual-components/cards/card-view'
import { CARD_PROFILES } from '../src/visual-components/cards/card-layout'
import { CardAssetResolver } from '../src/visual-components/assets/card-asset-resolver'
import { CARD_CATALOG, asCardId } from '../src/game-rules/content/cards'
import { HeroView } from '../src/scenes/match/board/hero-view'
import {
  MinionView,
  type MinionViewTextures
} from '../src/scenes/match/board/minion-view'
import { WeaponView } from '../src/scenes/match/board/weapon-view'
import { HeroPowerView } from '../src/scenes/match/board/hero-power-view'
import { MatchControls3D } from '../src/scenes/match/board/match-controls-3d'
import { DEFAULT_HAND_LAYOUT } from '../src/scenes/match/hand/hand-layout'
import { MINION_LAYOUT } from '../src/scenes/match/board/minion-layout'
import { DAMAGE_INDICATOR_LAYOUT } from '../src/scenes/match/combat/damage-indicator-layout'
import { DECK_SELECTION_LAYOUT } from '../src/scenes/deck-selection/deck-selection-layout'
import { CENTER, placement } from '../src/visual-components/layout'
import { gsap } from '../src/visual-components/animation/animations'
import models from '../assets/models/match/match-controls.json'
import belweUrl from '../assets/fonts/belwe_bold.ttf'
import franklinUrl from '../assets/fonts/franklin_gothic_condensed_thin.otf'
import franklinBoldUrl from '../assets/fonts/franklin_gothic_condensed_bold.otf'

const checks: string[] = []
function check(ok: unknown, message: string): void {
  if (!ok) throw new Error(message)
  checks.push(message)
}
function texts(root: Container): Text[] {
  return [
    ...(root instanceof Text ? [root] : []),
    ...root.children.flatMap((child) => texts(child))
  ]
}
function checkCardNumbers(card: CardView, description: string): void {
  const labels = texts(card).filter(
    (text) => text.label?.includes(':card.stats.') && text.label.endsWith('.label')
  )
  check(
    labels.length > 0 &&
      labels.every((label) => {
        const expected = outlinedTextStyle('card-number', label.style.fontSize)
        const stroke = label.style.stroke as TextOutline
        return (
          stroke.width === expected.stroke.width &&
          stroke.color === expected.stroke.color
        )
      }),
    `${description}: all card numbers use the complete-card preset`
  )
}

async function run() {
  for (const [family, url, weight] of [
    ['Belwe', belweUrl, '700'],
    ['Franklin Gothic Condensed', franklinUrl, '400'],
    ['Franklin Gothic Condensed', franklinBoldUrl, '700']
  ]) {
    document.fonts.add(await new FontFace(family, `url(${url})`, { weight }).load())
  }
  await document.fonts.ready
  const app = new Application()
  await app.init({
    width: 1920,
    height: 1080,
    preference: 'webgl',
    antialias: true,
    background: 0x6f685c
  })
  app.stop()
  const world = new Container()
  app.stage.addChild(world)
  const file = (name: string) => new URL('../../assets/' + name, location.href).href
  const load = (name: string) => Assets.load<Texture>(file(name))
  const background = new Sprite(await load('images/table/board.png'))
  background.width = 1920
  background.height = 1080
  world.addChild(background)
  const caption = (text: string, x: number, y: number, parent = world) => {
    const label = new Text({
      text,
      style: { fontFamily: 'sans-serif', fontSize: 20, fill: 0xffffff }
    })
    label.position.set(x, y)
    parent.addChild(label)
  }
  caption('Production text / shared outlines — board, UI and full cards', 50, 30)
  const art = await load('images/card-artwork/classic_abomination.png')
  const attack = await load('images/board/minion-attack.png')
  const health = await load('images/board/minion-health.png')
  const hero = HeroView.create(
    {
      label: 'typography.hero',
      attack: 2,
      health: 27,
      maxHealth: 30,
      armor: 5,
      frozen: false,
      immune: false
    },
    {
      frame: await load('images/heroes/frames/hero-frame.png'),
      attack,
      health,
      armor: await load('images/cards/armor.png'),
      frozen: Texture.EMPTY,
      immune: Texture.EMPTY
    }
  )
  hero.setHealthVisible(true)
  hero.scale.set(0.55)
  hero.position.set(180, 220)
  world.addChild(hero)
  caption('Hero: health + armor', 60, 350)

  const minionTextures = new Proxy(
    {
      frame: await load('images/board/minion-frame.png'),
      attack,
      health
    },
    {
      get: (target, key: string) => target[key as keyof typeof target] ?? Texture.EMPTY
    }
  ) as MinionViewTextures
  const minion = await MinionView.create(
    {
      label: 'typography.minion',
      attack: 2,
      health: 27,
      maxHealth: 30,
      legendary: false,
      taunt: false,
      enraged: false,
      divineShield: false,
      frozen: false,
      stealth: false,
      deathrattle: false,
      poisonous: false,
      aura: false,
      trigger: false,
      inspire: false,
      windfury: false,
      spellDamage: false,
      lifesteal: false,
      elusive: false,
      immune: false
    },
    minionTextures,
    art
  )
  minion.position.set(420, 230)
  world.addChild(minion)
  caption('Minion stats', 355, 350)
  const resolver = new CardAssetResolver()
  const weaponFrame = await load('images/board/weapon.png')
  const weapon = await WeaponView.create(
    {
      label: 'typography.weapon',
      attack: 2,
      durability: 27,
      printedDurability: 30,
      deathrattle: false,
      trigger: false,
      lifesteal: false,
      poisonous: false
    },
    {
      frame: weaponFrame,
      premiumFrame: weaponFrame,
      cover: Texture.EMPTY,
      premiumCover: Texture.EMPTY,
      trigger: Texture.EMPTY,
      deathrattle: Texture.EMPTY,
      poisonous: Texture.EMPTY,
      lifesteal: Texture.EMPTY,
      attack: await resolver.load('card.stat.weapon-attack'),
      durability: await resolver.load('card.stat.weapon-durability')
    },
    art
  )
  weapon.position.set(660, 245)
  world.addChild(weapon)
  caption('Weapon stats', 590, 350)

  const textures = Object.fromEntries(
    await Promise.all(
      Object.entries(models.textures).map(async ([key, value]) => [
        key,
        await load(value.file)
      ])
    )
  )
  const controls = new MatchControls3D({ ...textures, models } as never)
  const frames = await Promise.all(
    [
      'hero-power-back',
      'premium-hero-power-back',
      'hero-power-front',
      'premium-hero-power-front',
      'hero-power-mana'
    ].map((name) => load('images/heroes/hero-power/' + name + '.png'))
  )
  const powers: HeroPowerView[] = []
  for (const [index, use3d] of [false, true].entries()) {
    const power = new HeroPowerView({
      controls3d: use3d ? controls : undefined,
      layout: {
        card: placement(
          { x: 0, y: 0 },
          { width: 150, height: 150 },
          { anchor: CENTER }
        ),
        crystalOffset: { x: 0, y: -54 },
        costOffset: { x: 0, y: 0 }
      },
      backTexture: frames[0],
      premiumBackTexture: frames[1],
      frontFrameTexture: frames[2],
      premiumFrameTexture: frames[3],
      manaTexture: frames[4],
      artworkTexture: art,
      cost: 2
    })
    power.position.set(910 + index * 230, 245)
    world.addChild(power)
    powers.push(power)
    caption(use3d ? '3D cost' : '2D cost', 870 + index * 230, 350)
  }
  const boardStyle = outlinedTextStyle('number', 30)
  const ratio = boardStyle.stroke.width / boardStyle.fontSize
  for (const [name, root] of [
    ['Hero', hero],
    ['Minion', minion],
    ['Weapon', weapon]
  ] as const) {
    for (const label of texts(root).filter(
      (t) => t.label.includes('stat-') && t.label.endsWith('-value')
    )) {
      check(
        Math.abs(
          (label.style.stroke as TextOutline).width / label.style.fontSize - ratio
        ) < 1e-8,
        `${name}: ${label.label} retains the board outline proportion`
      )
    }
  }
  const healthLabel = hero.getChildByLabel('hero.stat-health-value', true) as Text
  const armorLabel = hero.getChildByLabel('hero.stat-armor-value', true) as Text
  hero.setHealthAndArmor(30, 5, 30)
  check(
    healthLabel.style.fill === 0xffffff && armorLabel.style.fill === 0xffffff,
    'Updating health leaves armor independent'
  )
  hero.setHealthAndArmor(27, 5, 30)
  const healthGroup = hero.getChildByLabel('hero.stat-health')!
  const healthScale = healthGroup.scale.x
  hero.pulseHealth()
  hero.pulseHealth()
  gsap.globalTimeline.progress(1)
  check(
    healthGroup.scale.x === healthScale,
    'Interrupted health pulses restore the authored badge scale'
  )

  const samples = [
    { text: '10/10', style: outlinedTextStyle('number', 30) },
    { text: '2   27   #10   30/30', style: outlinedTextStyle('compact-number', 17) },
    { text: 'Deck and Hand', style: outlinedTextStyle('label', 28) },
    { text: '12', style: DECK_SELECTION_LAYOUT.rankNumberStyle },
    { text: '-27', style: DAMAGE_INDICATOR_LAYOUT.textStyle }
  ]
  samples.forEach((sample, index) => {
    const label = new Text({
      text: sample.text,
      style: { fill: 0xffffff, ...sample.style }
    })
    label.position.set(1360, 115 + index * 45)
    world.addChild(label)
  })
  check(
    outlinedTextStyle('compact-number', 17).stroke.width >= 1,
    'Compact counters retain the approved minimum'
  )
  const specials = [
    ['Rules ink / keyword', 'rules-ink', 0x19130e],
    ['Premium rules ink', 'rules-light-ink', 0xffffff],
    ['Out of cards!', 'fatigue', 0x2b1b12],
    ['Zzz', 'sleep', 0x3cff3c]
  ] as const
  specials.forEach(([text, role, fill], index) => {
    const label = new Text({
      text,
      style: {
        ...outlinedTextStyle(
          role,
          role === 'sleep' ? MINION_LAYOUT.sleepingZ.baseFontSize : 34
        ),
        fill
      }
    })
    label.position.set(60 + index * 440, 410)
    world.addChild(label)
  })

  const cards: CardView[] = []
  let sawReducedFont = false
  let sawScaleFallback = false
  for (const [index, type] of [
    'Minion',
    'Spell',
    'Weapon',
    'Hero',
    'Minion',
    'Spell',
    'Weapon',
    'Hero'
  ].entries()) {
    const base = CARD_CATALOG.all.find((card) => card.type === type)!
    const name =
      index === 4
        ? 'The Ancient Stone Sentinel'
        : index % 4 === 0
          ? 'Stone Sentinel'
          : index % 4 === 1
            ? 'A Very Long Name Beyond the Banner Width'
            : 'An Exceptionally Long Weapon Name With Many More Words'
    const card = await CardView.create({ ...base, name }, resolver, {
      artwork: art,
      premium: index >= 4,
      ignorePremiumOverride: true
    })
    card.setPremiumAppearancePaused(true)
    checkCardNumbers(card, `${type} ${index >= 4 ? 'premium' : 'standard'}`)
    const title = card.getChildByLabel(`${base.id}:card.name`, true)!
    check(!!title, `${type}: production title is present`)
    const profile = CARD_PROFILES[card.plan.template]
    const glyphs = texts(title)
    check(
      glyphs.length > 0 &&
        glyphs.every(
          (glyph) =>
            Math.abs(
              (glyph.style.stroke as TextOutline).width / glyph.style.fontSize - 7 / 47
            ) < 1e-8
        ),
      `${type}: all fitted title glyphs keep their outline proportion`
    )
    sawReducedFont ||= glyphs.some(
      (glyph) =>
        glyph.style.fontSize > 30 && glyph.style.fontSize < profile.name.style.fontSize
    )
    sawScaleFallback ||= glyphs.some(
      (glyph) => glyph.style.fontSize === 30 && glyph.scale.x < 1
    )
    check(
      title.width <= profile.name.text.size.width + 2,
      `${type}: fitted title stays inside its banner width`
    )
    const frame = new Rectangle(0, 0, 620, card.renderedHeight)
    const before = app.renderer.extract.pixels({ target: card, frame, resolution: 1 })
    card.enableTextureCache()
    const after = app.renderer.extract.pixels({ target: card, frame, resolution: 1 })
    check(
      before.pixels.length === after.pixels.length,
      `${type}: caching preserves canvas dimensions`
    )
    let difference = 0
    for (let i = 0; i < before.pixels.length; i++)
      difference += Math.abs(before.pixels[i] - after.pixels[i])
    check(
      difference / before.pixels.length < 2,
      `${type}: cached and live card pixels agree within sampling tolerance`
    )
    card.setManaCost(10)
    card.setManaCostColor('reduced')
    const cost = card.getChildByLabel(`${base.id}:card.stats.mana.label`, true) as Text
    check(
      cost.text === '10' && cost.style.fill === 0x6cff47,
      `${type}: cached cost updates preserve text and tint`
    )
    checkCardNumbers(card, `${type} after caching and cost updates`)
    card.scale.set(0.35)
    card.position.set(50 + index * 235, 540)
    world.addChild(card)
    cards.push(card)
  }
  check(
    sawReducedFont && sawScaleFallback,
    'Title fixtures exercise both font-size reduction and uniform-scale fallback'
  )
  const handSamples = new Container()
  app.stage.addChild(handSamples)
  caption(
    'Complete-card numbers / actual resting and hovered hand scales',
    50,
    30,
    handSamples
  )
  const taskmaster = CARD_CATALOG.require(asCardId('classic_cruel_taskmaster'))
  const taskmasterArt = await load('images/card-artwork/classic_cruel_taskmaster.png')
  for (const premium of [false, true]) {
    const columnX = premium ? 1000 : 50
    caption(premium ? 'Golden' : 'Standard', columnX, 90, handSamples)
    for (const [index, state] of ['resting', 'hovered', 'changed'].entries()) {
      const card = await CardView.create(taskmaster, resolver, {
        artwork: taskmasterArt,
        premium,
        ignorePremiumOverride: true
      })
      card.setPremiumAppearancePaused(true)
      card.enableTextureCache()
      if (state === 'changed') {
        card.applySnapshot(taskmaster, {
          currentCost: 10,
          attack: 27,
          health: 12,
          maxHealth: 30
        })
        const label = (stat: string) =>
          card.getChildByLabel(
            `${taskmaster.id}:card.stats.${stat}.label`,
            true
          ) as Text
        check(
          label('attack').text === '27' &&
            label('attack').style.fill === 0x6cff47 &&
            label('health').text === '12' &&
            label('health').style.fill === 0xff4a4a &&
            label('mana').text === '10',
          `Taskmaster ${premium ? 'golden' : 'standard'}: cached two-digit stats retain their tints`
        )
      }
      card.scale.set(
        state === 'resting'
          ? DEFAULT_HAND_LAYOUT.cardScale
          : DEFAULT_HAND_LAYOUT.hoverScale
      )
      const x = columnX + [0, 180, 530][index]
      card.position.set(x, 200)
      handSamples.addChild(card)
      caption(
        state === 'changed' ? 'Hovered / changed values' : state,
        x,
        155,
        handSamples
      )
      checkCardNumbers(card, `Taskmaster ${premium ? 'golden' : 'standard'} ${state}`)
      cards.push(card)
    }
  }
  gsap.ticker.sleep()
  controls.render()
  for (const [name, scene] of [
    ['typography', world],
    ['hand-numbers', handSamples]
  ] as const) {
    world.visible = scene === world
    handSamples.visible = scene === handSamples
    for (const height of [720, 1080, 1440])
      for (const resolution of [1, 2]) {
        const width = (height * 16) / 9
        app.renderer.resize(width, height, resolution)
        scene.scale.set(height / 1080)
        app.renderer.render(app.stage)
        const canvas = app.renderer.extract.canvas({
          target: app.stage,
          frame: new Rectangle(0, 0, width, height),
          resolution
        })
        check(
          canvas.width === width * resolution && canvas.height === height * resolution,
          `${height}p @${resolution}x: capture has the requested pixel dimensions`
        )
        await ipcRenderer.invoke(
          'image',
          `${name}-${height}p-${resolution}x`,
          canvas.toDataURL()
        )
      }
  }
  cards.forEach((card) => card.destroy({ children: true }))
  powers.forEach((power) => power.dispose())
  controls.dispose()
  app.destroy(true, { children: true })
  return { checks }
}
run()
  .then((result) => ipcRenderer.send('result', result))
  .catch((error) => ipcRenderer.send('result', { checks, error: error.stack }))
