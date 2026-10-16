/** Isolated WebGL validation. Does not launch the game or a development server.
 * Outputs a contact sheet and report under ignored .tmp/fire-aoe-check.
 */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'fire-aoe-check')

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 960,
      height: 540,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    const timer = setTimeout(() => {
      console.error('Fire AOE GPU check timed out')
      app.exit(1)
    }, 60000)
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    ipcMain.once('fire-result', (_event, result) => {
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
    fs.readFileSync(path.join(root, 'assets/images/match/BOARD.png')).toString('base64')
  const source = `
    import { Application, Assets, Sprite, Texture, RenderTexture, Container, Graphics } from 'pixi.js';
    import { gsap } from 'gsap';
    import { FireAoeResources, FireAoeComposite, FireImpactMesh } from './src/visual-components/effects/fire-aoe-materials';
    import { FireAoeEffect } from './src/visual-components/effects/fire-aoe-effect';
    import { FIRE_AOE_LAYOUT } from './src/visual-components/effects/fire-aoe-layout';
    import { fireAoeEnvelope, createFireParticles, createFireImpactParticles, fireParticleAt, fireCurve } from './src/visual-components/effects/fire-aoe-particles';
    import { DEFAULT_FIRE_AOE_TUNING, DEFAULT_FIRE_AOE_DYNAMICS, parseVfxTemplateLibrary } from './src/desktop/contracts/ipc/vfx-templates';
    import { MATCH_VFX_LAYOUT } from './src/scenes/match/presentation/match-vfx-layout';
    import { VFX_LAB_LAYOUT } from './src/dev-tools/vfx-lab/vfx-lab-layout';
    import { settingsFromTemplate, templateFromSettings } from './src/dev-tools/vfx-lab/vfx-lab-model';
    import { MatchVfxPresenter, matchVfxAreas } from './src/scenes/match/presentation/match-vfx-presenter';
    import { getVfxTemplate } from './src/visual-components/effects/vfx-templates';
    import { VfxLab } from './src/dev-tools/vfx-lab/vfx-lab';
    import rawLibrary from './config/vfx-templates.json';
    const { ipcRenderer } = require('electron');
    const fs = require('node:fs');
    const checks = [];
    function check(value, message) { if (!value) throw new Error(message); checks.push(message); }
    function canonical(value) { return JSON.stringify(value, (_key,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v); }
    async function run() {
      const app = new Application();
      await app.init({width:960,height:540,resolution:1,preference:'webgl',preserveDrawingBuffer:true,autoStart:false,backgroundColor:0x554638});
      document.body.append(app.canvas);
      app.stage.scale.set(0.5);
      const urls = ${JSON.stringify(urls)};
      const assets = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([k,v])=>[k,await Assets.load(v)])));
      const resources = new FireAoeResources(app.renderer, assets);
      const tuning = DEFAULT_FIRE_AOE_TUNING;
      const bluePalette={edge:'#09267b',flame:'#008aff',core:'#c6f8ff'};
      const varied={...tuning,appearance:{palette:bluePalette},dynamics:{...DEFAULT_FIRE_AOE_DYNAMICS,turbulence:.7}};
      const library = parseVfxTemplateLibrary(rawLibrary);
      for (const t of library.templates) check(canonical(templateFromSettings(t,settingsFromTemplate(t)))===canonical(t), 'roundtrip '+t.id);
      const bad = structuredClone(rawLibrary); bad.templates.find(t=>t.tuning.fire).tuning.fire.density = NaN;
      let rejected=false; try {parseVfxTemplateLibrary(bad)} catch {rejected=true} check(rejected,'invalid particle tuning rejected');
      const missingFire=structuredClone(rawLibrary);delete missingFire.templates.find(t=>t.family==='aoe').tuning.fire;
      rejected=false;try {parseVfxTemplateLibrary(missingFire)} catch {rejected=true} check(rejected,'AoE requires particle tuning');
      const badImpacts=structuredClone(rawLibrary);badImpacts.templates.find(t=>t.family==='aoe').tuning.fire.minionImpacts='false';
      rejected=false;try {parseVfxTemplateLibrary(badImpacts)} catch {rejected=true} check(rejected,'minion impact toggle rejects non-boolean values');
      const impactTargets=[{x:500,y:400,kind:'minion'},{x:500,y:175,kind:'hero'}];
      const withImpacts=new FireAoeEffect(resources,{targets:impactTargets,tuning:{...tuning,minionImpacts:true},intensity:2});
      const withoutImpacts=new FireAoeEffect(resources,{targets:impactTargets,tuning,intensity:2});
      check(withImpacts.impacts.length===2 && withoutImpacts.impacts.length===1,'minion bursts are optional while hero bursts remain');
      check(canonical(withImpacts.impacts[1].views.map(v=>v.particle))===canonical(withoutImpacts.impacts[0].views.map(v=>v.particle)),'disabling minion bursts preserves hero particle timing and random seed');
      withImpacts.dispose();withoutImpacts.dispose();
      const a=createFireParticles('full',tuning,1), b=createFireParticles('full',tuning,1), c=createFireParticles('full',tuning,2);
      const colored=createFireParticles('full',{...tuning,appearance:varied.appearance},1);
      check(canonical(a)===canonical(colored),'palette changes preserve all particle timing and motion');
      const turbulent=createFireParticles('full',varied,1), p=turbulent.find(p=>p.kind==='fire');
      const moved=fireParticleAt(p,p.birth+.2,1), original=fireParticleAt(a.find(p=>p.kind==='fire'),p.birth+.2,1);
      check(Math.hypot(moved.x-original.x,moved.z-original.z)>.001 && canonical(moved)===canonical(fireParticleAt(p,p.birth+.2,1)),'turbulence changes motion and is deterministic');
      const noTail={...tuning,dynamics:{...DEFAULT_FIRE_AOE_DYNAMICS,smokeAmount:0,emberAmount:0}};
      check([...createFireParticles('full',noTail),...createFireImpactParticles(noTail)].every(p=>p.kind!=='smoke'&&p.kind!=='embers'),'tail amount zero disables board and target emitters');
      const longTail={...varied,dynamics:{...varied.dynamics,smokePersistence:2,emberPersistence:2}};
      check(Math.max(...createFireParticles('full',longTail).map(p=>p.birth+p.life))>Math.max(...a.map(p=>p.birth+p.life)),'persistence extends the actual particle tail');
      check(JSON.stringify(a)===JSON.stringify(b) && JSON.stringify(a)!==JSON.stringify(c),'seeded particle replay');
      check(a.filter(p=>p.kind==='fire'&&Math.abs(p.birth-.45)<1e-6).length===50,'fifty-particle burst respects original 450ms delay');
      check(a.filter(p=>p.kind==='fire').every(p=>p.birth>=.449999) && a.some(p=>p.kind==='fire'&&p.birth>1.4),'fire emission runs on its independent one-second timeline');
      check(a.some(p=>p.kind==='dark'&&p.birth>2.2),'dark emission continues after the action state');
      const boardSmoke=a.filter(p=>p.kind==='smoke');
      check(boardSmoke.length>0 && boardSmoke.length<=25,'board smoke count stays sparse');
      check(boardSmoke.every(p=>p.life<=2 && p.birth+p.life<=3.6),'board smoke clears within 3.6 seconds');
      check(Math.abs(Math.min(...a.filter(p=>p.kind==='smoke').map(p=>p.birth))-.95)<1e-6,'no invented ember-state wait');
      const fire=a.find(p=>p.kind==='fire');
      check(fireParticleAt(fire,fire.birth+fire.life*.8,1).size<fireParticleAt(fire,fire.birth+fire.life*.2,1).size,'fire shrinks over its lifetime');
      check(a.some(p=>p.kind==='fire'&&p.direction[0]>.5) && a.some(p=>p.kind==='fire'&&p.direction[0]<-.5),'authored emitter directions preserve opposing regional flow');
      check(Math.abs(fireCurve([[0,0,1,1],[1,1,1,1]],.25)-.25)<1e-9,'curve evaluator preserves authored tangents');
      const impacts=createFireImpactParticles(tuning,1);
      check(impacts.filter(p=>p.kind==='burst'||p.kind==='sparks').every(p=>p.birth>=.55),'impact particles include their own 500ms delay');
      check(impacts.filter(p=>p.kind==='burst').length===4,'impact preserves the original staggered four-particle burst');
      const impactSmoke=impacts.filter(p=>p.kind==='smoke');
      check(impactSmoke.length>0 && impactSmoke.length<=2,'each target adds at most two smoke clouds');
      check(impactSmoke.every(p=>p.birth<1.9 && p.birth+p.life<=3.4),'target smoke stops emitting early and clears within 3.4 seconds');
      for (const coverage of ['full','opponent','friendly']) for(let seed=1;seed<=20;seed++) {
        const clouds=[...createFireParticles(coverage,tuning,seed),...createFireImpactParticles(tuning,seed)].filter(p=>p.kind==='smoke');
        check(clouds.every(p=> {
          const end=fireParticleAt(p,p.birth+p.life,1);
          const dx=end.x-p.position[0],dy=-(end.y-p.position[1])-(end.z-p.position[2]);
          return Math.hypot(dx,dy)<1.3 && !fireParticleAt(p,3.6,1).visible;
        }),coverage+' smoke stays near its emitter and clears, seed '+seed);
      }
      check(a.filter(p=>p.kind==='fire').every(p=>p.life>=.5&&p.life<=.7),'full-board fire lifetimes');
      check(createFireParticles('opponent',tuning).filter(p=>p.kind==='fire').every(p=>p.life>=.3&&p.life<=.5),'half-board fire lifetimes');
      check(a.every(p=>p.row>=0&&p.row<4),'atlas row selection');
      check(fireAoeEnvelope(0,'full').alpha===0 && fireAoeEnvelope(3,'full').intensity===0,'independent area envelopes');
      check(a.filter(p=>p.kind==='embers').every(p=>p.birth<1.95 && p.birth+p.life<3.2),'embers finish within 3.2 seconds');
      check(fireAoeEnvelope(3.2,'full').dim===0,'board dimming clears with the particle tail');
      check(JSON.stringify(matchVfxAreas(['enemyBoard'],false))===JSON.stringify(['localBoard']),'opponent caster reverses area');
      const pixels = texture => app.renderer.extract.pixels(texture).pixels;
      for (const coverage of ['friendly','opponent']) {
        const placement={position:{x:128,y:128},size:{width:128,height:64},anchor:{x:.5,y:.5}};
        const effect=new FireAoeEffect(resources,{area:{coverage,placement},targets:[],tuning,intensity:2});
        effect.update(.7);
        for(const child of effect.area.container.children) child.visible=child===effect.area.glow;
        const target=RenderTexture.create({width:256,height:256});
        app.renderer.render({container:effect.container,target,clear:true,clearColor:[0,0,0,0]});
        const data=pixels(target),alpha=y=>data[(y*256+128)*4+3];
        const seam=coverage==='friendly'?96:Math.round(160+64*(FIRE_AOE_LAYOUT.boardGlowDepthScale.opponent-1)), direction=coverage==='friendly'?1:-1;
        const fade=Array.from({length:49},(_,i)=>alpha(seam-24+i));
        check(fade.every((value,i)=>i===0||Math.abs(value-fade[i-1])<40),coverage+' board glow has a continuous center-edge fade without a hard crop');
        check(alpha(seam-direction*20)===0 && alpha(seam+direction*20)>100,coverage+' board glow stays aligned with its intended half');
        if(coverage==='opponent'){
          const scale=FIRE_AOE_LAYOUT.boardGlowDepthScale.opponent;let reference;
          try{FIRE_AOE_LAYOUT.boardGlowDepthScale.opponent=1;reference=new FireAoeEffect(resources,{area:{coverage,placement},targets:[],tuning,intensity:2});}
          finally{FIRE_AOE_LAYOUT.boardGlowDepthScale.opponent=scale;}
          const frames=[];
          for(const value of [reference,effect]){
            value.update(.7);for(const child of value.area.container.children)child.visible=child!==value.area.glow&&child!==value.area.dim;
            app.renderer.render({container:value.container,target,clear:true,clearColor:[0,0,0,0]});frames.push(pixels(target));
          }
          check(frames[0].every((v,i)=>v===frames[1][i]),'extending the enemy inner glow leaves the rendered flames pixel-identical');
          check(effect.area.glow.height>reference.area.glow.height,'enemy extension enlarges only the inner glow');
          reference.dispose();
        }
        target.destroy(true);effect.dispose();
      }
      const coloredRamp=resources.createRamp(bluePalette), rampPixels=pixels(coloredRamp), originalRamp=pixels(assets.fireAoeColorRamp);
      check(rampPixels.length===originalRamp.length && rampPixels.every((v,i)=>i%4!==3||Math.abs(v-originalRamp[i])<=1),'generated palette preserves the extracted ramp opacity');
      check(rampPixels.some((v,i)=>i%4===2&&v>rampPixels[i-2]+20),'generated palette contains blue flame colors');
      coloredRamp.destroy(true);
      for(const [labKey,matchKey] of [['enemyBoard','remoteBoard'],['friendlyBoard','localBoard'],['bothBoards','bothBoards']]) {
        const lab=VFX_LAB_LAYOUT.aoe.blasts[labKey],match=MATCH_VFX_LAYOUT.areas[matchKey];
        check(lab.position.x-VFX_LAB_LAYOUT.board.position.x===match.position.x && lab.position.y===match.position.y && canonical(lab.size)===canonical(match.size),labKey+' Lab and match use identical board mapping');
      }
      check(pixels(resources.smoke)[3]===0,'smoke red mask makes black texture corners transparent');
      check(Math.max(...pixels(resources.smoke))>0,'smoke mask has visible content');
      check(pixels(resources.smoke).every((v,i)=>i%4!==3||v<=128),'smoke material applies its original half-opacity factor');
      const materialTarget=RenderTexture.create({width:16,height:16});
      const impactMaterial=new FireImpactMesh(Texture.WHITE,true);impactMaterial.position.set(8,8);impactMaterial.width=impactMaterial.height=16;
      impactMaterial.setParticleColor([.1,.2,.3,.4]);
      app.renderer.render({container:impactMaterial,target:materialTarget,clear:true,clearColor:[0,0,0,0]});
      const impactPixel=pixels(materialTarget).slice(0,4);
      check(Math.abs(impactPixel[0]-79)<=1 && Math.abs(impactPixel[1]-22)<=1 && Math.abs(impactPixel[2]-34)<=1 && impactPixel[3]===0,'impact shader applies authored intensity/color before saturation and keeps opaque burst emissive');
      impactMaterial.destroy();materialTarget.destroy(true);
      const blueImpact=new FireImpactMesh(Texture.WHITE,true,'#008aff'),blueTarget=RenderTexture.create({width:16,height:16});
      blueImpact.position.set(8,8);blueImpact.width=blueImpact.height=16;blueImpact.setParticleColor([.1,.2,.3,.4]);
      app.renderer.render({container:blueImpact,target:blueTarget,clear:true,clearColor:[0,0,0,0]});
      const bluePixel=pixels(blueTarget);check(bluePixel[2]>bluePixel[0]&&bluePixel[3]===0,'impact recoloring preserves emissive blending');
      blueImpact.destroy();blueTarget.destroy(true);
      const pattern=RenderTexture.create({width:32,height:32}),patternArt=new Graphics().rect(0,0,32,32).fill(0xcccccc).rect(0,0,8,32).fill(0x333333);
      app.renderer.render({container:patternArt,target:pattern,clear:true});
      const stable=new FireAoeComposite(pattern,assets.fireAoeColorRamp),clipGroup=new Container(),clipQuad=new Sprite(Texture.WHITE);
      clipQuad.width=clipQuad.height=320;clipQuad.filters=[stable.filter];clipGroup.addChild(clipQuad);stable.update(1,2,1.1,0);
      const large=RenderTexture.create({width:320,height:320}),small=RenderTexture.create({width:160,height:160});
      app.renderer.render({container:clipGroup,target:large,clear:true});const largePixels=pixels(large);
      clipQuad.position.set(-80,-80);app.renderer.render({container:clipGroup,target:small,clear:true});const smallPixels=pixels(small);
      check(smallPixels.every((v,i)=>Math.abs(v-largePixels[((Math.floor(i/4/160)+80)*320+(Math.floor(i/4)%160+80))*4+i%4])<=1),'viewport clipping does not stretch or move the heat texture');
      clipQuad.filters=null;clipGroup.destroy({children:true});stable.destroy();patternArt.destroy();pattern.destroy(true);large.destroy(true);small.destroy(true);
      const heat=RenderTexture.create({width:2,height:2});
      const sample=RenderTexture.create({width:16,height:16});
      const empty=new Container();
      const composite=new FireAoeComposite(heat,assets.fireAoeColorRamp);
      const quad=new Sprite(Texture.WHITE);quad.width=quad.height=16;quad.filters=[composite.filter];
      const read=(color,alpha=1)=>{app.renderer.render({container:empty,target:heat,clear:true,clearColor:color});composite.update(alpha,2,1.1,0);app.renderer.render({container:quad,target:sample,clear:true,clearColor:[0,0,0,0]});return Array.from(pixels(sample).slice(0,4));};
      const red=read([.25,0,0,1]),otherChannels=read([.25,1,1,1]),halfAlpha=read([.25,0,0,1],.5);
      check(JSON.stringify(red)===JSON.stringify(otherChannels),'ramp uses red channel only');
      check(red[3]>0 && red[3]<255 && Math.abs(halfAlpha[3]*2-red[3])<=2,'ramp opacity and animated alpha preserved');
      check(read([0,0,0,1]).every(v=>v===0),'empty field does not leave a rectangular overlay');
      quad.filters=null;quad.destroy();composite.destroy();empty.destroy();sample.destroy(true);heat.destroy(true);
      const times=[0.35,0.6,1.1,1.8,3,5];
      const sheet=document.createElement('canvas'); sheet.width=960*3;sheet.height=570*6;
      const ctx=sheet.getContext('2d');
      const results=[];
      for(const [row,coverage] of ['opponent','friendly','full'].entries()) {
        const placement=MATCH_VFX_LAYOUT.areas[coverage==='opponent'?'remoteBoard':coverage==='friendly'?'localBoard':'bothBoards'];
        const targets=coverage==='full'?[{x:820,y:394,kind:'minion'},{x:1100,y:633,kind:'minion'},{x:960,y:175,kind:'hero'}]:[{x:820,y:placement.position.y,kind:'minion'},{x:1100,y:placement.position.y,kind:'minion'}];
        const effect=new FireAoeEffect(resources,{area:{coverage,placement},targets,tuning,intensity:2});
        check(effect.duration>.5 && effect.duration<=3.6,coverage+' finishes with the shortened visible tail');
        const end=Math.max(effect.area.end,...effect.impacts.map(impact=>impact.end));
        check(effect.duration===end,coverage+' cleanup follows actual particles and envelopes');
        app.stage.addChild(effect.container);
        for(const [i,t] of times.entries()) {
          const start=performance.now();effect.update(t);app.renderer.render(app.stage); const ms=performance.now()-start;
          if(coverage==='full'&&t===1.1){
            const frame=document.createElement('canvas');frame.width=app.canvas.width;frame.height=app.canvas.height;const frameContext=frame.getContext('2d');
            const readFrame=()=>{frameContext.drawImage(app.canvas,0,0);return frameContext.getImageData(0,0,frame.width,frame.height).data};
            const after=readFrame(),heatBefore=pixels(effect.area.heat);
            fs.writeFileSync(${JSON.stringify(path.join(output, 'overlap-after.png'))},Buffer.from(app.canvas.toDataURL().split(',')[1],'base64'));
            const uniforms=effect.area.glowFilter.resources.glow.uniforms,near=uniforms.uOverlapNear,far=uniforms.uOverlapFar;
            uniforms.uOverlapNear=[1,1];uniforms.uOverlapFar=[1,1];app.renderer.render(app.stage);
            const before=readFrame();
            const at=(data,x,y)=>{const px=Math.round((placement.position.x+placement.size.width*x)*.5),py=Math.round((placement.position.y+placement.size.height*y)*.5);return data.slice((py*frame.width+px)*4,(py*frame.width+px)*4+4)};
            for(const [x,y] of [[-.33,-.37],[.267,.39]])check(at(after,x,y)[0]>at(before,x,y)[0]+20,'glow feather bridges the interior/rim gap at '+x+','+y);
            check(at(after,0,0).every((v,i)=>Math.abs(v-at(before,0,0)[i])<=2),'overlap preserves the filled center brightness');
            fs.writeFileSync(${JSON.stringify(path.join(output, 'overlap-before.png'))},Buffer.from(app.canvas.toDataURL().split(',')[1],'base64'));
            uniforms.uOverlapNear=near;uniforms.uOverlapFar=far;app.renderer.render(app.stage);
            check(pixels(effect.area.heat).every((v,i)=>v===heatBefore[i]),'softening overlap leaves the particle heat and flame silhouette unchanged');
          }
          const x=(i%3)*960,y=(row*2+Math.floor(i/3))*570;
          ctx.drawImage(app.canvas,x,y+30);ctx.fillStyle='#111';ctx.fillRect(x,y,960,30);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText(coverage+' '+t+'s',x+12,y+23);
          results.push({coverage,time:t,renderSubmissionMs:Math.round(ms*100)/100});
        }
        effect.update(1.8);
        const smoke=effect.area.views.find(v=>v.particle.kind==='smoke'&&v.sprite.visible);
        check(smoke && Math.abs(smoke.sprite.width-smoke.sprite.height)<.001 && effect.area.container.scale.x===effect.area.container.scale.y,coverage+' smoke remains a square billboard outside floor flattening');
        effect.update(1.7);check(pixels(effect.area.heat).some((v,i)=>i%4===0&&v>0),coverage+' heat field survives the former early cutoff');
        effect.update(.7);app.renderer.render(app.stage);const first=app.canvas.toDataURL();
        effect.update(.12);effect.update(.7);app.renderer.render(app.stage);
        check(app.canvas.toDataURL()===first,coverage+' seek is deterministic');
        effect.update(effect.duration);check(!effect.container.visible,coverage+' completes');
        const heat=effect.area.heat;
        const impactMeshes=effect.impacts.flatMap(impact=>impact.views.map(v=>v.sprite).filter(s=>s instanceof FireImpactMesh));
        const geometries=impactMeshes.map(m=>m.geometry), shaders=impactMeshes.map(m=>m.shader);
        effect.dispose();effect.dispose();
        check(heat.destroyed && !app.stage.children.length,coverage+' releases render target and display objects');
        check(geometries.every(g=>!g.buffers&&!g.indexBuffer) && shaders.every(s=>!s.resources),coverage+' releases custom impact geometry and shader resources');
      }
      fs.writeFileSync(${JSON.stringify(path.join(output, 'contact-sheet.png'))},Buffer.from(sheet.toDataURL().split(',')[1],'base64'));
      // Validate the actual presenter, with live Pixi resources and a manually advanced timeline.
      const timeline=gsap.timeline({paused:true});
      const presenter=new MatchVfxPresenter({...assets,burnNoise:Texture.WHITE,playSpotlight1:Texture.WHITE},()=>timeline,app.renderer);
      const template=library.templates.find(t=>t.id==='fire-blast-all-characters');
      let released=false;
      const playing=presenter.play(template,true,undefined,undefined,[{x:100,y:100,kind:'minion'},{x:200,y:200,kind:'hero'}]).then(()=>{released=true});
      const presentedImpacts=presenter.layer.children[0].children.filter(c=>c.label==='fire-aoe.target-impact');
      check(presentedImpacts.length===1 && presentedImpacts[0].position.x===200,'presenter keeps the actual hero impact and omits minion impacts');
      timeline.time(.49,false);await Promise.resolve();check(!released,'queue waits until gameplay cue');
      timeline.time(.5,false);await playing;check(released && presenter.layer.children.length===1,'queue released at 500ms while tail remains');
      timeline.progress(1,false);check(!presenter.layer.children.length,'presenter completes and cleans up');presenter.dispose();
      const earlyTimeline=gsap.timeline({paused:true});
      const early=new MatchVfxPresenter({...assets,burnNoise:Texture.WHITE,playSpotlight1:Texture.WHITE},()=>earlyTimeline,app.renderer);
      const earlyPlay=early.play(template,false);early.dispose();await earlyPlay;check(!early.layer.children.length,'interruption resolves pending cue');
      const lab=new VfxLab({canvas:app.canvas,renderer:app.renderer,parent:document.body,assets:{...assets,burnNoise:Texture.WHITE,playSpotlight1:Texture.WHITE,ghostSpotlight:assets.fireAoeSmoke}});
      app.stage.addChild(lab);lab.selectEffect('aoe');lab.selectTemplate('fire-blast-enemy-board');lab.changeSetting('showTargetGuides',false);
      for(const time of [.6,1.1]){lab.fireEffect.update(time);app.renderer.render(app.stage);fs.writeFileSync(${JSON.stringify(path.join(output, 'enemy-board-'))}+Math.round(time*1000)+'.png',Buffer.from(app.canvas.toDataURL().split(',')[1],'base64'));}
      lab.selectEffect('aoe');lab.selectTemplate('fire-blast-enemy-board');lab.changeSetting('previewMinions',7);lab.changeSetting('opponentCaster',true);
      check(lab.fireEffect.request.targets.length===7 && lab.fireEffect.request.area.coverage==='friendly','Lab shares renderer with target count and reversed source');
      check(lab.fireEffect.impacts.length===0,'Lab defaults to fire without minion impact bursts');
      const impactToggle=lab.controls.inputs.get('fireMinionImpacts');impactToggle.checked=true;impactToggle.dispatchEvent(new Event('input'));
      check(lab.fireEffect.impacts.length===7 && lab.selectedTemplate.tuning.fire.minionImpacts===true,'Lab checkbox enables and saves all minion bursts');
      lab.changeSetting('enemyHero',true);lab.changeSetting('fireMinionImpacts',false);
      check(lab.fireEffect.impacts.length===1 && lab.fireEffect.request.targets.length===8,'Lab keeps hero bursts and target guides when minion bursts are disabled');
      check(canonical(templateFromSettings(lab.selectedTemplate,settingsFromTemplate(lab.selectedTemplate)))===canonical(lab.selectedTemplate),'explicitly disabled impacts survive editor roundtrip');
      lab.changeSetting('enemyHero',false);lab.changeSetting('fireMinionImpacts',true);
      lab.changeSetting('fireDensity',1.25);check(lab.selectedTemplate.tuning.fire.density===1.25,'Lab edits persist in template');
      lab.changeSetting('showTargetGuides',true);check(lab.fireTargets.visible,'particle target guides remain available');
      const paletteInput=lab.controls.inputs.get('firePalette');paletteInput.value='custom';paletteInput.dispatchEvent(new Event('input'));
      for(const [key,value] of [['fireEdgeColor',bluePalette.edge],['fireFlameColor',bluePalette.flame],['fireCoreColor',bluePalette.core]]) {
        const input=lab.controls.inputs.get(key);input.value=value;input.dispatchEvent(new Event('input'));
      }
      lab.changeSetting('fireTurbulence',.7);lab.changeSetting('fireSmokePersistence',2);
      check(canonical(lab.selectedTemplate.tuning.fire.appearance.palette)===canonical(bluePalette),'palette controls update the saved template');
      const custom=lab.selectedTemplate;
      check(canonical(templateFromSettings(custom,settingsFromTemplate(custom)))===canonical(custom),'custom appearance and dynamics survive editor roundtrip');
      lab.fireEffect.update(1.8);const ownedRamp=lab.fireEffect.area.ramp;
      check(lab.fireEffect.duration>3.6,'cleanup follows extended smoke persistence');
      lab.changeSetting('firePalette','original');check(ownedRamp.destroyed&&!lab.fireEffect.area.ramp,'switching to original releases the generated ramp');
      for(const [flag,key,value] of [['fireGlowOverride','fireGlowColor','#00ff00'],['fireEmberOverride','fireEmberColor','#ff00ff'],['fireImpactOverride','fireImpactColor','#008aff'],['fireSmokeOverride','fireSmokeColor','#334455']]) {
        lab.changeSetting(flag,true);lab.changeSetting(key,value);
      }
      lab.changeSetting('fireSmokeOpacity',.3);lab.fireEffect.update(1.8);
      check(lab.fireEffect.area.views.filter(v=>v.particle.kind==='smoke').every(v=>!v.sprite.visible||v.sprite.alpha<=.3),'smoke opacity affects billboard particles');
      let saved;window.api={vfxTemplates:{save:async payload=>{saved=parseVfxTemplateLibrary(payload)}}};await lab.saveTemplates();
      check(canonical(saved.templates.find(t=>t.id===lab.selectedTemplate.id))===canonical(lab.selectedTemplate),'appearance overrides and dynamics pass through Save');
      for (const enabled of [false,true]) {
        lab.changeSetting('fireMinionImpacts',enabled);await lab.saveTemplates();
        const selectedId=lab.selectedTemplate.id, fromMatch=getVfxTemplate(selectedId);
        check(canonical(fromMatch)===canonical(lab.selectedTemplate),'saved Lab tuning reaches the match library, minion impacts='+enabled);
        lab.selectTemplate('fire-blast-both-boards');lab.selectTemplate(selectedId);
        check(lab.settings.fireMinionImpacts===enabled,'minion impact setting survives template switching, enabled='+enabled);
        const savedTimeline=gsap.timeline({paused:true});
        const savedPresenter=new MatchVfxPresenter({...assets,burnNoise:Texture.WHITE,playSpotlight1:Texture.WHITE},()=>savedTimeline,app.renderer);
        const pending=savedPresenter.play(fromMatch,false,undefined,undefined,[{x:300,y:400,kind:'minion'},{x:960,y:175,kind:'hero'}]);
        check(savedPresenter.layer.children[0].children.filter(c=>c.label==='fire-aoe.target-impact').length===(enabled?2:1),'match plays saved impact selection, enabled='+enabled);
        savedTimeline.time(.8,false);savedPresenter.dispose();await pending;
        check(savedPresenter.layer.children.length===0,'active saved effect cleans up on match disposal, enabled='+enabled);
      }
      const invalidColor=structuredClone(saved);invalidColor.templates.find(t=>t.family==='aoe').tuning.fire.appearance={palette:{...bluePalette,core:'invalid'}};
      rejected=false;try {parseVfxTemplateLibrary(invalidColor)} catch {rejected=true} check(rejected,'invalid palette colors are rejected');
      check(!lab.controls.inputs.has('particleFire') && !lab.controls.inputs.has('aoeRadius'),'AoE controls expose only the current renderer');
      check(library.templates.filter(t=>t.family==='aoe').every(t=>!!t.tuning.fire),'every AoE preset uses particle fire');
      lab.createTemplate();check(!!lab.fireEffect && lab.selectedTemplate.tuning.fire.density===1.25,'copied AoE preserves particle tuning');
      lab.templates=lab.templates.filter(t=>t.family==='missile');lab.selectedTemplateId=null;lab.createTemplate();
      check(!!lab.fireEffect && lab.selectedTemplate.tuning.fire.density===1,'new AoE starts with particle fire');
      lab.selectEffect('missile');check(!lab.fireEffect,'switching to missile releases particle fire');
      lab.dispose();lab.destroy({children:true});
      const gl=app.renderer.gl;check(gl.getError()===gl.NO_ERROR,'no WebGL errors');
      resources.destroy();check(!assets.fireAoeWispAtlas.destroyed,'shared registered assets survive cleanup');
      app.destroy(true,{children:true});
      return {checks,frames:results,renderer:'WebGL',contactSheet:${JSON.stringify(path.join(output, 'contact-sheet.png'))}};
    }
    run().then(result=>ipcRenderer.send('fire-result',result)).catch(error=>ipcRenderer.send('fire-result',{checks,error:error.stack}));
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
    '<!doctype html><html><body style="margin:0"><script src="renderer.js"></script></body></html>'
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
