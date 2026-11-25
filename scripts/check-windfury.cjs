/** Isolated native Windfury shader, lifecycle and capture checks. No game/server. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(
  root,
  '.tmp',
  process.env.WINDFURY_CAPTURE_SEQUENCE
    ? 'windfury-check-' + process.env.WINDFURY_CAPTURE_SEQUENCE
    : 'windfury-check'
)
async function main() {
  fs.mkdirSync(output, { recursive: true })
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'profile'))
    await app.whenReady()
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      }
    })
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    const timer = setTimeout(() => app.exit(1), 60000)
    ipcMain.handle('capture', async (_, name) =>
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await win.webContents.capturePage()).toPNG()
      )
    )
    ipcMain.handle('sequence', async (_, frame, data) => {
      const folder = path.join(
        output,
        'sequence-' + process.env.WINDFURY_CAPTURE_SEQUENCE
      )
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(
        path.join(folder, String(frame).padStart(4, '0') + '.png'),
        Buffer.from(data.split(',')[1], 'base64')
      )
    })
    ipcMain.once('result', (_, result) => {
      clearTimeout(timer)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(result, null, 2)
      )
      console.log(JSON.stringify(result))
      app.exit(result.error ? 1 : 0)
    })
    await win.loadFile(path.join(output, 'index.html'))
    return
  }
  const urls = Object.fromEntries(
    ['wind', 'mote'].map((k) => [
      k,
      'data:image/png;base64,' +
        fs
          .readFileSync(path.join(root, 'assets/images/effects/windfury-' + k + '.png'))
          .toString('base64')
    ])
  )
  const labFiles = {
    minionFrame: 'board/minion-frame.png',
    minionAttack: 'board/minion-attack.png',
    minionHealth: 'board/minion-health.png',
    heroFrame: 'heroes/frames/mage-jaina-frame.png',
    artwork: 'card-artwork/basic_chillwind_yeti.png'
  }
  for (const [key, file] of Object.entries(labFiles))
    urls[key] =
      'data:image/png;base64,' +
      fs.readFileSync(path.join(root, 'assets/images', file)).toString('base64')
  const source = `
import {Application,Assets,Cache,Graphics,Texture,RenderTexture,Mesh,MeshGeometry,Shader,Buffer,BufferUsage} from 'pixi.js';
import {gsap} from 'gsap';
import {AssetScope,registerAssetBundle} from './src/visual-components/assets/asset-scope';
import {OutlineLabBoard} from './src/dev-tools/outline-lab/outline-lab-board';
import {WindfuryEffect} from './src/scenes/match/board/windfury-effect';
import {windVertex,windFragment,windValue} from './src/visual-components/effects/windfury-material';
import {GhostMaterialMesh} from './src/visual-components/effects/ghost-materials';
import {WINDFURY_DEFAULTS} from './src/desktop/contracts/ipc/windfury-tuning';
const {ipcRenderer}=require('electron');const checks=[];const captureMode=${JSON.stringify(process.env.WINDFURY_CAPTURE_SEQUENCE || '')};
function check(ok,message){if(!ok)throw Error(message);checks.push(message)}
async function run(){
 const app=new Application();await app.init({width:1200,height:800,preference:'webgl',autoStart:false,backgroundColor:0x302b28,antialias:true});document.body.append(app.canvas);
 registerAssetBundle('windfury-check',{windfuryWind:${JSON.stringify(urls.wind)},windfuryMote:${JSON.stringify(urls.mote)},...${JSON.stringify(Object.fromEntries(Object.keys(labFiles).map((k) => [k, urls[k]])))}});
 const scope=new AssetScope(),textures=await scope.acquire('windfury-check');
 check(!Cache.has('windfuryWind')&&!Cache.has('windfuryMote'),'production bundle aliases remain qualified');
 check(Cache.has('windfury-check:windfuryWind'),'qualified wind texture is loaded');
 check(Math.abs(windValue([[0,0,0,0],[1,1,0,0]],.25)-.15625)<1e-8,'cubic tangents preserved');
 const geo=new MeshGeometry({positions:new Float32Array([0,0,16,0,16,16,0,0,16,16,0,16]),uvs:new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]),indices:new Uint32Array([0,1,2,3,4,5])});
 geo.addAttribute('aWind',{buffer:new Buffer({data:new Float32Array(12).fill(1),usage:BufferUsage.VERTEX}),format:'float32x2'});
 geo.addAttribute('aColor',{buffer:new Buffer({data:new Float32Array(18).fill(1),usage:BufferUsage.VERTEX}),format:'float32x3'});
 geo.addAttribute('aBarycentric',{buffer:new Buffer({data:new Float32Array([1,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0,0,1]),usage:BufferUsage.VERTEX}),format:'float32x3'});
 geo.addAttribute('aBoundary',{buffer:new Buffer({data:new Float32Array([1,0,1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,0]),usage:BufferUsage.VERTEX}),format:'float32x3'});geo.batchMode='no-batch';
 const shader=Shader.from({gl:{vertex:windVertex,fragment:windFragment},resources:{uWind:Texture.WHITE.source,probe:{uScroll:{value:new Float32Array(2),type:'vec2<f32>'},uST:{value:new Float32Array([1,1,0,0]),type:'vec4<f32>'},uMaterialColor:{value:new Float32Array([.5,.5,.5,.1]),type:'vec4<f32>'},uTint:{value:new Float32Array([1,1,1]),type:'vec3<f32>'},uWidth:{value:.1,type:'f32'},uScale:{value:1,type:'f32'},uIntensity:{value:2,type:'f32'},uFresnelIntensity:{value:15,type:'f32'},uFresnelAlpha:{value:1,type:'f32'},uOpacity:{value:1,type:'f32'},uSide:{value:1,type:'f32'},uEdgeFeather:{value:2,type:'f32'}}}});
 const probe=new Mesh({geometry:geo,shader});probe.blendMode='add';const target=RenderTexture.create({width:16,height:16});
 app.renderer.render({container:probe,target,clear:true});const p=app.renderer.extract.pixels(target).pixels;
 const gp=app.renderer.shader._getProgramData(shader.glProgram).program;
 check(app.renderer.gl.getProgramParameter(gp,app.renderer.gl.LINK_STATUS),'Windfury shader compiles successfully');
 // f=.5, RGB=1*.5*2*.5*15*.5, then source alpha=.25: 0.9375.
 check(Math.abs(p[(8*16+8)*4]-239)<=3,'native Fresnel and SrcAlpha contribution match independent pixel oracle (red='+p[(8*16+8)*4]+')');
 if(captureMode!=='before'){
 check(p[(8*16)*4]>0&&p[(8*16)*4]<150,'mesh boundary fades while the material interior preserves source brightness');
 const dw=geo.getBuffer('aWind');for(let i=1;i<dw.data.length;i+=2)dw.data[i]=0;dw.update();
 shader.resources.probe.uniforms.uSide=1;app.renderer.render({container:probe,target,clear:true});const half=app.renderer.extract.pixels(target).pixels[(8*16+8)*4];
 shader.resources.probe.uniforms.uSide=-1;app.renderer.render({container:probe,target,clear:false});const whole=app.renderer.extract.pixels(target).pixels[(8*16+8)*4];
 check(Math.abs(half-120)<=3&&Math.abs(whole-239)<=3,'soft front/rear split preserves the combined additive contribution');
 }
 const mote=new GhostMaterialMesh(Texture.WHITE,Texture.WHITE,1,2,[.67,.67,.67,1]);mote.quad(0,8,8,16,16,0,[.15,.15,.15,.7]);mote.upload();mote.blendMode='none';
 app.renderer.render({container:mote,target,clear:true});const mp=app.renderer.extract.pixels(target).pixels;check(Math.abs(mp[(8*16+8)*4]-Math.round(2*.67*.15*2*.7*255))<=3,'mote shader matches recovered additive material contribution');mote.destroy();
 probe.destroy();geo.destroy();shader.destroy();target.destroy(true);
 const effects=[];
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
 const width=row?230:180,height=row?289:193,x=210+col*390,y=210+row*350;
 const e=new WindfuryEffect({position:{x,y},size:{width,height},anchor:{x:.5,y:.5},scale:1},row?'hero.windfury':'minion.windfury',textures);e.setEnabled(true);effects.push(e);
 app.stage.addChild(e.rear);app.stage.addChild(new Graphics().ellipse(x,y,width*.43,height*.43).fill(0x514a45).stroke({color:0x917e65,width:5}));app.stage.addChild(e.front);
 e.loop.totalTime([.5,1.1,3.8][col],false);
 }
 gsap.ticker.sleep();async function capture(name){if(captureMode)return;app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture',name)}
 await capture('native-curls');
 for(let i=0;i<effects.length;i++)effects[i].loop.totalTime([1.6,2,2.5][i%3],false);await capture('idle-curls');
 for(const effect of effects)effect.loop.totalTime(39.25,false);check(effects.every(e=>e.curls.filter(c=>!c.burst).every(c=>c.mesh.visible)),'both idle clocks survive the combined cycle');
 check(effects.every(e=>e.curls.length===14),'two idle and five burst meshes have front/rear passes');
 const e=effects[0];e.setTuning({...WINDFURY_DEFAULTS,speed:0});check(e.loop.timeScale()===0,'zero speed pauses');
 const phase=e.loop.totalTime();e.setEnabled(true);check(e.loop.totalTime()===phase,'refresh preserves phase');
 e.setEnabled(false);e.exit.time(.25,false);await capture('cancel-midpoint');e.exit.time(1,false);check(!e.front.visible&&!e.rear.visible,'cancel cleanup hides both layers');
 e.setEnabled(true);e.scheduleReminder(()=>true);e.reminder.time(1.2,false);check(e.burstStart===e.loop.totalTime(),'eligible reminder replays burst');
 e.scheduleReminder(()=>false);const start=e.burstStart;e.loop.totalTime(2,false);e.reminder.time(1.2,false);check(e.burstStart===start,'ineligible reminder does not replay');
 const stress=[];for(let i=0;i<16;i++){const effect=new WindfuryEffect({position:{x:600,y:400},size:{width:150,height:161},anchor:{x:.5,y:.5},scale:1},'stress.windfury',textures);effect.setEnabled(true);effect.advancePreview(.5);app.stage.addChild(effect.rear,effect.front);stress.push(effect)}app.renderer.render(app.stage);for(const effect of stress)effect.destroy();check(stress.every(e=>e.front.destroyed),'sixteen concurrent effects render and dispose');
 for(const effect of effects)effect.destroy();check(effects.every(e=>e.front.destroyed&&e.rear.destroyed),'all effect layers release');
 for(const child of app.stage.removeChildren())child.destroy({children:true});
 const assets=new Proxy(textures,{get:(t,key)=>t[key]??Texture.EMPTY});
 app.stage.addChild(new Graphics().rect(0,0,1200,800).fill(0x172c40));
 const board=new OutlineLabBoard(app.renderer);app.stage.addChild(board);board.y=-150;
 await board.mount(assets,{'hero-jaina':textures.heroFrame},{loadArtwork:async()=>textures.artwork,load:async()=>Texture.EMPTY});
 board.setWindfuryPreview(true,WINDFURY_DEFAULTS);gsap.ticker.sleep();
 const views=[board.minion,board.hero];const winds=views.map(v=>v.windfury);
 const frames=[];const labTarget=RenderTexture.create({width:1200,height:800});
 check(winds.every(w=>w.curls.every(c=>c.mesh.shader.resources.uWind===textures.windfuryWind.source)),'Shader Lab receives the acquired texture sources');
 for(const time of [.5,1.8,3.5]){
   winds.forEach(w=>w.advancePreview(time));
   winds.forEach(w=>{w.front.visible=w.rear.visible=false});
   app.renderer.render({container:app.stage,target:labTarget,clear:true});const baseline=app.renderer.extract.pixels(labTarget).pixels;
   winds.forEach(w=>{w.front.visible=w.rear.visible=true});
   app.renderer.render({container:app.stage,target:labTarget,clear:true});const actual=app.renderer.extract.pixels(labTarget).pixels;
   for(const [index,view]of views.entries()){
     const bounds=view.getBounds();let changed=0;
     for(let y=Math.max(0,Math.floor(bounds.y));y<Math.min(800,Math.ceil(bounds.y+bounds.height));y++)for(let x=Math.max(0,Math.floor(bounds.x));x<Math.min(1200,Math.ceil(bounds.x+bounds.width));x++){
       const at=(y*1200+x)*4;if(Math.abs(actual[at]-baseline[at])+Math.abs(actual[at+1]-baseline[at+1])+Math.abs(actual[at+2]-baseline[at+2])>15)changed++;
     }
     check(changed>20,'Shader Lab '+(index?'hero':'minion')+' has visible Windfury pixels at '+time+'s');frames.push({time,host:index?'hero':'minion',changedPixels:changed});
   }
   if(time===.5)for(const [index,wind]of winds.entries()){
     wind.motes.layer.visible=false;app.renderer.render({container:app.stage,target:labTarget,clear:true});const before=app.renderer.extract.pixels(labTarget).pixels;
     wind.motes.layer.visible=true;app.renderer.render({container:app.stage,target:labTarget,clear:true});const after=app.renderer.extract.pixels(labTarget).pixels;
     let count=0;for(let i=0;i<before.length;i+=4)if(Math.abs(after[i]-before[i])+Math.abs(after[i+1]-before[i+1])+Math.abs(after[i+2]-before[i+2])>3)count++;
     check(count>5,'Shader Lab '+(index?'hero':'minion')+' renders additive motes');
   }
   await capture('shader-lab-'+time);
 }
 if(captureMode!=='before')for(const [host,wind]of winds.entries()){
   const size=wind.placement.size;
   const radius=(burst)=>Math.max(...wind.curls.filter(c=>c.burst===burst).flatMap(c=>{const pos=c.mesh.geometry.getBuffer('aPosition').data;const r=[];for(let i=0;i<pos.length;i+=2)r.push(Math.hypot(pos[i]/size.width,pos[i+1]/size.height));return r}));
   check(radius(true)<=radius(false)*1.351,(host?'hero':'minion')+' burst stays within 1.35 times its idle envelope');
 }
 const frontPasses=[];
 for(const [host,view]of views.entries()){
   const wind=winds[host],passes=wind.curls.filter(c=>!c.burst&&c.mesh.parent===wind.front);
   for(const pass of passes){let best=0;
     for(const time of [.35,.75,1.2,1.8,2.4,3]){
       winds.forEach(w=>w.advancePreview(time));winds.forEach(w=>{for(const c of w.curls)c.mesh.visible=false;w.motes.layer.visible=false});
       app.renderer.render({container:app.stage,target:labTarget,clear:true});const before=app.renderer.extract.pixels(labTarget).pixels;
       pass.mesh.visible=true;app.renderer.render({container:app.stage,target:labTarget,clear:true});const after=app.renderer.extract.pixels(labTarget).pixels;
       const center=view.toGlobal(view.pivot),rx=(host?100:50)*view.scale.x,ry=(host?130:60)*view.scale.y;let count=0;
       for(let y=Math.floor(center.y-ry);y<center.y+ry;y++)for(let x=Math.floor(center.x-rx);x<center.x+rx;x++){
         if(x<0||y<0||x>=1200||y>=800)continue;const i=(y*1200+x)*4;
         if(Math.abs(after[i]-before[i])+Math.abs(after[i+1]-before[i+1])+Math.abs(after[i+2]-before[i+2])>3)count++;
       }
       best=Math.max(best,count);
     }
     frontPasses.push({host:host?'hero':'minion',curl:pass.node.name,interiorPixels:best});
     if(captureMode!=='before')check(best>10,(host?'hero':'minion')+' '+pass.node.name+' crosses the portrait interior');
   }
 }
 winds.forEach(w=>w.advancePreview(0));
 const sequence=${JSON.stringify(process.env.WINDFURY_CAPTURE_SEQUENCE || '')};
 if(sequence){
   for(const [frame,time]of [.25,.75,1.8].entries()){winds.forEach(w=>w.advancePreview(time));app.renderer.render({container:app.stage,target:labTarget,clear:true});
     await ipcRenderer.invoke('sequence',frame,await app.renderer.extract.base64({target:labTarget,format:'png'}));
   }
 }
 winds.forEach(w=>w.advancePreview(39.25));check(winds.every(w=>!w.motes.layer.visible),'idle does not re-emit activation motes at the common cycle');
 labTarget.destroy(true);board.dispose();await scope.releaseAll();app.destroy(true,{children:true});return {checks,frames,frontPasses};
}run().then(r=>ipcRenderer.send('result',r)).catch(e=>ipcRenderer.send('result',{checks,error:e.stack}));`
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
    banner: { js: 'const __unusedCardArtwork=()=>({});' },
    // Diagnostic baseline recreates the previous projection in the capture
    // bundle only. Production source files are never rewritten for comparison.
    plugins:
      process.env.WINDFURY_CAPTURE_SEQUENCE === 'before'
        ? [
            {
              name: 'previous-windfury-projection',
              setup(build) {
                build.onLoad({ filter: /windfury-effect\.ts$/ }, (args) => ({
                  loader: 'ts',
                  contents: fs
                    .readFileSync(args.path, 'utf8')
                    .replace(
                      /const fit = windProjectionFit\(idle, activation\)/,
                      'const fit = {portraitDepth:.1,burstScale:1}'
                    )
                }))
                build.onLoad({ filter: /windfury-material\.ts$/ }, (args) => ({
                  loader: 'ts',
                  contents: fs
                    .readFileSync(args.path, 'utf8')
                    .replace(
                      'float front=smoothstep(-depthWidth,depthWidth,vDepth);',
                      'float front=step(0.,vDepth);'
                    )
                    .replace(
                      'coverage*=smoothstep(0.,uEdgeFeather,min(edge.x,min(edge.y,edge.z)));',
                      'coverage*=1.;'
                    )
                }))
              }
            }
          ]
        : []
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><body style="margin:0;overflow:hidden"><script src="renderer.js"></script>'
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(require('electron'), [__filename], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  child.on('exit', (code) => (process.exitCode = code ?? 1))
  child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
