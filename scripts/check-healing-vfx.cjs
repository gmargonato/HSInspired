/** Isolated WebGL validation. Does not launch the game or a development server.
 * Outputs frame captures and a report under ignored .tmp/healing-check.
 */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'healing-check')

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 960,
      height: 540,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    const timer = setTimeout(() => {
      console.error('Healing GPU check timed out')
      app.exit(1)
    }, 60000)
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    ipcMain.handle('heal-screenshot', async (_event, name) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      const capture = await window.webContents.capturePage()
      const folder = /aoe|mass/.test(name) ? 'aoe' : 'missile'
      fs.writeFileSync(path.join(output, folder, name + '.png'), capture.toPNG())
    })
    ipcMain.once('heal-result', (_event, result) => {
      clearTimeout(timer)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(result, null, 2)
      )
      console.log(JSON.stringify(result, null, 2))
      app.exit(result.error ? 1 : 0)
    })
    await window.loadFile(path.join(output, 'index.html'))
    return
  }
  fs.mkdirSync(output, { recursive: true })
  for (const folder of ['aoe', 'missile'])
    fs.mkdirSync(path.join(output, folder), { recursive: true })
  const { build } = require('esbuild')
  const entries = [
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
  ]
  const urls = Object.fromEntries(
    entries.map(([key, name]) => [
      'fireAoe' + key,
      'data:image/png;base64,' +
        fs
          .readFileSync(
            path.join(root, 'assets/images/effects/fire-aoe-' + name + '.png')
          )
          .toString('base64')
    ])
  )
  const fireballAuthored = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src/visual-components/effects/fireball-authored.json')
    )
  )
  const fireballNames = new Set(
    Object.values(fireballAuthored.materials).flatMap((material) =>
      Object.values(material.textures).map((texture) => texture.asset)
    )
  )
  for (const name of fireballNames) {
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
  urls.boardBase =
    'data:image/png;base64,' +
    fs.readFileSync(path.join(root, 'assets/images/table/board.png')).toString('base64')
  const healing = JSON.parse(
    fs.readFileSync(
      path.join(root, 'src/visual-components/effects/healing-authored.json')
    )
  )
  for (const [key, entry] of Object.entries(healing.textures))
    urls[key] =
      'data:image/png;base64,' +
      fs.readFileSync(path.join(root, 'assets', entry.file)).toString('base64')
  const source = `
    import { Application, Assets, Sprite, Container } from 'pixi.js';
    import { VFX_LAB_LAYOUT } from './src/dev-tools/vfx-lab/vfx-lab-layout';
    import { applyAnchoredPlacement } from './src/visual-components/layout';
    import { HealingEffect } from './src/visual-components/effects/healing-effect';
    import { MatchVfxPresenter } from './src/scenes/match/presentation/match-vfx-presenter';
    import { gsap } from 'gsap';
    import { DEFAULT_HEALING_TUNING, parseVfxTemplateLibrary } from './src/desktop/contracts/ipc/vfx-templates';
    import { VfxLab } from './src/dev-tools/vfx-lab/vfx-lab';
    import { healingPreview } from './src/dev-tools/vfx-lab/healing-preview';
    import { DEFAULT_VFX_LAB_SETTINGS, settingsFromTemplate, templateFromSettings } from './src/dev-tools/vfx-lab/vfx-lab-model';
    import rawLibrary from './config/vfx-templates.json';
    const {ipcRenderer}=require('electron'); const fs=require('node:fs'); const checks=[];
    function check(v,message){if(!v)throw new Error(message);checks.push(message)}
    async function run(){
      const app=new Application();await app.init({width:960,height:540,resolution:1,preference:'webgl',preserveDrawingBuffer:true,autoStart:false});document.body.append(app.canvas);
      const assets={};for(const [key,url]of Object.entries(${JSON.stringify(urls)})) assets[key]=await Assets.load(url);
      const stage=new Container();stage.scale.set(.5);app.stage.addChild(stage);const board=new Sprite(assets.boardBase);applyAnchoredPlacement(board,VFX_LAB_LAYOUT.board);stage.addChild(board);
      const library=parseVfxTemplateLibrary(rawLibrary);check(library.version===1,'v1 library retained');
      const settings={...DEFAULT_VFX_LAB_SETTINGS,enemyBoard:false,enemyHero:false,friendlyBoard:true,friendlyHero:true,previewMinions:7};
      let p=healingPreview(settings,new Set());check(p.recipients.length===8,'friendly side has 7 minions and hero');
      const flip=healingPreview({...settings,opponentCaster:true},new Set());check(flip.recipients[0].y!==p.recipients[0].y,'caster orientation flips coverage');
      check(healingPreview(settings,new Set(['friendlyBoard-0'])).recipients.length===7,'recipient exclusion');
      check(healingPreview({...settings,previewMinions:0,friendlyHero:false},new Set()).recipients.length===0,'empty board');
      check(healingPreview({...settings,enemyBoard:true,enemyHero:true},new Set()).recipients.length===16,'all characters');
      for(const template of library.templates.filter(t=>t.family.startsWith('heal'))){const s=settingsFromTemplate(template,true);const saved=templateFromSettings(template,s);check(JSON.stringify(saved)===JSON.stringify(template),'healing preset roundtrip '+template.family);check(!('impactShake' in saved.tuning),'healing has no shake');}
      app.render(); const baseline=app.canvas.toDataURL();const frames=[];
      const healTemplate=library.templates.find(t=>t.id==='heal-target');const adjusted=settingsFromTemplate(healTemplate,true);Object.assign(adjusted,{healTrailDensity:2,healTrailSize:1.5,healBloomStrength:2.5});const roundtrip=parseVfxTemplateLibrary({version:1,templates:[templateFromSettings(healTemplate,adjusted)]}).templates[0];check(roundtrip.tuning.trailDensity===2&&roundtrip.tuning.trailSize===1.5&&roundtrip.tuning.bloomStrength===2.5,'new healing sliders survive save and reload');
      for(const invalid of [{intensity:0},{density:3},{tint:'bad'},{timingScale:NaN}]){let rejected=false;try{parseVfxTemplateLibrary({version:1,templates:[{id:'invalid',name:'Invalid',family:'heal-target',tuning:{...DEFAULT_HEALING_TUNING,...invalid}}]})}catch{rejected=true}check(rejected,'invalid healing tuning rejected '+Object.keys(invalid)[0]);}
      const full=new HealingEffect(assets,{family:'heal-aoe',tuning:{...DEFAULT_HEALING_TUNING,density:2},...healingPreview({...settings,enemyBoard:true,enemyHero:true},new Set())});stage.addChild(full.container);full.update(.4);app.render();full.dispose();check(true,'all 16 recipients render at maximum density');
      async function capture(name,effect,time){effect.update(time);app.render();const encoded=app.canvas.toDataURL();if(name.endsWith('travel'))check(encoded!==baseline,'visible pixels '+name);const data=encoded.split(',')[1];fs.writeFileSync(${JSON.stringify(output)}+'/'+(name.includes('aoe')?'aoe':'missile')+'/'+name+'.png',Buffer.from(data,'base64'));frames.push(name);}
      for(const family of ['heal-aoe','heal-target']){
        const effect=new HealingEffect(assets,{family,tuning:DEFAULT_HEALING_TUNING,...p,source:VFX_LAB_LAYOUT.missile.source.position,target:VFX_LAB_LAYOUT.missile.target.position});stage.addChild(effect.container);
        if(family==='heal-aoe'){
          const shock=effect.streams.find(s=>s.node.name==='Shockwave');effect.update(.4);const before=Array.from(shock.mesh.colors.slice(0,4));const delay=shock.node.particle.delay.max;shock.node.particle.delay.max+=.2;effect.update(.6);check(before.every((v,i)=>Math.abs(v-shock.mesh.colors[i])<.00001),'start delay does not advance the particle color curve');shock.node.particle.delay.max=delay;effect.update(.4);
          const rays=effect.streams.find(s=>s.node.name==='Rays').mesh.positions;const w=Math.hypot(rays[2]-rays[0],rays[3]-rays[1]),h=Math.hypot(rays[4]-rays[2],rays[5]-rays[3]);check(Math.abs(w/h-1)<.001,'mass rays retain square billboard proportions');
        }
        for(const [name,t]of [['launch',.15],['travel',.4],['impact',effect.impactSeconds],['fade',effect.duration-.5]])await capture(family+'-'+name,effect,t);
        effect.update(effect.duration);check(!effect.container.visible,'effect ends '+family);effect.update(.4);app.render();const a=app.canvas.toDataURL();effect.update(.1);effect.update(.4);app.render();check(a===app.canvas.toDataURL(),'deterministic seek '+family);effect.dispose();effect.dispose();
      }
      for(const [source,target,bloomOnly]of [[{x:500,y:500},{x:500,y:500},false],[{x:500,y:500},{x:510,y:500},false],[{x:100,y:900},{x:1800,y:100},false],[{x:500,y:500},{x:800,y:500},true]]){
        const e=new HealingEffect(assets,{family:'heal-target',tuning:{...DEFAULT_HEALING_TUNING,bloomOnly},source,target});stage.addChild(e.container);e.update(.8);app.render();check(Number.isFinite(e.duration),'target distance/bloom-only valid');e.dispose();
      }
      // Real renderer frames, sampled at fixed times; contact sheets make motion readable.
      for(const [folder,family,times] of [
        ['aoe','heal-aoe',[0,.1,.2,.35,.5,.65,.8,1,1.3,1.6,2,2.6]],
        ['missile','heal-target',[0,.1,.2,.3,.4,.55,.7,.85,1,1.3,1.8,2.6]]
      ]){
        const dir=${JSON.stringify(output)}+'/'+folder;fs.mkdirSync(dir,{recursive:true});
        const preview=healingPreview({...settings,previewMinions:3},new Set());
        const template=library.templates.find(t=>t.id===(folder==='aoe'?'heal-mass':'heal-target'));
        const effect=new HealingEffect(assets,{family,tuning:template.tuning,...preview,source:VFX_LAB_LAYOUT.missile.source.position,target:VFX_LAB_LAYOUT.missile.target.position});stage.addChild(effect.container);
        const crop=folder==='aoe'?{x:120,y:200,w:650,h:300}:{x:230,y:0,w:360,h:540};
        const sheet=document.createElement('canvas');sheet.width=crop.w*3;sheet.height=(crop.h+36)*4;const ctx=sheet.getContext('2d');ctx.fillStyle='#171c25';ctx.fillRect(0,0,sheet.width,sheet.height);
        for(const [index,time] of times.entries()){
          effect.update(time);app.render();const name=String(index+1).padStart(2,'0')+'-'+time.toFixed(2)+'s.png';
          fs.writeFileSync(dir+'/'+name,Buffer.from(app.canvas.toDataURL().split(',')[1],'base64'));
          const x=(index%3)*crop.w,y=Math.floor(index/3)*(crop.h+36);ctx.drawImage(app.canvas,crop.x,crop.y,crop.w,crop.h,x,y+36,crop.w,crop.h);ctx.fillStyle='#ffffff';ctx.font='18px sans-serif';ctx.fillText((folder==='aoe'?'AOE':'MISSILE')+'   '+time.toFixed(2)+' s',x+14,y+25);
        }
        effect.update(.35);
        const ring=effect.streams.find(s=>s.kind==='bloom'&&s.node.name==='fx_build_runeCircle');
        effect.update((folder==='aoe'?.35:1.05)*template.tuning.timingScale);const points=ring.mesh.positions;const w=Math.hypot(points[2]-points[0],points[3]-points[1]),h=Math.hypot(points[4]-points[2],points[5]-points[3]);check(w>0&&h>0&&Math.abs(w/h-1)<.001,'recipient rune circle is circular '+folder);
        if(folder==='missile'){
          const glows=effect.streams.filter(s=>s.kind==='target'&&s.node.name==='fx_glow');check(glows.length===1&&glows[0].births.length===1&&!glows[0].moving,'exactly one fixed source glow, no trail beads');
          const glow=glows[0];for(const time of [.1,.35,.6]){effect.update(time*template.tuning.timingScale);const q=glow.mesh.positions;check(Math.hypot((q[0]+q[4])/2-VFX_LAB_LAYOUT.missile.source.position.x,(q[1]+q[5])/2-VFX_LAB_LAYOUT.missile.source.position.y)<.001,'source glow remains anchored at '+time);check(glow.mesh.colors[3]>0,'source glow visible during flight '+time)}effect.update(.7*template.tuning.timingScale);check(glow.mesh.colors[3]===0,'source glow fades by arrival');
          const head=effect.streams.find(s=>s.kind==='target'&&s.node.name==='fx_star');check(head.births.length===1,'one moving missile head');effect.update(.35*template.tuning.timingScale);const pos=head.mesh.positions;const center={x:(pos[0]+pos[4])/2,y:(pos[1]+pos[5])/2},expected=effect.path(.35);check(Math.hypot(center.x-expected.x,center.y-expected.y)<.001,'missile head follows current flight position');
          const sparse=new HealingEffect(assets,{family,tuning:{...template.tuning,trailDensity:0},source:VFX_LAB_LAYOUT.missile.source.position,target:VFX_LAB_LAYOUT.missile.target.position});check(!sparse.streams.some(s=>s.node.name==='fx_motes'||s.node.name==='fx_stars'),'trail count slider can remove sparks without removing head');sparse.dispose();
          const bold=new HealingEffect(assets,{family,tuning:{...template.tuning,trailSize:2,bloomStrength:2},source:VFX_LAB_LAYOUT.missile.source.position,target:VFX_LAB_LAYOUT.missile.target.position});stage.addChild(bold.container);bold.update(.4);app.render();check(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,'larger particles and stronger bloom render');bold.dispose();
        }
        fs.writeFileSync(dir+'/timelapse.png',Buffer.from(sheet.toDataURL().split(',')[1],'base64'));effect.dispose();check(true,'twelve timestamped frames and contact sheet '+folder);
      }
      let timeline;let shakes=0;const presenter=new MatchVfxPresenter(assets,()=>timeline=gsap.timeline({paused:true}),app.renderer,()=>shakes++,assets);stage.addChild(presenter.layer);
      for(const id of ['heal-mass','heal-target']){
        const template=library.templates.find(t=>t.id===id);let impacted=false;
        const pending=presenter.play(template,true,{x:950,y:850},{x:950,y:645},p.recipients).then(()=>impacted=true);
        timeline.time(.1);await Promise.resolve();check(!impacted,'match waits for healing impact '+id);
        timeline.time(id==='heal-target'?1.3:.6);await Promise.resolve();check(impacted,'match releases at healing impact '+id);
        app.render();await ipcRenderer.invoke('heal-screenshot','match-presenter-'+id);
        timeline.progress(1);await pending;check(presenter.layer.children.length===0,'match healing tail disposed '+id);
      }
      const interrupted=presenter.play(library.templates.find(t=>t.id==='heal-target'),true,{x:950,y:850},{x:950,y:645});presenter.dispose();await interrupted;check(shakes===0,'match healing never shakes board');check(!assets['heal-rays'].destroyed,'match disposal retains bundle textures');
      stage.removeChildren();const lab=new VfxLab({canvas:app.canvas,renderer:app.renderer,parent:document.body,assets,healingAssets:assets});stage.addChild(lab);
      lab.selectEffect('heal-aoe');for(let step=0;step<4;step++)lab.update(100);app.render();await ipcRenderer.invoke('heal-screenshot','mass-heal-lab');check(!!lab.healingEffect,'lab mass healing available');lab.changeSetting('opponentCaster',true);lab.changeSetting('previewMinions',0);lab.play();lab.update(200);app.render();
      lab.selectEffect('heal-target');for(let step=0;step<4;step++)lab.update(100);app.render();await ipcRenderer.invoke('heal-screenshot','target-heal-lab');check(!!lab.healingEffect,'lab target healing available');lab.paused=true;const before=lab.elapsedMS;lab.update(100);check(lab.elapsedMS===before,'pause freezes elapsed time');lab.play();for(let step=0;step<4;step++)lab.update(100);app.render();
      lab.resetHealing();check(lab.settings.healIntensity===1,'reset restores healing defaults');let saved;window.api={vfxTemplates:{save:async value=>{saved=value}}};await lab.saveTemplates();check(saved?.templates.some(t=>t.family==='heal-target'),'save sends healing templates through desktop bridge');check(!JSON.stringify(saved).includes('opponentCaster'),'preview orientation not persisted');lab.selectEffect('aoe');check(!lab.healingEffect&&!!lab.fireEffect,'switching back to damage releases healing');lab.selectEffect('missile');check(!!lab.missileEffect,'damage missile still available');lab.dispose();lab.destroy({children:true});
      check(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,'no WebGL errors');check(!assets['heal-rays'].destroyed,'shared textures survive disposal');app.destroy(true,{children:true});return {checks,frames};
    }
    run().then(r=>ipcRenderer.send('heal-result',r)).catch(e=>ipcRenderer.send('heal-result',{checks,error:e.stack}));
  `
  await build({
    stdin: { contents: source, loader: 'ts', resolveDir: root },
    outfile: path.join(output, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    external: ['electron', 'node:fs'],
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
    '<!doctype html><html><body style="margin:0;overflow:hidden"><script src="renderer.js"></script></body></html>'
  )
  const { spawn } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename], {
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
