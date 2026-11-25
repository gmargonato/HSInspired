import { CARD_DRAW_LAYOUT } from '../src/scenes/match/presentation/card-draw-layout'
import 'pixi.js/unsafe-eval'
import {
  Application,
  Container,
  Graphics,
  Assets,
  Sprite,
  PerspectiveMesh,
  Rectangle,
  Texture
} from 'pixi.js'
import { ipcRenderer } from 'electron'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import {
  createCardMotion,
  cardRotation,
  projectMotionPlane,
  exposeCard,
  deckCardGeometry,
  type DeckMotionProfile,
  type MotionCorners,
  type MotionPose,
  type CardMotionPlayback
} from '../src/scenes/match/presentation/card-motion'
import {
  CardMotionVisual,
  deckMotionCorners,
  deckMotionSlot
} from '../src/scenes/match/presentation/card-motion-visual'
import { CardFlightVisual } from '../src/scenes/match/presentation/card-flight-visual'
import { cardDeckSlot } from '../src/scenes/match/presentation/card-deck-slot'
import {
  createLocalDrawFlight,
  createDrawProfileFlight
} from '../src/scenes/match/presentation/card-draw-animation'
import {
  HandCardPerspective,
  resolvePerspectiveCorners
} from '../src/scenes/match/hand/hand-card-perspective'
import { CARD_MOTION_LAYOUT } from '../src/scenes/match/presentation/card-motion-layout'
import { FatigueView } from '../src/scenes/match/hud/fatigue-view'
import { Burn } from '../src/visual-components/effects/burn'
import fatigueUrl from '../assets/images/match/fatigue.png'
import noiseUrl from '../assets/images/effects/noise-01.jpg'
import { CardView } from '../src/visual-components/cards/card-view'
import { CardAssetResolver } from '../src/visual-components/assets/card-asset-resolver'
import { CARD_CATALOG, asCardId } from '../src/game-rules/content/cards'
import { GAME_BOARD_LAYOUT } from '../src/scenes/match/game-scene-layout'
import { SECRET_LAYOUT } from '../src/scenes/match/board/secret-layout'
import { applyAnchoredPlacement } from '../src/visual-components/layout'
import boardUrl from '../assets/images/table/board.png'
import backUrl from '../assets/images/cards/card-back.png'
import deckUrl from '../assets/images/match/deck.png'
import artUrl from '../assets/images/card-artwork/classic_big_game_hunter.png'
import fontUrl from '../assets/fonts/belwe_bold.ttf'
import { gsap } from '../src/visual-components/animation/animations'

