import 'pixi.js/unsafe-eval'
import * as THREE from 'three'
import { Application, Assets, Sprite, Texture } from 'pixi.js'
import { ipcRenderer } from 'electron'
import { MatchControls3D } from '../src/scenes/match/board/match-controls-3d'
import { EndTurnControl } from '../src/scenes/match/hud/end-turn-control'
import { GameHudView } from '../src/scenes/match/hud/game-hud-view'
import { CardAssetResolver } from '../src/visual-components/assets/card-asset-resolver'
import { HeroPowerView } from '../src/scenes/match/board/hero-power-view'
import { CENTER, placement } from '../src/visual-components/layout'
import { AnimationScope, gsap } from '../src/visual-components/animation/animations'
import data from '../assets/models/match/match-controls.json'
import { HERO_POWER_ASSET_SOURCES } from '../src/visual-components/assets/hero-power-assets'
import boardUrl from '../assets/images/table/board.png'
import fontUrl from '../assets/fonts/belwe_bold.ttf'
import endTurnUrl from '../assets/images/match/button-end-my-turn.png'

const checks: string[] = []
const calibration: { expected: number[]; actual: number[] }[] = []
function check(ok: unknown, message: string): void {
  if (!ok) throw Error(message)
  checks.push(message)
}
async function run() {
  const app = new Application()
  await app.init({
    width: 1280,
    height: 720,
    preference: 'webgl',
    background: 0x202030
  })
  document.body.append(app.canvas)
  const font = new FontFace('Belwe', `url(${fontUrl})`)
  document.fonts.add(await font.load())
  const root = new URL('../../', location.href)
  // Captures live under .tmp/match-controls-check; assets are repository-local.
  const file = (p: string) => new URL(p, root).href
  const textures = Object.fromEntries(
    await Promise.all(
      Object.entries(data.textures).map(async ([name, t]) => [
        name,
        await Assets.load(file('assets/' + t.file))
      ])
    )
  )
  const art = await Assets.load(HERO_POWER_ASSET_SOURCES['hero-power-mage'])
  const assets = { ...textures, models: data }
  const renderer = new MatchControls3D(assets as never)
  renderer.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(
      [
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertex),
        gl.getShaderInfoLog(fragment)
      ].join('\n')
    )
  }
  // Unlit known colors exercise the actual Three canvas -> Pixi texture path.
  // This separates transfer/gamma errors from the mesh's lighting response.
  const probe = renderer.create('heroPower', art)
  probe.scene.clear()
  const swatches = [
    [32, 32, 32],
    [64, 64, 64],
    [128, 128, 128],
    [192, 192, 192],
    [255, 255, 255],
    [180, 80, 40],
    [40, 180, 80],
    [80, 40, 180]
  ]
  const chart = document.createElement('canvas')
  chart.width = 256
  chart.height = 256
  const chartContext = chart.getContext('2d')!
  swatches.forEach((rgb, i) => {
    chartContext.fillStyle = `rgb(${rgb.join(',')})`
    chartContext.fillRect(i * 32, 0, 32, 256)
  })
  const chartTexture = new THREE.CanvasTexture(chart)
  chartTexture.colorSpace = THREE.SRGBColorSpace
  const chartGeometry = new THREE.PlaneGeometry(2.56, 2.56)
  const chartMaterial = new THREE.MeshBasicMaterial({ map: chartTexture })
  const chartMesh = new THREE.Mesh(chartGeometry, chartMaterial)
  chartMesh.rotation.x = -Math.PI / 2
  probe.scene.add(chartMesh)
  app.stage.addChild(probe)
  renderer.render()
  const pixels = app.renderer.extract.pixels({ target: probe, resolution: 1 })
  swatches.forEach((expected, i) => {
    const offset = (128 * pixels.width + i * 32 + 16) * 4
    const actual = Array.from(pixels.pixels.slice(offset, offset + 3))
    calibration.push({ expected, actual })
    check(
      actual.every((v, j) => Math.abs(v - expected[j]) <= 2),
      `sRGB transfer preserves ${expected.join('/')}`
    )
  })
  probe.dispose()
  chartTexture.dispose()
  chartGeometry.dispose()
  chartMaterial.dispose()
  const board = new Sprite(await Assets.load(boardUrl))
  board.width = 1280
  board.height = 720
  app.stage.addChild(board)
  const names = [
    'hero-power-back',
    'premium-hero-power-back',
    'hero-power-front',
    'premium-hero-power-front',
    'hero-power-mana'
  ]
  const frames = await Promise.all(
    names.map((n) => Assets.load(file('assets/images/heroes/hero-power/' + n + '.png')))
  )
  const powers = [false, true].map((premium, i) => {
    const power = new HeroPowerView({
      controls3d: renderer,
      layout: {
        card: placement(
          { x: 0, y: 0 },
          { width: 150, height: 150 },
          { anchor: CENTER }
        ),
        crystalOffset: { x: 0, y: -65 },
        costOffset: { x: 0, y: 0 }
      },
      backTexture: frames[0],
      premiumBackTexture: frames[1],
      frontFrameTexture: frames[2],
      premiumFrameTexture: frames[3],
      manaTexture: frames[4],
      artworkTexture: art,
      cost: 2,
      premium
    })
    power.position.set(540 + i * 220, 500)
    app.stage.addChild(power)
    return power
  })
  let clicks = 0
  const endTexture = await Assets.load(endTurnUrl)
  const animations = new AnimationScope()
  const hud = new GameHudView(new CardAssetResolver(), animations)
  hud.mount(
    {
      endTurn: endTexture,
      manaAvailable: Texture.WHITE,
      manaSpent: Texture.WHITE,
      manaGlow: Texture.WHITE,
      manaOverload: Texture.WHITE,
      deckInfo: Texture.WHITE
    },
    () => {
      clicks++
      hud.syncEndTurnButton(endTexture, false, false, 'enemyTurn')
    },
    endTexture,
    renderer
  )
  const end = hud.endTurnButton as EndTurnControl
  hud.turnButtonLayer.position.set(-535, -162)
  app.stage.addChild(hud.turnButtonLayer)
  hud.syncEndTurnButton(endTexture, true, false)
  const tick = (_time: number, delta: number) => renderer.render(delta)
  gsap.ticker.add(tick)
  const capture = async (name: string) => {
    renderer.render()
    app.renderer.render(app.stage)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await ipcRenderer.invoke('capture', name)
  }
  const finish = async (promise: Promise<unknown>) => {
    for (let i = 0; i < 15; i++) {
      gsap.globalTimeline.time(gsap.globalTimeline.time() + 0.2, false)
      await Promise.resolve()
    }
    return promise
  }
  const outline = (color: 'green' | 'white') =>
    hud.turnButtonLayer.children.find(
      (child) =>
        child.label ===
        `game.end-turn-${color === 'green' ? 'exhausted' : 'hover'}-outline-target`
    )!
  const noOutlines = () => !outline('green').visible && !outline('white').visible
  hud.syncEndTurnButton(endTexture, true, true)
  powers.forEach((p) => p.setEnabled(true))
  powers.forEach((p) => p.prebuildOutlines(app.renderer))
  // Let composed contour snapshots prepare outside the active filter pass.
  await capture('outline-green')
  await capture('outline-green')
  check(
    outline('green').visible && !outline('white').visible,
    'Exhausted turn shows green'
  )
  end.emit('pointerover', {})
  powers.forEach((p) => p.setHoverAura(true))
  await capture('outline-white')
  await capture('outline-white')
  end.emit('pointerdown', { button: 2 })
  check(outline('white').visible, 'Right press preserves hover outline')
  end.emit('pointertap', { button: 2 })
  check(clicks === 0, 'Right click never ends the turn')
  end.emit('pointerdown', { button: 0 })
  check(noOutlines(), 'Both outlines hide synchronously on press')
  await finish(Promise.resolve())
  check(noOutlines(), 'Outlines remain hidden through a prolonged hold')
  await capture('outline-held')
  end.emit('pointerout', {})
  await Promise.resolve()
  check(noOutlines(), 'Leaving while held does not restore outlines')
  end.emit('pointerover', {})
  check(noOutlines(), 'Re-entering while held does not restore outlines')
  end.emit('pointerout', {})
  end.emit('pointerupoutside', { button: 0 })
  await Promise.resolve()
  check(
    outline('green').visible && !outline('white').visible && clicks === 0,
    'Outside release restores green without submitting'
  )
  end.emit('pointerover', {})
  end.emit('pointerdown', { button: 0 })
  end.emit('pointercancel', {})
  await Promise.resolve()
  check(outline('white').visible, 'Cancellation restores the eligible hover outline')
  end.emit('pointerdown', { button: 0 })
  window.dispatchEvent(new Event('blur'))
  await Promise.resolve()
  check(!noOutlines(), 'Window blur clears a held gesture')
  end.emit('pointerdown', { button: 0 })
  window.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
  await Promise.resolve()
  check(!noOutlines(), 'Window-level release clears a held gesture')
  end.emit('pointerdown', { button: 0 })
  hud.syncEndTurnButton(endTexture, false, false)
  await Promise.resolve()
  check(
    noOutlines() && end.eventMode === 'none',
    'Disabling during a hold hides outlines and stays disabled'
  )
  hud.syncEndTurnButton(endTexture, true, true)
  end.emit('pointerover', {})
  end.emit('pointerdown', { button: 0 })
  end.emit('pointerup', { button: 0 })
  check(noOutlines(), 'Release does not flash an outline before pointertap')
  end.emit('pointertap', { button: 0 })
  await Promise.resolve()
  check(
    noOutlines() && clicks === 1,
    'Committed click stays dark throughout the turn transition'
  )
  await finish(Promise.resolve())
  hud.syncEndTurnButton(endTexture, true, true, 'extraTurn')
  await finish(Promise.resolve())
  await capture('outline-extra-turn')
  hud.syncEndTurnButton(endTexture, false, false)
  powers.forEach((p) => {
    p.setEnabled(false)
    p.setHoverAura(false)
  })
  // Complete HUD synchronization before the standalone animation checks below.
  await finish(Promise.resolve())
  clicks = 0
  end.setEnabled(true)
  await capture('01-standard-and-golden')
  const heroControls = [...renderer.controls].filter((c) => c.kind === 'heroPower')
  const powerMesh = (index: number) =>
    heroControls[index].nodes.get('RootObject/Mesh')!.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshPhongMaterial[]
    >
  const standardGeometry = powerMesh(0).geometry
  const goldenGeometry = powerMesh(1).geometry
  for (const control of heroControls) {
    const gem = control.nodes.get('RootObject/Gem_Mana')!.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshPhongMaterial[]
    >
    check(
      gem.material[0].color.getHex() === 0xffffff &&
        gem.material[0].specular.getHex() === 0,
      'Mana crystal uses the active shader tint without stale gloss or extra blue tint'
    )
  }
  check(
    goldenGeometry.attributes.position.count >
      standardGeometry.attributes.position.count,
    'Golden power uses the separate leaf geometry'
  )
  check(
    !!powerMesh(1).material[0].specularMap && !powerMesh(0).material[0].specularMap,
    'Only the golden frame uses its original specular mask'
  )
  powers[0].setPremium(true)
  check(
    powerMesh(0).geometry.attributes.position.count ===
      goldenGeometry.attributes.position.count,
    'Changing premium status swaps the geometry'
  )
  powers[0].setPremium(false)
  check(
    powerMesh(0).geometry === standardGeometry,
    'Returning to standard restores the cached geometry'
  )
  const endMesh = [...renderer.controls].find((c) => c.kind === 'endTurn')!
  check(
    endMesh.camera.isOrthographicCamera,
    'End-turn tilt preserves parallel projection'
  )
  check(
    [...renderer.controls]
      .filter((c) => c.kind === 'heroPower')
      .every((c) => Math.abs(c.camera.position.z) < 1e-8),
    'Both hero-power cameras remain directly overhead'
  )
  const productionCamera = endMesh.camera.position.clone()
  for (const degrees of [5, 10, 15]) {
    const radians = THREE.MathUtils.degToRad(degrees),
      distance = productionCamera.length()
    endMesh.camera.position.set(
      0,
      Math.cos(radians) * distance,
      Math.sin(radians) * distance
    )
    endMesh.camera.lookAt(0, 0, 0)
    renderer.invalidate()
    await capture(`angle-${degrees}-degrees`)
  }
  endMesh.camera.position.copy(productionCamera)
  endMesh.camera.lookAt(0, 0, 0)
  // Sample both directions on all three controls. Transparent padding must
  // remain at each atlas edge throughout the authored rotation and lift.
  for (const control of renderer.controls) {
    const names =
      control.kind === 'endTurn'
        ? ['ENDTURN_WAITING', 'ENDTURN_YOUR_TURN']
        : ['HeroPower_Used', 'HeroPower_Restore']
    for (const name of names) {
      for (let step = 0; step <= 12; step++) {
        control.sample(name, (control.duration(name) * step) / 12)
        renderer.render()
        const frame = app.renderer.extract.pixels({ target: control, resolution: 1 })
        let clear = true
        for (let edge = 0; edge < frame.width; edge++) {
          for (const offset of [
            edge * 4 + 3,
            ((frame.height - 1) * frame.width + edge) * 4 + 3,
            edge * frame.width * 4 + 3,
            (edge * frame.width + frame.width - 1) * 4 + 3
          ])
            if (frame.pixels[offset] !== 0) clear = false
        }
        check(
          clear,
          `${control.kind} slot ${control.slot}: ${name} sample ${step} stays inside atlas padding`
        )
      }
    }
  }
  renderer.invalidate()
  end.emit('pointerdown', { button: 0 })
  gsap.globalTimeline.time(gsap.globalTimeline.time() + 0.1, false)
  check(
    Math.abs([...renderer.controls][2].pressRoot.position.y + 0.2) < 1e-5,
    'Press uses source depth'
  )
  end.emit('pointerout', {})
  gsap.globalTimeline.time(gsap.globalTimeline.time() + 0.1, false)
  check(
    clicks === 0 && Math.abs([...renderer.controls][2].pressRoot.position.y) < 1e-5,
    'Drag-away releases without action'
  )
  const transition = end.setFace('enemyTurn', frames[0])
  await finish(transition)
  check(!end.isTextureFlipping(), 'Enemy transition settles')
  await finish(end.setFace('extraTurn', frames[0]))
  await capture('02-extra-turn')
  end.setEnabled(false)
  end.emit('pointertap', { button: 0 })
  check(clicks === 0, 'Disabled end turn never submits an action')
  end.setEnabled(true)
  end.emit('pointerdown', { button: 0 })
  gsap.globalTimeline.time(gsap.globalTimeline.time() + 0.1, false)
  end.emit('pointerup', {})
  const waiting = end.setFace('enemyTurn', frames[0])
  check(
    [...renderer.controls][2].pressRoot.position.y < -0.19 && end.isTextureFlipping(),
    'Release and turn rotation start together'
  )
  const restore = end.setFace('extraTurn', frames[0])
  await finish(Promise.all([waiting, restore]))
  check(
    !end.isTextureFlipping() && end.eventMode === 'static',
    'Latest turn state wins interrupted transitions'
  )
  await finish(Promise.all(powers.map((p) => p.flipDown())))
  await capture('03-exhausted-backs')
  const exhaustedCount = renderer.renderCount
  renderer.render(16)
  check(
    renderer.renderCount === exhaustedCount,
    'Hidden golden artwork does not redraw an exhausted control'
  )
  const changed = powers[0].replaceArtwork(art, true)
  powers[0].setEnabled(false)
  await finish(changed)
  check(
    powers[0].eventMode === 'none',
    'Replacing an exhausted power preserves the latest disabled state'
  )
  await finish(Promise.all(powers.map((p) => p.flipUp())))
  const use = powers[0].flipDown()
  const reset = powers[0].flipUp()
  await finish(Promise.all([use, reset]))
  check(
    ![...renderer.controls][0].busy,
    'Interrupted power animations settle and resolve both callers'
  )
  for (const [name, url] of Object.entries(HERO_POWER_ASSET_SOURCES)) {
    const texture = await Assets.load(url)
    powers[0].setArtwork(texture)
    powers[1].setArtwork(texture)
    renderer.render()
    app.renderer.render(app.stage)
    check(
      renderer.controls.size === 3,
      `${name}: both finishes render without adding controls`
    )
  }
  const replacement = powers[0].replaceArtwork(art, true)
  await finish(replacement)
  powers[0].setCost(0)
  powers[0].setCostColor('reduced')
  powers[1].setCost(12)
  powers[1].setCostColor('increased')
  await capture('04-replacement-and-costs')
  powers.forEach((p) => p.setPremium(false))
  // Exercise visible-window animation even though this capture window is hidden.
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  renderer.render()
  const beforeShimmer = app.renderer.extract
    .pixels({ target: heroControls[0], resolution: 1 })
    .pixels.slice()
  for (let i = 0; i < 20; i++) renderer.render(50)
  const afterShimmer = app.renderer.extract.pixels({
    target: heroControls[0],
    resolution: 1
  }).pixels
  check(
    beforeShimmer.some((v, i) => v !== afterShimmer[i]),
    'Standard mana crystal visibly animates its masked cloud texture'
  )
  await finish(Promise.all(powers.map((p) => p.flipDown())))
  renderer.render()
  let count = renderer.renderCount
  for (let i = 0; i < 10; i++) renderer.render(50)
  check(
    renderer.renderCount === count,
    'Exhausted powers stop the crystal animation and atlas redraws'
  )
  powers[1].setPremium(true)
  renderer.render()
  const beforeReflection = app.renderer.extract
    .pixels({ target: heroControls[1], resolution: 1 })
    .pixels.slice()
  for (let i = 0; i < 40; i++) renderer.render(100)
  const afterReflection = app.renderer.extract.pixels({
    target: heroControls[1],
    resolution: 1
  }).pixels
  check(
    beforeReflection.some((v, i) => v !== afterReflection[i]),
    'Golden back retains animated masked reflection while exhausted'
  )
  await finish(Promise.all(powers.map((p) => p.flipUp())))
  powers.forEach((p) => {
    p.visible = false
  })
  renderer.render()
  count = renderer.renderCount
  for (let i = 0; i < 10; i++) renderer.render(50)
  check(renderer.renderCount === count, 'Hidden powers stop material animation')
  powers.forEach((p) => {
    p.visible = true
  })
  Reflect.deleteProperty(document, 'hidden')
  const pending = powers[0].flipDown()
  powers.forEach((p) => p.dispose())
  hud.dispose()
  await pending
  check(
    renderer.controls.size === 0,
    'Disposal releases controls and resolves animation promises'
  )
  gsap.ticker.remove(tick)
  renderer.dispose()
  app.destroy(true, { children: true })
  return { checks, calibration }
}
run()
  .then((result) => ipcRenderer.send('result', result))
  .catch((error) => ipcRenderer.send('result', { checks, error: error.stack }))
