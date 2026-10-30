/** Real isolated WebGL playback; screenshots/report stay under ignored .tmp. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'fireball-check-color-fix')

async function main() {
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
  urls.boardBase =
    'data:image/png;base64,' +
    fs.readFileSync(path.join(root, 'assets/images/table/board.png')).toString('base64')
  const source = `
    import { Application, Assets, Texture, Sprite, Container, RenderTexture } from 'pixi.js';
    import { gsap } from 'gsap';
    import { FireballEffect } from './src/visual-components/effects/fireball-effect';
    import { createFireballComposite } from './src/visual-components/effects/fireball-materials';
    import { createFireballParticles } from './src/visual-components/effects/fireball-particles';
    import { MatchVfxPresenter } from './src/scenes/match/presentation/match-vfx-presenter';
    import { VfxLab } from './src/dev-tools/vfx-lab/vfx-lab';
    import { getVfxTemplate } from './src/visual-components/effects/vfx-templates';
    import { parseVfxTemplateLibrary } from './src/desktop/contracts/ipc/vfx-templates';
    const {ipcRenderer}=require('electron');const checks=[];const frames=[];
    function check(value,message){if(!value)throw Error(message);checks.push(message)}
    async function run(){
      const app=new Application();await app.init({width:1920,height:1080,resolution:1,preference:'webgl',autoStart:false,preserveDrawingBuffer:true,backgroundColor:0x554638});
      document.body.append(app.canvas);
      const assets=Object.fromEntries(await Promise.all(Object.entries(${JSON.stringify(urls)}).map(async([key,url])=>[key,await Assets.load(url)])));
      Object.assign(assets,{burnNoise:Texture.WHITE,playSpotlight1:Texture.WHITE,ghostSpotlight:assets.fireballSmoke});
      const template=getVfxTemplate('fire-missile');const tuning=template.tuning;
      // Compare actual shader pixels against the recovered DXBC equations.
      const diagnostic=RenderTexture.create({width:16,height:16});
      const result=RenderTexture.create({width:16,height:16});const empty=new Container();
      app.renderer.render({container:empty,target:diagnostic,clear:true,clearColor:[.4,.2,.1,.5]});
      const probe=new Sprite(diagnostic);probe.blendMode='none';
      const probeOptions={alphaExponent:2,intensity:2,bloom:{intensity:1.2,threshold:.1,blur:.4}};
      const extraction=createFireballComposite('extract',probeOptions);
      const horizontal=createFireballComposite('horizontal',probeOptions),vertical=createFireballComposite('vertical',probeOptions);
      probe.filters=[extraction,horizontal,vertical];app.renderer.render({container:probe,target:result,clear:true});
      const rgba=app.renderer.extract.pixels(result).pixels.slice((8*16+8)*4,(8*16+8)*4+4);
      const expectedAlpha=((128/255)**2-.1)*(1.2/.9);
      check(Math.abs(rgba[0]-102)<=2 && Math.abs(rgba[3]-expectedAlpha*255)<=2,'bloom extraction and blur preserve independent RGB and alpha, with threshold-normalized gain');
      const display=createFireballComposite('bloom-display',probeOptions);probe.texture=result;probe.filters=[display];
      app.renderer.render({container:probe,target:diagnostic,clear:true});const shown=app.renderer.extract.pixels(diagnostic).pixels.slice((8*16+8)*4,(8*16+8)*4+4);
      check(Math.abs(shown[0]-rgba[0]*rgba[3]/255)<=2 && Math.abs(shown[3]-rgba[3]**2/255)<=2,'bloom display applies sampled alpha to RGB and squares alpha after blur');
      probe.filters=null;probe.destroy();empty.destroy();for(const filter of [extraction,horizontal,vertical,display])filter.destroy();diagnostic.destroy(true);result.destroy(true);
      const request={source:{x:960,y:830},target:{x:960,y:175},tuning};
      const particles=createFireballParticles('missile',.4);
      check(particles.filter(p=>p.name==='FireParticleBall').length===120,'source head stream emits 300 particles per second');
      const effect=new FireballEffect(app.renderer,assets,request);app.stage.addChild(effect.container);
      check(effect.missile.bloomHeat.width===99 && effect.missile.bloomHeat.height===342 && effect.impact.bloomHeat.width===135,'bloom targets use native truncated resolution ratios');
      check(effect.launchSeconds===1 && effect.impactSeconds===1.4 && effect.duration>effect.impactSeconds,'fresh cast waits one second for Birth, then flies for 400ms before its independent tail');
      effect.update(.15);check(!effect.missile.display.visible && effect.flightRoot.y===0 && Math.abs(effect.birth.core.shader.resources.core.uniforms.uRadius-.15)<.001,'source core grows linearly over 300ms without starting flight');
      effect.update(1);check(effect.missile.display.visible&&!effect.birth.core.visible,'launch transitions from the source birth core to the missile core');
      for(const time of [0,.1,.2,.3,.4,.5,.7,1,1.1,1.2,1.3,1.4,1.6,2.5,4]){
        const start=performance.now();effect.update(time);app.renderer.render(app.stage);frames.push({time,renderMs:performance.now()-start});
        if(time===1.3){
          const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d');context.drawImage(app.canvas,0,0);
          const tail=context.getImageData(960,600,1,1).data;
          check(tail[0]>230 && tail[1]>180 && tail[1]>tail[2]+60,'combined fire and bloom retain a hot yellow trail instead of muddy orange');
          const headY=830-655*(.3/.4)**2;const head=context.getImageData(952,Math.round(headY)-8,16,16).data;
          check(Array.from({length:head.length/4},(_,i)=>head[i*4]).every(r=>r>150),'additive head remains luminous through the dark cutout regions');
          const border=context.getImageData(930,Math.round(headY)-30,60,60).data;
          check(Array.from({length:border.length/4},(_,i)=>i*4).some(i=>border[i]>190&&border[i+1]<145&&border[i+2]<145),'original core retains visible red surface detail');
        }
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','isolated-'+Math.round(time*1000));
      }
      effect.update(.2);app.renderer.render(app.stage);const first=app.canvas.toDataURL();
      effect.update(.7);effect.update(.2);app.renderer.render(app.stage);check(first===app.canvas.toDataURL(),'seeking/replay preserves deterministic particle motion');
      effect.update(effect.duration);check(!effect.container.visible,'effect hides at its actual final particle');
      const heat=effect.missile.heat,bloomTargets=[effect.missile.bloomCapture,effect.missile.bloomHeat,effect.impact.bloomCapture,effect.impact.bloomHeat,effect.birth.heat,effect.birth.bloomCapture,effect.birth.bloomHeat];effect.dispose();effect.dispose();check(heat.destroyed&&bloomTargets.every(t=>t.destroyed)&&!app.stage.children.length,'disposal releases render textures and scene objects');
      const tailProbe=RenderTexture.create({width:111,height:380});const tailProfiles={};
      const sampleTail=variant=>{
        app.renderer.render({container:variant.missile.tailContent,target:tailProbe,clear:true,clearColor:[0,0,0,0]});
        return app.renderer.extract.pixels(tailProbe).pixels.slice();
      };
      for(const tailMotion of [0,.25,.5,1,2]) {
        const variant=new FireballEffect(app.renderer,assets,{...request,tuning:{...tuning,tailMotion},prewarmed:true,seed:1});app.stage.addChild(variant.container);
        variant.update(tuning.durationMs/1000*Math.sqrt(.5));tailProfiles[tailMotion]=sampleTail(variant);app.renderer.render(app.stage);
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','tail-irregularity-'+tailMotion);
        if(tailMotion===0){
          const filter=variant.missile.tailFilter;const length=filter.resources.tail.uniforms.uLength;
          variant.update(tuning.durationMs/1000*.85);filter.resources.tail.uniforms.uLength=length;
          const later=sampleTail(variant);
          check(later.every((value,i)=>value===tailProfiles[0][i]),'zero irregularity tail has no particle or erosion flicker when its envelope is held fixed');
          check(variant.batches.filter(b=>b.phase==='missile'&&!b.field).every(b=>!b.mesh.visible),'smooth tail omits loose smoke and sparks');
        }
        variant.dispose();
      }
      const coverage=(pixels,x,y)=>Math.pow(pixels[(y*111+x)*4+3]/255,15);
      const contour=pixels=>{
        const rows=[];for(let y=100;y<180;y++){
          const occupied=[];for(let x=0;x<111;x++)if(coverage(pixels,x,y)>.2)occupied.push(x);
          if(occupied.length) rows.push({y,left:occupied[0],right:occupied.at(-1)});
        }return rows;
      };
      const smoothContour=contour(tailProfiles[0]);
      check(smoothContour.length===80 && smoothContour.every(row=>Math.abs((row.left+row.right)/2-55)<=.5),'zero irregularity has a continuous centered silhouette along the entire sampled tail');
      check(smoothContour.every((row,i)=>i===0 || row.right-row.left<=smoothContour[i-1].right-smoothContour[i-1].left),'zero irregularity tapers smoothly without flame billows');
      const tailMetrics={};
      for(const value of [0,.25,.5,1,2]) {
        let changed=0,union=0;for(let y=100;y<180;y++)for(let x=0;x<111;x++){
          const a=coverage(tailProfiles[0],x,y)>.2,b=coverage(tailProfiles[value],x,y)>.2;if(a||b)union++;if(a!==b)changed++;
        }
        tailMetrics[value]={differenceFromSmooth:changed/Math.max(1,union)};
      }
      check(tailMetrics[1].differenceFromSmooth>.25,'original Fireball silhouette visibly differs from the smooth ribbon');
      let changed=0,union=0;for(let y=100;y<180;y++)for(let x=0;x<111;x++){
        const a=coverage(tailProfiles[1],x,y)>.2,b=coverage(tailProfiles[2],x,y)>.2;if(a||b)union++;if(a!==b)changed++;
      }
      tailMetrics.exaggeratedDifferenceFromOriginal=changed/Math.max(1,union);
      check(tailMetrics.exaggeratedDifferenceFromOriginal>.15,'maximum irregularity visibly changes the outline beyond original Fireball');
      for(const value of [.25,.5]){
        let error=0,count=0;for(let y=100;y<180;y++)for(let x=0;x<111;x++){
          const expected=(1-value)*coverage(tailProfiles[0],x,y)+value*coverage(tailProfiles[1],x,y);
          error+=Math.abs(expected-coverage(tailProfiles[value],x,y));count++;
        }
        check(error/count<.04,'intermediate irregularity '+value+' blends coverage without disappearing');
      }
      tailProbe.destroy(true);
      for(const pathCurvature of [-1,0,1]) for(const tailMotion of [0,1,2]) {
        const variant=new FireballEffect(app.renderer,assets,{...request,tuning:{...tuning,pathCurvature,tailMotion},seed:1});app.stage.addChild(variant.container);
        const time=variant.launchSeconds+(tuning.durationMs/1000)*Math.sqrt(.5);
        variant.update(time);app.renderer.render(app.stage);
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d');context.drawImage(app.canvas,0,0);
        const headX=Math.round(960+pathCurvature*655/4),headY=Math.round(830-655/2);
        const pixel=context.getImageData(headX-4,headY-4,8,8).data;
        check(Array.from({length:pixel.length/4},(_,i)=>pixel[i*4]).some(r=>r>180),'curvature '+pathCurvature+' / tail motion '+tailMotion+' renders a luminous head on the expected arc');
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','path-'+pathCurvature+'-motion-'+tailMotion);
        const first=app.canvas.toDataURL();variant.update(variant.impactSeconds+.1);variant.update(time);app.renderer.render(app.stage);
        check(first===app.canvas.toDataURL(),'curved variant '+pathCurvature+'/'+tailMotion+' seeks deterministically');
        variant.update(variant.impactSeconds+0.000001);check(variant.impact.display.visible,'curved variant retains arrival timing');
        const buffers=variant.missile.curvedPlanes.flatMap(p=>p.mesh.geometry.buffers);variant.dispose();
        check(buffers.every(b=>b.destroyed),'curved variant releases its mesh buffers');
      }
      for(const id of ['nature-missile-small','nature-missile-left','arcane-missile-small','cthun-missile']) {
        const template=getVfxTemplate(id);const variant=new FireballEffect(app.renderer,assets,{...request,tuning:template.tuning,prewarmed:true,seed:1});app.stage.addChild(variant.container);
        variant.update(template.tuning.durationMs/1000*Math.sqrt(.5));app.renderer.render(app.stage);
        if(id.startsWith('nature-')) {
          const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d');context.drawImage(app.canvas,0,0);
          const x=Math.round(960+(template.tuning.pathCurvature??0)*655/4);const pixels=context.getImageData(x-60,470,120,200).data;
          check(Array.from({length:pixels.length/4},(_,i)=>i*4).some(i=>pixels[i+1]>100&&pixels[i+1]>pixels[i]*1.15&&pixels[i+1]>pixels[i+2]*1.1),id+' renders a green plume');
        }
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture',id);variant.dispose();
      }
      for(const [source,target] of [
        [{x:960,y:830},{x:960,y:175}], [{x:960,y:175},{x:960,y:830}],
        [{x:450,y:540},{x:1470,y:540}], [{x:500,y:800},{x:1400,y:250}],
        [{x:960,y:540},{x:960,y:540}]
      ]) {
        const variant=new FireballEffect(app.renderer,assets,{source,target,tuning:{...tuning,pathCurvature:1,tailMotion:2},prewarmed:true});app.stage.addChild(variant.container);
        variant.update(tuning.durationMs/2000);app.renderer.render(app.stage);
        check(variant.missile.curvedPlanes.every(p=>p.mesh.geometry.positions.every(Number.isFinite)),'curved direction '+JSON.stringify([source,target])+' has finite vertices');variant.dispose();
      }
      const timeline=gsap.timeline({paused:true});const presenter=new MatchVfxPresenter(assets,()=>timeline,app.renderer);
      let hit=false;const pending=presenter.play(template,true,request.source,request.target).then(()=>{hit=true});
      timeline.time(1.39,false);await Promise.resolve();check(!hit,'match waits until arrival after birth');timeline.time(1.4,false);await pending;
      check(hit&&presenter.layer.children.length===1,'match releases damage at arrival while the visual tail continues');presenter.dispose();check(!presenter.layer.children.length,'match interruption removes the active fireball');
      const lab=new VfxLab({canvas:app.canvas,renderer:app.renderer,parent:document.body,assets});app.stage.addChild(lab);lab.controls.updatePosition();
      for(const time of [0,.1,.2,.3,.4,.5,.7,1,1.1,1.2,1.3,1.4,1.6,2.5,4]){
        while(lab.elapsedMS<time*1000&&lab.playing){lab.update(Math.min(50,time*1000-lab.elapsedMS));}
        app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','lab-'+Math.round(time*1000));
      }
      check(lab.missileEffect.impactSeconds===1.4,'Lab uses the same birth and native flight time');
      const originalToggle=lab.controls.inputs.get('missileOriginalColors');
      originalToggle.checked=false;originalToggle.dispatchEvent(new Event('input'));
      check(lab.controls.inputs.has('flameColor'),'custom missile palette controls appear after disabling original colors');
      const flame=lab.controls.inputs.get('flameColor');flame.value='#0088ff';flame.dispatchEvent(new Event('input'));
      lab.changeSetting('durationMs',650);
      for(const [key,value] of [['pathCurvature',-.8],['tailMotion',.25]]) {
        const input=lab.controls.inputs.get(key);check(!!input,key+' slider is available');input.value=String(value);input.dispatchEvent(new Event('input'));
      }
      let saved;window.api={vfxTemplates:{save:async payload=>{saved=parseVfxTemplateLibrary(payload)}}};await lab.saveTemplates();
      const savedMissile=getVfxTemplate(lab.selectedTemplate.id);
      check(savedMissile.tuning.useOriginalColors===false && savedMissile.tuning.flameColor==='#0088ff' && savedMissile.tuning.durationMs===650,'edited missile colors and timing reach the match library through Save');
      check(saved.templates.find(t=>t.id===savedMissile.id).tuning.flameColor==='#0088ff','saved payload preserves custom missile palette');
      check(savedMissile.tuning.pathCurvature===-.8 && savedMissile.tuning.tailMotion===.25,'path and tail sliders save through the bridge into the match library');
      const savedTimeline=gsap.timeline({paused:true});const savedPresenter=new MatchVfxPresenter(assets,()=>savedTimeline,app.renderer);
      const savedPlay=savedPresenter.play(savedMissile,true,{x:200,y:800},{x:1400,y:200});
      const savedEffect=savedPresenter.layer.children[0];app.stage.addChild(savedPresenter.layer);
      savedTimeline.time(1.3,false);app.renderer.render(app.stage);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture','match-diagonal-custom');
      check(savedEffect.visible,'saved custom missile renders on a diagonal match path');
      savedTimeline.time(1.65,false);await savedPlay;savedPresenter.dispose();savedPresenter.layer.destroy();
      lab.createTemplate();check(lab.selectedTemplate.id!==savedMissile.id && lab.missileEffect.impactSeconds===1.65,'copied missile retains saved timing');
      check(lab.selectedTemplate.tuning.pathCurvature===-.8 && lab.selectedTemplate.tuning.tailMotion===.25,'copied missile retains path and tail tuning');
      const previous=lab.missileEffect;lab.play();check(previous.container.destroyed,'replay disposes the previous missile');
      lab.setLooping(true);while(lab.playing)lab.update(100);
      const completed=lab.missileEffect;for(let i=0;i<30&&lab.missileEffect===completed;i++)lab.update(100);
      check(lab.playing&&lab.missileEffect!==completed&&completed.container.destroyed,'loop restarts after the visible tail and disposes the previous missile');
      lab.setLooping(false);while(lab.playing)lab.update(100);const stopped=lab.missileEffect;
      for(let i=0;i<30;i++)lab.update(100);check(lab.missileEffect===stopped&&!lab.playing,'disabling loop prevents another playback');
      lab.selectEffect('aoe');check(stopped.container.destroyed&&!lab.missileEffect&&!!lab.fireEffect,'switching to AoE releases the missile');
      const aoe=lab.fireEffect;lab.selectEffect('missile');check(aoe.container.destroyed&&!lab.fireEffect&&!!lab.missileEffect,'switching back releases AoE and creates the shared missile');
      const stationary=new FireballEffect(app.renderer,assets,{source:{x:960,y:540},target:{x:960,y:540},tuning});app.stage.addChild(stationary.container);
      stationary.update(.2);app.renderer.render(app.stage);check(Number.isFinite(stationary.container.rotation),'zero-distance target renders without an invalid transform');stationary.dispose();
      const prewarmed=new FireballEffect(app.renderer,assets,{...request,prewarmed:true});check(prewarmed.launchSeconds===0 && prewarmed.impactSeconds===.4 && !prewarmed.birth.display.visible,'prewarmed Idle path skips birth and preserves native flight time');prewarmed.dispose();
      const advanceLabToImpact=()=>{
        const impactMS=lab.selectedEffect==='missile'?lab.missileEffect.impactSeconds*1000:Math.min(lab.fireEffect.duration*1000,lab.selectedTemplate.tuning.impactMs??500);
        while(lab.elapsedMS<impactMS+1)lab.update(Math.min(50,impactMS+1-lab.elapsedMS));
        return impactMS;
      };
      for(const family of ['missile','aoe']){
        lab.selectEffect(family);lab.changeSetting('impactShakeEnabled',true);lab.changeSetting('shakeIntensity',1);
        const impactMS=family==='missile'?lab.missileEffect.impactSeconds*1000:Math.min(lab.fireEffect.duration*1000,lab.selectedTemplate.tuning.impactMs??500);
        while(lab.elapsedMS<impactMS-1)lab.update(Math.min(50,impactMS-1-lab.elapsedMS));
        check(!lab.impactShake.animation && lab.pivot.x===0 && lab.pivot.y===0,family+' preview does not shake before impact');
        advanceLabToImpact();lab.impactShake.animation.pause();app.renderer.render(app.stage);
        const stillFrame=app.canvas.toDataURL();const controlsBefore=lab.controls.host.getBoundingClientRect();
        lab.impactShake.animation.time(.015,false);const normalOffset=lab.pivot.x;app.renderer.render(app.stage);
        check(Math.abs(normalOffset)>1 && stillFrame!==app.canvas.toDataURL(),family+' impact visibly shifts preview pixels at 1x');
        const controlsAfter=lab.controls.host.getBoundingClientRect();
        check(controlsBefore.x===controlsAfter.x&&controlsBefore.y===controlsAfter.y,family+' HTML controls remain stationary');
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture',family+'-impact-shake-1x');
        lab.changeSetting('shakeIntensity',3);check(lab.pivot.x===0&&lab.pivot.y===0,'editing shake resets the old preview offset');
        advanceLabToImpact();lab.impactShake.animation.pause().time(.015,false);app.renderer.render(app.stage);
        check(Math.abs(lab.pivot.x-normalOffset*3)<.00001,family+' 3x intensity triples visible displacement');
        await new Promise(requestAnimationFrame);await ipcRenderer.invoke('capture',family+'-impact-shake-3x');
        lab.impactShake.animation.progress(1,false);check(lab.pivot.x===0&&lab.pivot.y===0,family+' shake restores preview after completion');
        lab.changeSetting('impactShakeEnabled',false);
        check(lab.controls.inputs.get('shakeIntensity').disabled&&lab.settings.shakeIntensity===3,family+' Off disables slider and retains strength');
        await lab.saveTemplates();check(saved.templates.find(t=>t.id===lab.selectedTemplate.id).tuning.impactShake.enabled===false,family+' saves disabled shake');
        advanceLabToImpact();check(!lab.impactShake.animation&&lab.pivot.x===0&&lab.pivot.y===0,family+' disabled toggle suppresses shake');
        lab.changeSetting('impactShakeEnabled',true);check(!lab.controls.inputs.get('shakeIntensity').disabled,family+' On restores slider');
        await lab.saveTemplates();check(saved.templates.find(t=>t.id===lab.selectedTemplate.id).tuning.impactShake.intensity===3,family+' saves custom shake intensity');
        lab.createTemplate();check(lab.selectedTemplate.tuning.impactShake.enabled&&lab.selectedTemplate.tuning.impactShake.intensity===3,family+' copy retains shake settings');
        lab.changeSetting('shakeIntensity',0);advanceLabToImpact();check(!lab.impactShake.animation&&lab.pivot.x===0&&lab.pivot.y===0,family+' intensity zero suppresses shake');
      }
      lab.changeSetting('shakeIntensity',1);advanceLabToImpact();lab.impactShake.animation.pause().time(.015,false);
      lab.dispose();check(lab.pivot.x===0&&lab.pivot.y===0,'disposing preview restores active shake');lab.destroy({children:true});
      check(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,'no WebGL errors');
      check(!assets.fireballCoreClouds.destroyed,'shared source textures survive effect cleanup');app.destroy(true,{children:true});
      return {checks,frames,tailMetrics};
    }
    run().then(result=>ipcRenderer.send('result',result)).catch(error=>ipcRenderer.send('result',{checks,error:error.stack}));
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
    '<!doctype html><html><body style="margin:0;overflow:hidden"><style>canvas{width:1280px;height:720px;display:block}</style><script src="renderer.js"></script></body></html>'
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