const checks: string[] = []
let maxRigidProjectionError = 0
/** Independent Three.js camera reconstruction: detects any per-corner rubber morph. */
function checkRigid(pose: MotionPose, aspect: number, exposure = 1) {
  const plane = pose.plane
  if (!plane) return
  check(
    Math.abs(plane.width / plane.height - aspect) < 1e-9,
    'fixed full-card aspect ratio'
  )
  const q = new Quaternion(...plane.quaternion).normalize(),
    normal = new Vector3(0, 1, 0).applyQuaternion(q)
  const cs = Math.cos(CARD_MOTION_LAYOUT.cameraSideAngle),
    sn = Math.sin(CARD_MOTION_LAYOUT.cameraSideAngle)
  const front = normal.x * sn + normal.y * cs >= 0
  const camera = new PerspectiveCamera(
    (2 * Math.atan(540 / plane.cameraDepth) * 180) / Math.PI,
    1920 / 1080,
    1,
    10000
  )
  const reference = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, exposure - 0.5],
    [-0.5, exposure - 0.5]
  ].map(([u, v]) => {
    const point = new Vector3(
      u * plane.width * (front ? 1 : -1) + plane.offset.x,
      0,
      -v * plane.height - plane.offset.y
    ).applyQuaternion(q)
    point
      .set(
        point.x * cs - point.y * sn,
        point.z,
        -plane.cameraDepth + point.x * sn + point.y * cs
      )
      .project(camera)
    const x = point.x * 960,
      y = -point.y * 540
    return {
      x: plane.center.x + x * Math.cos(plane.rotation) - y * Math.sin(plane.rotation),
      y: plane.center.y + x * Math.sin(plane.rotation) + y * Math.cos(plane.rotation)
    }
  })
  const error = Math.max(
    ...reference.map((p, i) =>
      Math.hypot(p.x - pose.corners[i].x, p.y - pose.corners[i].y)
    )
  )
  maxRigidProjectionError = Math.max(maxRigidProjectionError, error)
  check(error < 1e-7, 'corners agree with an independent rigid 3D projection')
}
function check(ok: unknown, message: string) {
  if (!ok) throw Error(message)
  checks.push(message)
}
const rectangle = (x: number, y: number, w: number, h: number): MotionCorners => [
  { x: x - w / 2, y: y - h / 2 },
  { x: x + w / 2, y: y - h / 2 },
  { x: x + w / 2, y: y + h / 2 },
  { x: x - w / 2, y: y + h / 2 }
]
async function run() {
  const app = new Application()
  await app.init({
    width: 1280,
    height: 720,
    preference: 'webgl',
    background: 0x242424
  })
  document.getElementById('startup')?.remove()
  document.body.append(app.canvas)
  app.stop()
  gsap.ticker.sleep()
  app.stage.scale.set(2 / 3)
  document.fonts.add(
    await new FontFace('Belwe', `url(${fontUrl})`, { weight: '700' }).load()
  )
  const [board, back, deck, art] = await Promise.all(
    [boardUrl, backUrl, deckUrl, artUrl].map((url) => Assets.load<Texture>(url))
  )
  const background = new Sprite(board)
  background.width = 1920
  background.height = 1080
  app.stage.addChild(background)
  const local = new Sprite(deck),
    remote = new Sprite(deck)
  applyAnchoredPlacement(local, GAME_BOARD_LAYOUT.decks.local)
  applyAnchoredPlacement(remote, GAME_BOARD_LAYOUT.decks.remote)
  app.stage.addChild(local, remote)
  const card = await CardView.create(
    CARD_CATALOG.require(asCardId('classic_big_game_hunter')),
    new CardAssetResolver(),
    { artwork: art, ignorePremiumOverride: true }
  )
  card.label = 'motion.reference-card'
  card.position.set(850, 680)
  card.scale.set(0.35)
  app.stage.addChild(card)
  const bounds = card.getLocalBounds(),
    frame = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
  const face = app.renderer.generateTexture({ target: card, frame })
  card.visible = false
  const preview = new CardFlightVisual(app.renderer, app.stage, card, back, {
    face: card,
    capture: () => face,
    label: 'motion.preview'
  })
  const mesh = preview.mesh
  const slotGuide = new Graphics()
  slotGuide.label = 'motion.slot-guide'
  app.stage.addChild(slotGuide)
  const localSlot = deckMotionSlot(app.stage, local),
    remoteSlot = deckMotionSlot(app.stage, remote)
  const start = deckMotionCorners(app.stage, local),
    remoteStart = deckMotionCorners(app.stage, remote),
    hand = rectangle(1000, 990, 186, 270),
    remoteHand = rectangle(1030, 35, 136, 198),
    row = rectangle(850, 520, 217, 315)
  const scenarios: {
    name: string
    playback: CardMotionPlayback
    hidden?: boolean
    texture?: Texture
    aspect?: number
    burnAt?: number
  }[] = []
  const original = createLocalDrawFlight(
    [start[3], start[0], start[1], start[2]],
    hand,
    620,
    900,
    undefined,
    localSlot
  )
  const legacy: CardMotionPlayback = {
    duration: 1 + 0.75 + 10 / 21,
    sample(time) {
      const peak = 0.8 / 1.05
      return original(
        time < 1
          ? time * peak
          : time < 1.75
            ? peak
            : peak + (1 - peak) * Math.min(1, (time - 1.75) / (10 / 21))
      )
    }
  }
  scenarios.push({ name: 'draw/local-normal', playback: legacy })
  const group: Record<DeckMotionProfile, string> = {
    'opponent-draw': 'draw',
    'public-draw': 'public-draw',
    'conceal-hand': 'public-draw',
    insert: 'deck-insertion',
    'hand-return': 'deck-insertion',
    trade: 'tradeable',
    'mulligan-return': 'mulligan',
    'mulligan-replacement': 'mulligan',
    'opening-deal': 'opening-deal',
    'deck-to-play': 'deck-to-board',
    'reveal-return': 'reveal',
    'reveal-only': 'reveal',
    fatigue: 'fatigue'
  }
  const add = (
    profile: DeckMotionProfile,
    a: MotionCorners,
    b: MotionCorners,
    hidden = false,
    remote = false
  ) =>
    scenarios.push({
      name: group[profile] + '/' + (remote ? 'remote' : 'local') + '-' + profile,
      playback:
        !remote && (profile === 'opening-deal' || profile === 'mulligan-replacement')
          ? (() => {
              const duration =
                CARD_DRAW_LAYOUT.localMulligan.approach +
                CARD_DRAW_LAYOUT.localMulligan.settle
              const sample = createDrawProfileFlight(
                a,
                b,
                620,
                900,
                profile === 'opening-deal' ? 'mulligan-reveal' : 'mulligan-replacement',
                true,
                undefined,
                localSlot
              )
              return { duration, sample: (time: number) => sample(time / duration) }
            })()
          : createCardMotion(profile, {
              start: a,
              end: b,
              hidden,
              remote,
              slot: remote ? remoteSlot : localSlot
            }),
      hidden
    })
  add('opponent-draw', remoteStart, remoteHand, true, true)
  for (const remoteSide of [false, true]) {
    const pile = remoteSide ? remoteStart : start,
      origin = remoteSide ? remoteHand : hand
    add('insert', row, pile, false, remoteSide)
    add('hand-return', origin, pile, remoteSide, remoteSide)
    add('trade', origin, pile, remoteSide, remoteSide)
    add('mulligan-return', remoteSide ? origin : row, pile, remoteSide, remoteSide)
    add('mulligan-replacement', pile, remoteSide ? origin : row, remoteSide, remoteSide)
    if (!remoteSide) add('opening-deal', pile, row)
    else
      scenarios.push({
        name: 'opening-deal/remote-opening',
        hidden: true,
        playback: createCardMotion('opponent-draw', {
          start: pile,
          end: origin,
          slot: remoteSlot,
          hidden: true
        })
      })
    add(
      'deck-to-play',
      pile,
      rectangle(900, remoteSide ? 400 : 640, 186, 270),
      false,
      remoteSide
    )
    const side = remoteSide ? 'remote' : 'local',
      peak = rectangle(1500, remoteSide ? 310 : 690, 217, 315)
    const badge = SECRET_LAYOUT.badges[side].position
    scenarios.push({
      name: 'deck-to-secret/' + side + '-secret',
      hidden: remoteSide,
      playback: createCardMotion('deck-to-play', {
        start: pile,
        end: rectangle(
          badge.x,
          badge.y,
          620 * CARD_MOTION_LAYOUT.deckToSecret.scale,
          900 * CARD_MOTION_LAYOUT.deckToSecret.scale
        ),
        slot: remoteSide ? remoteSlot : localSlot,
        hidden: remoteSide
      })
    })
    add('reveal-only', pile, peak, false, remoteSide)
    add('reveal-return', peak, pile, false, remoteSide)
    const draw = createDrawProfileFlight(
      [pile[3], pile[0], pile[1], pile[2]],
      origin,
      620,
      900,
      remoteSide ? 'remote-public-reveal' : 'public-reveal',
      true,
      undefined,
      remoteSide ? remoteSlot : localSlot
    )
    const ascent = remoteSide ? CARD_MOTION_LAYOUT.publicDraw.show : 1,
      landing = remoteSide ? CARD_MOTION_LAYOUT.publicDraw.hide : 10 / 21
    const peakAt = 0.8 / 1.05,
      duration = ascent + 0.5 + landing
    scenarios.push({
      name: 'public-draw/' + side + '-public',
      playback: {
        duration,
        sample: (t) =>
          draw(
            t < ascent
              ? (t / ascent) * peakAt
              : t < ascent + 0.5
                ? peakAt
                : peakAt + ((1 - peakAt) * (t - ascent - 0.5)) / landing
          )
      }
    })
    scenarios.push({
      name: 'burn/' + side + '-burn',
      playback: {
        duration: ascent + 1,
        sample: (t) => draw(Math.min(1, t / ascent) * peakAt)
      },
      burnAt: ascent
    })
  }
  const [fatigueTexture, noise] = await Promise.all(
    [fatigueUrl, noiseUrl].map((url) => Assets.load<Texture>(url))
  )
  const fatigue = new FatigueView(fatigueTexture)
  void fatigue.present(3, 'local')
  gsap.ticker.sleep()
  fatigue.alpha = 1
  fatigue.scale.set(1)
  const fatigueFace = app.renderer.generateTexture({ target: fatigue })
  fatigue.destroy({ children: true })
  for (const remoteSide of [false, true])
    scenarios.push({
      name: 'fatigue/' + (remoteSide ? 'remote' : 'local') + '-empty-deck',
      texture: fatigueFace,
      aspect: 420 / 727,
      playback: createCardMotion('fatigue', {
        start: remoteSide ? remoteStart : start,
        end: rectangle(1650, remoteSide ? 300 : 700, 420 * 0.7, 727 * 0.7),
        aspectRatio: 420 / 727
      })
    })
  const burn = new Burn(noise)
  // Render a real stencil, independent of the motion sampler and board artwork.
  // Visible pixels and projected vertices must be identical when masking is toggled.
  for (const angle of [0, Math.PI / 6]) {
    const probeLayer = new Container()
    const probeCard = new Graphics()
      .rect(0, 0, 60, 80)
      .fill(0xff0000)
      .rect(60, 0, 60, 80)
      .fill(0x0000ff)
    const neighbor = new Graphics().rect(145, 105, 10, 10).fill(0x00ff00)
    probeLayer.addChild(probeCard, neighbor)
    const probe = new CardFlightVisual(app.renderer, probeLayer, probeCard, back, {
      face: probeCard,
      label: 'motion.mask-probe'
    })
    const slot = cardDeckSlot({ x: 80, y: 60 })
    const plane = {
      center: { x: 80, y: 60 },
      width: 120,
      height: 80,
      quaternion: cardRotation(180, 0),
      rotation: angle,
      cameraDepth: CARD_MOTION_LAYOUT.cameraDepth,
      offset: { x: 0, y: 0 }
    }
    const pose = exposeCard(
      {
        ...projectMotionPlane(
          plane.center,
          plane.width,
          plane.height,
          plane.quaternion,
          angle
        ),
        front: true,
        edgeOn: false,
        magnification: 1,
        plane
      },
      slot,
      0.5
    )
    const extract = () =>
      app.renderer.extract.pixels({
        target: probeLayer,
        frame: new Rectangle(0, 0, 160, 120)
      })
    probe.setOcclusionEnabled(false)
    probe.update(pose, 0.5)
    const full = extract()
    const positions = Array.from(probe.mesh.geometry.positions)
    probe.setOcclusionEnabled(true)
    probe.update(pose, 0.5)
    const clipped = extract()
    check(
      positions.every((v, i) => v === probe.mesh.geometry.positions[i]),
      'mask toggling never changes card vertices'
    )
    check(
      clipped.pixels[(80 * clipped.width + 80) * 4 + 3] === 0,
      'entered card pixels are occluded'
    )
    check(
      clipped.pixels[(110 * clipped.width + 150) * 4 + 3] === 255,
      'slot mask does not hide neighboring objects'
    )
    let compared = 0
    for (let y = 22; y < 98; y++)
      for (let x = 22; x < 138; x++) {
        const localY = -(x - 80) * Math.sin(angle) + (y - 60) * Math.cos(angle)
        if (localY >= -2) continue
        const pixel = (y * clipped.width + x) * 4
        check(
          [0, 1, 2, 3].every(
            (c) => clipped.pixels[pixel + c] === full.pixels[pixel + c]
          ),
          'exposed artwork keeps its pixels and UV mapping'
        )
        compared++
      }
    check(compared > 1000, 'mask pixel comparison covers the exposed card')
    probe.setHiddenPortionVisible(true)
    probe.update(pose, 0.5)
    const ghost = extract()
    const hiddenAlpha = ghost.pixels[(80 * ghost.width + 80) * 4 + 3]
    check(
      hiddenAlpha > 0 && hiddenAlpha < 128,
      'hidden portion debug overlay is translucent'
    )
    probe.dispose()
    probe.dispose()
    check(
      probeCard.visible && probeLayer.children.length === 2,
      'flight cleanup removes its mask and restores its body'
    )
    probeLayer.destroy({ children: true })
  }
  for (const profile of ['mulligan-return', 'reveal-return'] as const) {
    const pose = createCardMotion(profile, {
      start: row,
      end: start,
      slot: localSlot
    }).sample(0)
    const error = Math.max(
      ...row.map((p, i) => Math.hypot(p.x - pose.corners[i].x, p.y - pose.corners[i].y))
    )
    check(error < 0.001, profile + ' starts at the displayed flat card without a jump')
  }
  // A single wrong-facing frame can flash the artwork during a turn. Sample more
  // densely than playback and verify the geometry, not a latched texture flag.
  const faceTransitions: Record<string, number> = {}
  for (const scenario of scenarios) {
    const playback = scenario.playback
    let previous = playback.sample(0).front
    let transitions = 0
    for (let i = 1; i <= Math.ceil(playback.duration * 240); i++) {
      const pose = playback.sample(Math.min(playback.duration, i / 240))
      if (pose.front !== previous) transitions++
      previous = pose.front
      if (!scenario.hidden && pose.plane) {
        const normal = new Vector3(0, 1, 0).applyQuaternion(
          new Quaternion(...pose.plane.quaternion).normalize()
        )
        const facing =
          normal.x * Math.sin(CARD_MOTION_LAYOUT.cameraSideAngle) +
          normal.y * Math.cos(CARD_MOTION_LAYOUT.cameraSideAngle)
        check(pose.front === facing >= 0, scenario.name + ' face agrees with its plane')
      }
      if (scenario.hidden) check(!pose.front, scenario.name + ' stays concealed')
    }
    const expected = scenario.hidden
      ? 0
      : scenario.name === 'public-draw/remote-public'
        ? 2
        : 1
    check(
      transitions === expected,
      scenario.name + ' has only its intended face changes'
    )
    faceTransitions[scenario.name] = transitions
  }
  let maxMulliganReverseError = 0
  const localDeal = scenarios.find(
    (s) => s.name === 'opening-deal/local-opening-deal'
  )!.playback
  const localReplacement = scenarios.find(
    (s) => s.name === 'mulligan/local-mulligan-replacement'
  )!.playback
  for (let i = 0; i <= 240; i++) {
    const a = localDeal.sample((localDeal.duration * i) / 240)
    const b = localReplacement.sample((localReplacement.duration * i) / 240)
    check(
      a.corners.every(
        (p, j) => Math.hypot(p.x - b.corners[j].x, p.y - b.corners[j].y) < 1e-7
      ),
      'local deal and replacement share restored choreography'
    )
  }
  for (const side of ['remote']) {
    const returning = scenarios.find(
      (s) => s.name === `mulligan/${side}-mulligan-return`
    )!.playback
    const replacement = scenarios.find(
      (s) => s.name === `mulligan/${side}-mulligan-replacement`
    )!.playback
    check(
      returning.duration === replacement.duration,
      side + ' mulligan durations agree'
    )
    for (let i = 0; i <= Math.ceil(returning.duration * 240); i++) {
      const time = Math.min(returning.duration, i / 240)
      const a = returning.sample(time)
      const b = replacement.sample(replacement.duration - time)
      const error = Math.max(
        ...a.corners.map((p, corner) =>
          Math.hypot(p.x - b.corners[corner].x, p.y - b.corners[corner].y)
        )
      )
      maxMulliganReverseError = Math.max(maxMulliganReverseError, error)
      check(error < 1e-7, side + ' mulligan replacement reverses the return geometry')
      check(a.front === b.front, side + ' mulligan reverse has the same visible face')
      check(
        Math.abs((a.exposure ?? 1) - (b.exposure ?? 1)) < 1e-9,
        side + ' mulligan reverse has the same deck exposure'
      )
    }
  }
  const interactive = new URL(location.href).searchParams.get('view') === 'true'
  const selectedSet = new URL(location.href).searchParams.get('set')
  if (selectedSet) {
    const selected = scenarios.filter((s) => s.name.startsWith(selectedSet + '/'))
    if (!selected.length) throw Error('Unknown animation set: ' + selectedSet)
    scenarios.splice(0, scenarios.length, ...selected)
  }
  const control = document.createElement('div')
  control.style.cssText = 'padding:8px;display:grid;gap:8px'
  control.innerHTML =
    '<div style="display:flex;gap:12px;align-items:center"><select style="width:320px"></select><button>Play</button><select><option value="1">1×</option><option value=".5">½×</option><option value=".25">¼×</option></select><input type="range" min="0" max="1" step=".001" style="flex:1"></div>' +
    '<div style="display:flex;gap:16px;align-items:center"><span style="min-width:410px"></span><label><input id="slot-mask" type="checkbox" checked> Hide inside deck</label><label><input id="slot-guide" type="checkbox"> Show entry edge</label><label><input id="slot-ghost" type="checkbox"> Show hidden portion</label></div>'
  document.body.append(control)
  const [select, speed] = control.querySelectorAll('select'),
    button = control.querySelector('button')!,
    slider = control.querySelector('input')!,
    label = control.querySelector('span')!
  const maskToggle = control.querySelector<HTMLInputElement>('#slot-mask')!,
    guideToggle = control.querySelector<HTMLInputElement>('#slot-guide')!,
    ghostToggle = control.querySelector<HTMLInputElement>('#slot-ghost')!
  const describeFrame = (name: string, seconds: number, duration: number) => {
    label.textContent = `${name}  ${seconds.toFixed(3)} / ${duration.toFixed(3)} s`
    slider.value = String(seconds / duration)
  }
  scenarios.forEach((s, i) => select.add(new Option(s.name, String(i))))
  let current = interactive
      ? Math.max(
          0,
          scenarios.findIndex((s) => s.name === 'draw/local-normal')
        )
      : 0,
    time = 0,
    playing = false,
    last = 0
  const render = () => {
    const s = scenarios[current],
      pose = s.playback.sample(time)
    preview.setOcclusionEnabled(maskToggle.checked)
    preview.setHiddenPortionVisible(ghostToggle.checked)
    preview.update(pose, time / s.playback.duration, 1, s.texture ?? face)
    mesh.filters = s.burnAt === undefined ? [] : [burn.filter]
    if (s.burnAt !== undefined)
      burn.setProgress(Math.max(0, Math.min(1, time - s.burnAt)))
    slotGuide.clear()
    const slot = s.name.includes('/remote') ? remoteSlot : localSlot
    if (guideToggle.checked) {
      const { x, y } = slot.mouth
      slotGuide
        .moveTo(x - 5, y)
        .lineTo(x + 5, y)
        .moveTo(x, y - 5)
        .lineTo(x, y + 5)
      if (pose.visibleCorners) {
        const [, , b, a] = pose.visibleCorners
        slotGuide.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      slotGuide.stroke({ width: 2, color: 0x00e6ff })
    }
    describeFrame(s.name, time, s.playback.duration)
    app.renderer.render(app.stage)
  }
  select.onchange = () => {
    current = Number(select.value)
    time = 0
    playing = false
    button.textContent = 'Play'
    render()
  }
  maskToggle.onchange = guideToggle.onchange = ghostToggle.onchange = () => render()
  slider.oninput = () => {
    playing = false
    button.textContent = 'Play'
    time = Number(slider.value) * scenarios[current].playback.duration
    render()
  }
  button.onclick = () => {
    if (time >= scenarios[current].playback.duration) time = 0
    playing = !playing
    button.textContent = playing ? 'Pause' : 'Play'
  }
  const tick = (now: number) => {
    if (playing) {
      time = Math.min(
        scenarios[current].playback.duration,
        time + ((now - last) / 1000) * Number(speed.value)
      )
      render()
      if (time >= scenarios[current].playback.duration) {
        playing = false
        button.textContent = 'Play'
      }
    }
    last = now
    requestAnimationFrame(tick)
  }
  if (interactive) {
    select.value = String(current)
    render()
    requestAnimationFrame(tick)
    ipcRenderer.send('viewer-ready', { scenarios: scenarios.length })
    return
  }
  const traces: Record<string, unknown> = {}
  for (let index = 0; index < scenarios.length; index++) {
    current = index
    select.value = String(index)
    const s = scenarios[index],
      frames = []
    let consecutiveEdgeFrames = 0
    for (let i = 0; i <= Math.ceil(s.playback.duration * 60); i++) {
      time = Math.min(s.playback.duration, i / 60)
      const pose = s.playback.sample(time)
      frames.push({ time, ...pose })
      check(
        pose.corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        s.name + ' finite frame ' + i
      )
      if (s.hidden && pose.front) throw Error(s.name + ' exposed face')
      checkRigid(pose, s.aspect ?? 620 / 900)
      consecutiveEdgeFrames = pose.edgeOn ? consecutiveEdgeFrames + 1 : 0
      check(consecutiveEdgeFrames <= 3, s.name + ' never stalls edge-on for over 50 ms')
      if (pose.slot && pose.plane) {
        const deck = deckCardGeometry(pose.slot, s.aspect ?? 620 / 900)
        if (pose.exposure === CARD_MOTION_LAYOUT.slot.exposedFraction) {
          const resting = projectMotionPlane(
            deck.seated,
            deck.width,
            deck.height,
            deck.quaternion,
            deck.rotation
          ).corners
          check(
            !pose.front &&
              pose.corners.every(
                (point, i) =>
                  Math.hypot(point.x - resting[i].x, point.y - resting[i].y) < 1e-7
              ),
            s.name +
              ' uses the same complete seated card, not a recipe-specific endpoint'
          )
        }
        if (pose.visibleCorners) {
          const [topLeft, topRight, bottomRight, bottomLeft] = pose.corners
          const [, , cutRight, cutLeft] = pose.visibleCorners
          const top = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y)
          const cut = Math.hypot(cutRight.x - cutLeft.x, cutRight.y - cutLeft.y)
          const bottom = Math.hypot(
            bottomRight.x - bottomLeft.x,
            bottomRight.y - bottomLeft.y
          )
          check(
            top > cut && cut > bottom,
            s.name + ' exposed top is nearer/larger than the inserted bottom'
          )
          checkRigid(
            { ...pose, corners: pose.visibleCorners },
            s.aspect ?? 620 / 900,
            pose.exposure
          )
          check(!pose.edgeOn, s.name + ' seated/extracting card remains visible')
          check(
            Math.abs(pose.plane.width - deck.width) < 1e-7 &&
              Math.abs(pose.plane.height - deck.height) < 1e-7,
            s.name + ' complete card keeps its size while entering or leaving'
          )
          check(
            pose.exposure! >= 0.5 && pose.exposure! < 1,
            s.name + ' hides the bottom portion in card coordinates'
          )
        }
        if (
          time === s.playback.duration &&
          /-(insert|hand-return|trade|mulligan-return|reveal-return)$/.test(s.name)
        ) {
          check(
            pose.exposure === 0.5 && !pose.edgeOn,
            s.name + ' arrives half exposed, without vanishing edge-on'
          )
          check(
            Math.hypot(
              pose.plane.center.x - deck.seated.x,
              pose.plane.center.y - deck.seated.y
            ) < 1e-7,
            s.name + ' shares the draw resting position'
          )
        }
      }
    }
    traces[s.name] = frames
    const fractions = [0, 0.05, 0.1, 0.15, 0.3, 0.5, 0.6, 0.7, 0.85, 1]
    if (s.name.startsWith('mulligan/')) fractions.push(0.4, 0.45)
    for (const fraction of fractions.sort((a, b) => a - b)) {
      time = fraction * s.playback.duration
      render()
      await new Promise(requestAnimationFrame)
      await ipcRenderer.invoke(
        'capture',
        s.name + '-' + String(Math.round(time * 1000)).padStart(4, '0') + 'ms'
      )
      if (
        fraction === 0 ||
        fraction === 0.05 ||
        fraction === 0.1 ||
        fraction === 0.85 ||
        fraction === 1 ||
        fraction === 0.3 ||
        (s.name.startsWith('mulligan/') && [0.4, 0.45].includes(fraction)) ||
        fraction === 0.5 ||
        fraction === 0.6 ||
        fraction === 0.7
      ) {
        const corners = s.playback.sample(time).corners
        const x = Math.max(
            0,
            Math.floor((Math.min(...corners.map((p) => p.x)) * 2) / 3 - 24)
          ),
          y = Math.max(
            0,
            Math.floor((Math.min(...corners.map((p) => p.y)) * 2) / 3 - 24)
          )
        const right = Math.min(
            1280,
            Math.ceil((Math.max(...corners.map((p) => p.x)) * 2) / 3 + 24)
          ),
          bottom = Math.min(
            720,
            Math.ceil((Math.max(...corners.map((p) => p.y)) * 2) / 3 + 24)
          )
        if (right > x && bottom > y)
          await ipcRenderer.invoke(
            'capture',
            s.name +
              '-' +
              String(Math.round(time * 1000)).padStart(4, '0') +
              'ms-detail',
            { x, y, width: right - x, height: bottom - y }
          )
      }
      if (
        s.name === 'deck-insertion/local-insert' &&
        [0.5, 0.6, 0.7].includes(fraction)
      ) {
        maskToggle.checked = false
        render()
        await new Promise(requestAnimationFrame)
        await ipcRenderer.invoke(
          'capture',
          'deck-insertion/local-insert-unmasked-' +
            String(Math.round(time * 1000)).padStart(4, '0') +
            'ms'
        )
        maskToggle.checked = true
      }
      if (
        (s.name === 'draw/local-normal' && [0, 0.05, 0.1].includes(fraction)) ||
        (/-(insert|reveal-return)$/.test(s.name) && [0.7, 0.85, 1].includes(fraction))
      ) {
        ghostToggle.checked = true
        guideToggle.checked = true
        render()
        await new Promise(requestAnimationFrame)
        await ipcRenderer.invoke(
          'capture',
          s.name + '-hidden-' + String(Math.round(time * 1000)).padStart(4, '0') + 'ms'
        )
        ghostToggle.checked = guideToggle.checked = false
        render()
      }
    }
  }
  await ipcRenderer.invoke('data', 'traces', traces)
  // Exercise real snapshot ownership/restoration, not only the sampler.
  select.disabled = button.disabled = speed.disabled = slider.disabled = true
  // Standalone fixture captures have their own name, rather than a stale scenario.
  select.hidden = true
  mesh.visible = false
  slotGuide.visible = false
  card.visible = true
  const visual = new CardMotionVisual(
    app.renderer,
    app.stage,
    card,
    back,
    'trade',
    start,
    { slot: localSlot }
  )
  visual.update(0.4)
  app.renderer.render(app.stage)
  check(!card.visible, 'flight hides its original')
  visual.dispose()
  visual.dispose()
  check(
    card.visible && visual.mesh.destroyed,
    'flight disposal restores original and releases mesh'
  )
  const holder = new Container()
  holder.position.set(850, 680)
  holder.scale.set(0.35)
  app.stage.addChild(holder)
  card.removeFromParent()
  card.position.set(0, 0)
  card.scale.set(1)
  holder.addChild(card)
  const drag = new HandCardPerspective(app.renderer, card)
  drag.setTarget({ x: 0.55, y: -0.4 })
  drag.update()
  describeFrame('drag/local-protected', 0, 1)
  app.renderer.render(app.stage)
  await ipcRenderer.invoke('capture', 'drag/local-protected-0000ms')
  const launch = drag.captureFlightPose(app.stage)
  const internals = drag as unknown as {
    mesh: PerspectiveMesh
    texture: Texture
    shadowFrame: Rectangle
  }
  const expected = resolvePerspectiveCorners(
    { x: 0.55, y: -0.4 },
    internals.texture.width,
    internals.texture.height,
    {
      x: bounds.x - internals.shadowFrame.x,
      y: bounds.y - internals.shadowFrame.y,
      width: bounds.width,
      height: bounds.height
    }
  )
  const corners = Object.values(expected).map((p) =>
    app.stage.toLocal(internals.mesh.toGlobal(p))
  )
  drag.destroy()
  const released = new CardMotionVisual(
    app.renderer,
    app.stage,
    card,
    back,
    'trade',
    start,
    { launch, slot: localSlot }
  )
  const releasedPose = released.playback.sample(0)
  const releaseError = Math.max(
    ...corners.map((p, i) =>
      Math.hypot(p.x - releasedPose.corners[i].x, p.y - releasedPose.corners[i].y)
    )
  )
  await ipcRenderer.invoke('data', 'release-debug', {
    launch,
    expected: corners,
    actual: releasedPose.corners,
    releaseError
  })
  check(
    releaseError < 1e-5,
    'dragged Tradeable release preserves the displayed rigid pose: ' + releaseError
  )
  for (const t of [0, 0.1, 0.25, 0.5, 1, 1.5]) {
    released.update(t)
    describeFrame('tradeable/local-dragged', t, 1.5)
    app.renderer.render(app.stage)
    await ipcRenderer.invoke(
      'capture',
      'tradeable/local-dragged-' + String(Math.round(t * 1000)).padStart(4, '0') + 'ms'
    )
  }
  released.dispose()
  card.visible = false
  const warning = new FatigueView(fatigueTexture)
  app.stage.addChild(warning)
  const beforeWarning = app.stage.children.length
  const pendingWarning = warning.present(3, 'local', {
    renderer: app.renderer,
    layer: app.stage,
    deck: local,
    back
  })
  gsap.ticker.sleep()
  check(!warning.visible, 'fatigue flight hides the live warning')
  warning.destroy({ children: true })
  await pendingWarning
  check(
    app.stage.children.length === beforeWarning - 1,
    'interrupting fatigue resolves its promise and releases the flight mesh'
  )
  check(app.renderer.gl.getError() === app.renderer.gl.NO_ERROR, 'no WebGL errors')
  if (traces['draw/local-normal'])
    await ipcRenderer.invoke('data', 'local-draw-current', traces['draw/local-normal'])
  ipcRenderer.send('result', {
    scenarios: scenarios.map((s) => ({ name: s.name, duration: s.playback.duration })),
    sampleChecks: checks.length,
    maxRigidProjectionError,
    maxMulliganReverseError,
    faceTransitions,
    releaseError,
    checks: checks.slice(-3),
    screenshots: scenarios.length * 7 + 7
  })
}
function reportError(error: unknown) {
  document.getElementById('startup')?.remove()
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  const output = document.createElement('pre')
  output.style.cssText = 'padding:16px;color:#ffb4b4;white-space:pre-wrap'
  output.textContent = 'Card Motion Viewer could not run:\n' + message
  document.body.prepend(output)
  ipcRenderer.send('result', { error: String(error), stack: message })
}
window.addEventListener('error', (event) => reportError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
run().catch(reportError)
