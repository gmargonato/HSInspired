/** Isolated Shader Lab/WebGL capture; no game or development server. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', process.env.GHOST_CAPTURE_DIR || 'ghost-check')

async function main() {
  fs.mkdirSync(output, { recursive: true })
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    const timer = setTimeout(() => app.exit(1), 120000)
    ipcMain.handle('capture', async (_, name) =>
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    )
    ipcMain.once('result', (_, result) => {
      clearTimeout(timer)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(result, null, 2)
      )
      console.log(JSON.stringify(result))
      app.exit(result.error ? 1 : 0)
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    await window.loadFile(path.join(output, 'index.html'))
    return
  }
  const urls = {}
  for (const [key, name] of Object.entries({
    ghostClouds: 'effects/ghost-clouds.png',
    ghostBannerAtlas: 'effects/ghost-banner-atlas.png',
    ghostButtonAtlas: 'effects/ghost-button-atlas.png',
    ghostSmokeAdd: 'effects/ghost-smoke-add.png',
    ghostSmoke: 'effects/ghost-smoke.png',
    ghostMote: 'effects/ghost-mote.png',
    ghostEvaporate: 'effects/ghost-evaporate.png',
    mulliganAnnouncement: 'match/mulligan-announcement.png',
    confirmMulliganButton: 'match/confirm-mulligan-button.png',
    mulliganOpponentStillChoosing: 'match/mulligan-opponent-still-choosing.png',
    mulliganCoinAnnouncement: 'match/mulligan-coin-announcement.png',
    toggleViewButton: 'match/toggle-view-button.png',
    confirmReward: 'ui/arena/arena-confirm-reward.png',
    board: 'match/BOARD.png'
  }))
    urls[key] =
      'data:image/' +
      (name.endsWith('jpg') ? 'jpeg' : 'png') +
      ';base64,' +
      fs.readFileSync(path.join(root, 'assets/images', name)).toString('base64')
  const source = `
    import { Application, Assets, Sprite, Texture, RenderTexture, Container } from 'pixi.js';
    import { gsap } from 'gsap';
    import { OutlineLab } from './src/dev-tools/outline-lab/outline-lab';
    import { OutlineLabShaderControls } from './src/dev-tools/outline-lab/outline-lab-shader-controls';
    import { OUTLINE_LAB_LAYOUT as L } from './src/dev-tools/outline-lab/outline-lab-layout';
    import { GhostAura, GHOST_DISAPPEARANCE_SECONDS } from './src/visual-components/effects/ghost-aura';
    import { GhostMaterialMesh } from './src/visual-components/effects/ghost-materials';
    import { GameMulliganView } from './src/scenes/match/game-mulligan-view';
    import { CardSelectionOverlay } from './src/scenes/match/presentation/card-selection-overlay';
    import { ArenaRewardsView } from './src/visual-components/cards/reward-prizes-view';
    import { AnimationScope } from './src/visual-components/animation/animations';
    import { prepareRewardGhostAura } from './src/visual-components/effects/prepare-menu-effects';
    import { GAME_BOARD_LAYOUT } from './src/scenes/match/game-scene-layout';
    import { ghostCurve } from './src/visual-components/effects/ghost-mist-particles';
    import { parseOutlineTuningConfig } from './src/desktop/contracts/ipc/outline-tuning';
    import tuning from './config/outline-tunings.json';
    const { ipcRenderer } = require('electron'); const checks=[];
    function check(ok,message){if(!ok)throw Error(message);checks.push(message)}
    async function run(){
      const app=new Application();await app.init({width:1920,height:1080,preference:'webgl',autoStart:false,preserveDrawingBuffer:true,backgroundColor:0x141c28});
      document.body.append(app.canvas);
      // Independent pixel oracle for the decoded DXBC equations, not snapshots.
      function solid(rgba){const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d');const data=ctx.createImageData(16,16);for(let i=0;i<data.data.length;i+=4)data.data.set(rgba,i);ctx.putImageData(data,0,0);const t=Texture.from(c);t.source.alphaMode='no-premultiply-alpha';return t}
      const main=solid([102,76,50,128]),cloud=solid([128,64,32,255]);
      cloud.source.style.addressMode='repeat';
      const probe=new GhostMaterialMesh(main,cloud,1,0,[.06415994,.18876508,.58431375,1]);
      probe.quad(0,8,8,16,16,0,[1,1,1,1]);probe.upload();probe.blendMode='none';
      probe.shader.resources.ghostUniforms.uniforms.uIntensity=2.22;
      const rt=RenderTexture.create({width:16,height:16});
      function pixels(){app.renderer.render({container:probe,target:rt,clear:true});return Array.from(app.renderer.extract.pixels(rt).pixels.slice((8*16+8)*4,(8*16+8)*4+4))}
      const actual=pixels(), expected=[102/255*128/255*.06415994*4.44,76/255*64/255*.18876508*4.44,50/255*32/255*.58431375*4.44,Math.min(1,128/255*(1-128/255)*4.44)].map(x=>Math.round(x*255));
      check(actual.every((v,i)=>Math.abs(v-expected[i])<=3),'scrolling shader matches source RGB and alpha equations');
      const u=probe.shader.resources.ghostUniforms.uniforms;u.uKind=2;u.uTint.set([.5,.5,.5,.5]);u.uIntensity=1;u.uOpacity=.4;
      const additive=pixels(), alpha=128/255;
      const addExpected=[102/255*alpha*.4,76/255*alpha*.4,50/255*alpha*.4,alpha*alpha*.4].map(x=>Math.round(x*255));
      check(additive.every((v,i)=>Math.abs(v-addExpected[i])<=3),'additive shader bakes SrcAlpha once and inherits opacity linearly');
      u.uKind=3;const smoke=pixels();check(Math.abs(smoke[3]-alpha*.4*255)<=2,'smoke preserves premultiplied coverage for Pixi compositing');
      probe.destroy();rt.destroy(true);main.destroy(true);cloud.destroy(true);
      check(Math.abs(ghostCurve([[0,1,0,0],[1,0,-2,-2]],.5)-.75)<1e-6,'Unity size curves retain cubic tangents');
      const legacy=structuredClone(tuning);legacy.ghost.tuning.mistTextureScale=4.21;legacy.ghost.palette.mistPrimaryColor=6967533;
      check(parseOutlineTuningConfig(legacy).ghost.tuning.mistTextureScale===4.21,'existing saved Ghost tuning remains loadable');
      const assets=Object.fromEntries(await Promise.all(Object.entries(${JSON.stringify(urls)}).map(async([k,v])=>[k,await Assets.load(v)])));
      const opts={canvas:app.canvas,renderer:app.renderer,parent:document.body};
      const lab=new OutlineLab(opts);app.stage.addChild(lab);
      lab.createChrome();lab.createPresetTabs();lab.createPaletteControls();lab.createHandControls();
      lab.shaderControls=new OutlineLabShaderControls({...opts,onShaderChange:()=>{}});
      lab.ghostAssets=assets;
      const group=lab.createPreviewGroup('ghost');
      lab.addOutlinedTexture(group,assets.mulliganAnnouncement,'ghost',L.banner,'Mulligan announcement');
      lab.addOutlinedTexture(group,assets.confirmMulliganButton,'ghost',L.confirmMulligan,'Confirm mulligan');
      lab.selectPreset('ghost');
      gsap.ticker.sleep();
      const effects=lab.ghostOutlines;
      const targets=effects.map(e=>e.target);
      async function capture(name){app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture',name)}
      for(const time of [0,1,3]){for(const e of effects)e.timeTween.totalTime(time,false);await capture('lab-idle-'+time)}
      check(effects.every(e=>group.getChildIndex(e.particles.container)<group.getChildIndex(e.target)&&group.getChildIndex(e.particles.foreground)>group.getChildIndex(e.target)),'gas stays behind artwork and light motes in front');
      const board=new Sprite(assets.board);board.width=1120;board.height=630;board.position.set(40,350);group.addChildAt(board,0);
      await capture('lab-board');
      for(const e of effects)e.disappear();
      check(effects[0].disappearance.duration()===.5 && effects[1].disappearance.duration()===1.7,'banner shrink and button evaporation have independent source timings');
      effects[1].disappearance.time(.1,false);
      check(effects[1].mist.filter.resources.ghostUniforms.uniforms.uOpacity===1,'button body stays opaque before the 0.2-second hide');
      const echo=effects[1].particles.foreground.getChildByLabel('ghost-mist.death-echo');
      check(echo.visible && echo.shader.resources.ghostUniforms.uniforms.uTint[3]>0,'Death plays the recovered blue echo curve');
      await capture('lab-death-0.1-seconds');
      effects[1].disappearance.time(.21,false);
      check(!echo.visible && effects[1].mist.filter.resources.ghostUniforms.uniforms.uOpacity===0,'body and echo hide when the evaporation starts');
      for(const time of [.1,.3,.6,1]){
        for(const e of effects)e.disappearance?.progress(time,false);
        await capture('lab-exit-'+time);
      }
      check(targets.every(t=>!t.visible),'disappearance hides targets');
      for(const e of effects)e.restore();
      check(targets.every(t=>t.visible),'restore shows targets');
      for(const e of effects){e.disappear();e.disappearance.progress(.4,false);e.restore()}
      check(targets.every(t=>t.parent===group),'interrupted disappearance restores parents');
      const exit=new Container();app.stage.addChild(exit);exit.position.set(30,20);exit.scale.set(.8);
      const before=targets[1].getGlobalTransform();effects[1].disappear(exit);
      const moved=targets[1].getGlobalTransform();check(Math.abs(before.tx-moved.tx)<.01&&Math.abs(before.ty-moved.ty)<.01,'closing-overlay transfer preserves screen position');
      effects[1].restore();exit.destroy();
      targets[1].alpha=.3;effects[1].syncVisibility();effects[1].particles.update(effects[1].lastTime);
      check(Math.abs(effects[1].particles.container.alpha-.3)<1e-6,'effect follows target opacity');targets[1].alpha=1;
      GhostAura.setDebugSuppressed(true);await capture('lab-suppressed');GhostAura.setDebugSuppressed(false);
      check(effects.every(e=>e.particles.container.visible&&e.particles.foreground.visible),'F3 restores both effect layers');
      for(const e of effects)e.dispose();
      check(targets.every(t=>!(t.filters?.length)),'dispose removes owned filters');
      check(group.children.every(c=>!c.label?.startsWith('ghost-mist.')),'dispose removes particle and exit layers');
      const instancesBefore=GhostAura.instances.size;
      prepareRewardGhostAura(app.renderer,assets);
      check(GhostAura.instances.size===instancesBefore,'menu shader warm-up releases its Ghost instance');
      const host=new Container(),exitHost=new Container();app.stage.addChild(host,exitHost);
      host.position.set(25,30);host.scale.set(.8);exitHost.position.set(12,18);exitHost.scale.set(.9);
      const animations=new AnimationScope();let confirmations=0;
      const mulligan=new GameMulliganView(assets,animations,{},()=>{confirmations++;mulligan.beginConfirmation([])},exitHost);
      host.addChild(mulligan.layer);mulligan.createLayer();mulligan.createControls();mulligan.enableSelection();
      const tap={button:0,stopPropagation(){}};
      mulligan.confirmButton.emit('pointertap',{...tap,button:2});
      check(confirmations===0,'mulligan ignores right clicks');
      mulligan.confirmButton.emit('pointertap',tap);mulligan.confirmButton.emit('pointertap',tap);
      check(confirmations===1 && mulligan.confirmMulliganOutline.disappearing,'mulligan confirms once and starts its exit');
      mulligan.rejectConfirmation();
      check(mulligan.confirmButton.parent===mulligan.layer && mulligan.confirmButton.eventMode==='static','rejected mulligan restores a clickable button');
      mulligan.showConfirmed(true);
      check(mulligan.opponentStillChoosing.visible && mulligan.opponentStillChoosingOutline.isEnabled(),'opponent-waiting Ghost remains usable');
      mulligan.dispose();animations.kill();
      const overlay=new CardSelectionOverlay({exitLayer:exitHost,renderer:app.renderer,ghostTextures:assets,toggleTexture:assets.toggleViewButton,cardBackTexture:Texture.WHITE,createSlot:async()=>{throw Error('unexpected card')},createHeroPowerChoice:()=>new Container(),onSelect(){},onChooseOption(){}});
      host.addChild(overlay);await overlay.showCards([]);
      overlay.toggle.emit('pointertap',tap);check(overlay.boardVisible,'Discover toggle still shows the board');
      overlay.toggle.emit('pointertap',tap);check(!overlay.boardVisible,'Discover toggle restores choices');
      const position=overlay.toggle.getGlobalPosition();overlay.clear();
      const departing=overlay.toggle.getGlobalPosition();
      check(Math.hypot(position.x-departing.x,position.y-departing.y)<.01,'closing Discover keeps its outgoing button at the same screen position');
      let cancellations=0;await overlay.showHandSelection([],'Choose a card',()=>cancellations++);
      const cancel=GAME_BOARD_LAYOUT.cardSelection.handSelection.cancelButton.position;
      check(overlay.toggle.parent===overlay && overlay.toggle.x===cancel.x && overlay.toggle.y===cancel.y,'reopening during exit applies the Cancel layout after restoration');
      overlay.toggle.emit('pointertap',tap);check(cancellations===1,'Cancel still invokes its caller');
      overlay.clear();await overlay.showCards([]);
      const normal=GAME_BOARD_LAYOUT.cardSelection.toggleButton.position;
      check(overlay.toggle.x===normal.x && overlay.toggle.y===normal.y,'returning from Cancel restores the Discover layout');
      overlay.toggleOutline.disappear(exitHost);overlay.toggleOutline.disappearance.time(.25,false);
      check(Math.abs(overlay.toggleOutline.textFade.filter.resources.ghostUniforms.uniforms.uOpacity-1/6)<.001,'separate button text follows the source 0.3-second linear fade');
      overlay.dispose();
      let saves=0,dismissals=0,saveErrors=0;
      const rewards=new ArenaRewardsView({runId:'ghost-check',wins:0,prizes:[]},assets,async()=>{saves++;if(saves===1)throw Error('expected save failure')},()=>saveErrors++,'ghost-check',()=>{dismissals++});
      host.addChild(rewards);
      const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
      rewards.confirm.emit('pointertap',tap);await flush();
      check(saveErrors===1 && rewards.confirm.eventMode==='static','failed reward save restores the confirmation button');
      rewards.confirm.emit('pointertap',tap);rewards.confirm.emit('pointertap',tap);await flush();
      check(saves===2 && rewards.confirmAura.disappearing,'reward confirmation saves once and runs Ghost evaporation');
      for(let i=0;i<5;i++){gsap.globalTimeline.time(gsap.globalTimeline.time()+2,false);await flush()}
      check(dismissals===1,'rewards dismiss after their exit finishes');
      rewards.dispose();host.destroy({children:true});exitHost.destroy({children:true});
      check(GhostAura.instances.size===instancesBefore,'all production Ghost consumers release their instances');
      lab.dispose();app.destroy(true,{children:true});
      return {checks,disappearanceSeconds:GHOST_DISAPPEARANCE_SECONDS};
    }
    run().then(r=>ipcRenderer.send('result',r)).catch(e=>ipcRenderer.send('result',{checks,error:e.stack}));
  `
  await require('esbuild').build({
    stdin: { contents: source, loader: 'ts', resolveDir: root },
    outfile: path.join(output, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    external: ['electron'],
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.woff2': 'dataurl',
      '.ttf': 'dataurl'
    },
    alias: { '@assets': path.join(root, 'assets') },
    define: {
      'import.meta.env.DEV': 'true',
      'import.meta.glob': '__unusedCardArtwork'
    },
    banner: { js: 'const __unusedCardArtwork = () => ({});' },
    logLevel: 'error'
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><body style="margin:0;overflow:hidden"><style>canvas{width:1280px;height:720px;display:block}</style><script src="renderer.js"></script>'
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(require('electron'), [__filename], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
