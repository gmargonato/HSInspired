/** Real isolated WebGL playback; screenshots/report stay under ignored .tmp. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'vfx-phase-two-check')

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      useContentSize: true,
      webPreferences: {
        preload: path.join(output, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    const timer = setTimeout(() => app.exit(1), 300000)
    ipcMain.handle('capture', async (_event, name) => {
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    })
    ipcMain.once('result', (_event, result) => {
      clearTimeout(timer)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(result, null, 2)
      )
      console.log(JSON.stringify(result, null, 2))
      app.exit(result.error ? 1 : 0)
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error' || details.message.includes('PixiJS Warning'))
        console.error(details.message)
    })
    await window.loadFile(path.join(output, 'index.html'))
    return
  }
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(
    path.join(output, 'preload.cjs'),
    `
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('vfxCapture', {
      invoke: (channel, name) => channel === 'capture' ? ipcRenderer.invoke(channel, name) : Promise.reject(new Error('Unsupported capture channel')),
      send: (channel, result) => { if (channel === 'result') ipcRenderer.send(channel, result); }
    });
  `
  )
  const { build } = require('esbuild')
  const urls = {}
  const authored = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src/visual-components/effects/fireball-authored.json')
    )
  )
  const names = new Set(
    Object.values(authored.materials).flatMap((material) =>
      Object.values(material.textures).map((texture) => texture.asset)
    )
  )
  for (const name of names) {
    const key =
      'fireball' +
      name
        .split('-')
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join('')
    urls[key] =
      'data:image/png;base64,' +
      fs
        .readFileSync(
          path.join(root, 'assets/images/effects/fireball-' + name + '.png')
        )
        .toString('base64')
  }
  for (const [key, name] of [
    ['WispAtlas', 'wisp-atlas'],
    ['DarkWisp', 'dark-wisp'],
    ['Smoke', 'smoke'],
    ['ColorRamp', 'color-ramp'],
    ['Embers', 'embers'],
    ['GlowMaskOpponent', 'glow-mask-opponent'],
    ['GlowMaskFriendly', 'glow-mask-friendly'],
    ['GlowMaskFull', 'glow-mask-full'],
    ['ImpactBurst', 'impact-burst'],
    ['ImpactSpark', 'impact-spark']
  ])
    urls['fireAoe' + key] =
      'data:image/png;base64,' +
      fs
        .readFileSync(
          path.join(root, 'assets/images/effects/fire-aoe-' + name + '.png')
        )
        .toString('base64')
  for (const [key, name] of [
    ['burnNoise', 'noise-01.jpg'],
    ['playSpotlight1', 'spotlight-01.png'],
    ['ghostSpotlight', 'spotlight-triangle.png']
  ])
    urls[key] =
      'data:image/' +
      (name.endsWith('.jpg') ? 'jpeg' : 'png') +
      ';base64,' +
      fs.readFileSync(path.join(root, 'assets/images/effects', name)).toString('base64')
  urls.boardBase =
    'data:image/png;base64,' +
    fs.readFileSync(path.join(root, 'assets/images/table/board.png')).toString('base64')
  const source = `
    import { Application, Assets, Sprite } from 'pixi.js';
    import { gsap } from 'gsap';
    import { MatchVfxPresenter, matchVfxAreas } from './src/scenes/match/presentation/match-vfx-presenter';
    import { GAME_BOARD_LAYOUT } from './src/scenes/match/game-scene-layout';
    import { VfxLab } from './src/dev-tools/vfx-lab/vfx-lab';
    import { getVfxTemplateLibrary } from './src/visual-components/effects/vfx-templates';
    const ipcRenderer=window.vfxCapture;const checks=[];const frames=[];
    function check(value,message){if(!value)throw Error(message);checks.push(message)}
    async function run(){
      const app=new Application();await app.init({width:1920,height:1080,resolution:1,preference:'webgl',autoStart:false,preserveDrawingBuffer:true,backgroundColor:0x554638});
      document.body.append(app.canvas);
      const gl=app.renderer.gl; check(!!gl,'Real WebGL renderer is required; Canvas fallback cannot validate shader visuals'); const debug=gl.getExtension('WEBGL_debug_renderer_info');
      const gpu={version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),unmasked:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null};
      console.log('VFX renderer '+JSON.stringify(gpu));
      const assets=Object.fromEntries(await Promise.all(Object.entries(${JSON.stringify(urls)}).map(async([key,url])=>[key,await Assets.load(url)])));

      if (${process.env.VFX_GAMEPLAY_CHECK === '1'}) {
        const board=new Sprite(assets.boardBase);board.width=1920;board.height=1080;app.stage.addChild(board);
        const library=getVfxTemplateLibrary();
        const fixtures=[['mage-hero-power','fire-missile-small'],['pyroblast','fire-missile-large'],['darkbomb','shadow-missile-small'],['arcane-missiles','arcane-missile-small'],['frostbolt','frost-missile-small'],['felfire-potion','fel-blast-all-characters'],['blizzard','frost-blast-enemy-board'],['holy-nova','holy-blast-enemy-side'],['arcane-explosion','shadow-blast-enemy-board']];
        const source=GAME_BOARD_LAYOUT.heroes.local.position,target=GAME_BOARD_LAYOUT.heroes.remote.position;
        for(const [card,id] of fixtures){
          const template=library.templates.find(t=>t.id===id);check(!!template,card+' resolves a real saved template');
          const timeline=gsap.timeline({paused:true});const presenter=new MatchVfxPresenter(assets,()=>timeline,app.renderer);app.stage.addChild(presenter.layer);
          const affected=template.family==='aoe'?[{...target,kind:'hero'},{x:780,y:365,kind:'minion'},{x:1060,y:365,kind:'minion'},...(id.includes('all-characters')?[{...source,kind:'hero'},{x:780,y:645,kind:'minion'}]:[])]:[];
          let released=false;const pending=presenter.play(template,true,source,target,affected).then(()=>released=true);
          const cue=template.family==='missile'?(template.tuning.launchDelayMs??1000)/1000+template.tuning.durationMs/1000:(template.tuning.impactMs??500)/1000;
          const mid=template.family==='missile'?(template.tuning.launchDelayMs??1000)/1000+template.tuning.durationMs/1000*.7:.4;
          timeline.time(mid,false);app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','match-'+card+'-mid');
          frames.push({id,card,phase:'match-mid',time:mid,file:'match-'+card+'-mid.png'});
          timeline.time(cue-.001,false);await Promise.resolve();check(!released,card+' queue remains blocked before real impact');
          timeline.time(cue,false);await pending;check(released,card+' queue releases exactly at impact '+cue);check(presenter.layer.children.length===1,card+' tail survives cue release');
          timeline.time(cue+.08,false);app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','match-'+card+'-impact');frames.push({id,card,phase:'match-impact',time:cue+.08,file:'match-'+card+'-impact.png'});
          check(gl.getError()===gl.NO_ERROR,card+' live presenter renders without WebGL errors');
          timeline.progress(1,false);check(!presenter.layer.children.length,card+' presenter cleans all visuals after tail');presenter.dispose();app.stage.removeChild(presenter.layer);presenter.layer.destroy();
          if(template.family==='aoe')check(matchVfxAreas(template.zones,true).length===matchVfxAreas(template.zones,false).length,card+' opponent orientation preserves coverage count');
        }
        const groupTimelines=[],group=new MatchVfxPresenter(assets,()=>{const t=gsap.timeline({paused:true});groupTimelines.push(t);return t;},app.renderer);app.stage.addChild(group.layer);
        const medium=library.templates.find(t=>t.id==='fire-missile');let groupReleased=false;
        const groupPending=Promise.all([-120,0,120].map(offset=>group.play(medium,true,source,{x:target.x+offset,y:365}))).then(()=>groupReleased=true);
        groupTimelines.forEach(t=>t.time(1.399,false));await Promise.resolve();check(!groupReleased,'Explosive Shot simultaneous group cannot release early');
        groupTimelines[0].time(1.4,false);await Promise.resolve();check(!groupReleased,'one completed impact cannot release group');
        groupTimelines.slice(1).forEach(t=>t.time(1.4,false));await groupPending;check(groupReleased,'group releases only after all impacts');group.dispose();check(!group.layer.children.length,'group disposal cleans all three tails');app.stage.removeChild(group.layer);group.layer.destroy();
        const stopTimeline=gsap.timeline({paused:true}),stop=new MatchVfxPresenter(assets,()=>stopTimeline,app.renderer);const stopped=stop.play(medium,true,source,target);stop.dispose();await stopped;check(!stop.layer.children.length,'interrupted presenter releases pending cue and cleans up');stop.layer.destroy();
        app.destroy(true,{children:true});return {checks,frames,gpu,mode:'actual-match-presenter'};
      }
      const lab=new VfxLab({canvas:app.canvas,renderer:app.renderer,parent:document.body,assets});app.stage.addChild(lab);lab.controls.updatePosition();
      const templates=getVfxTemplateLibrary().templates.filter(t=>t.family==='missile'||t.id.endsWith('-all-characters'));
      check(templates.length===14,'Exactly nine missile and five AoE visual appearances');
      for(const template of templates){
        lab.selectEffect(template.family);lab.selectTemplate(template.id);
        const effect=template.family==='missile'?lab.missileEffect:lab.fireEffect;
        const launch=effect.launchSeconds||0,flight=template.tuning.durationMs/1000;
        const times=template.family==='missile'?[Math.max(.02,launch*.6),launch+flight*.3,launch+flight*.7,effect.impactSeconds+.08]:[.15,.5,.9,1.4,2,Math.min(effect.duration-.05,2.8)];
        const labels=template.family==='missile'?['start','flight-early','flight-late','impact']:['start','ignition','peak','active','fade','tail'];
        for(let i=0;i<times.length;i++){
          while(lab.elapsedMS<times[i]*1000 && lab.playing)lab.update(Math.min(50,times[i]*1000-lab.elapsedMS));
          const began=performance.now();app.renderer.render(app.stage);const renderMs=performance.now()-began;
          await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          const name=template.id+'-'+labels[i];await ipcRenderer.invoke('capture',name);
          frames.push({id:template.id,phase:labels[i],time:times[i],renderMs,file:name+'.png'});
          check(gl.getError()===gl.NO_ERROR,name+' renders without WebGL errors');
        }
        lab.update(effect.duration*1000);
      }
      lab.dispose();lab.destroy({children:true});app.destroy(true,{children:true});
      return {checks,frames,gpu};
    }
    run().then(result=>ipcRenderer.send('result',result)).catch(error=>ipcRenderer.send('result',{checks,frames,error:error.stack}));
  `
  await build({
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
    logLevel: 'error'
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html><body style="margin:0;overflow:hidden"><style>canvas{width:1920px;height:1080px;display:block}</style><script src="renderer.js"></script></body></html>'
  )
  if (process.env.VFX_BUILD_ONLY === '1') return
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
