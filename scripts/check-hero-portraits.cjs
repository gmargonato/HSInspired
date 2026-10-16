/** Isolated real-WebGL portrait checks; no game/server or full build is launched. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'hero-portraits-check')

async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 1080,
      height: 860,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    })
    const timeout = setTimeout(() => app.exit(1), 120000)
    ipcMain.handle('image', (_event, name, data) => {
      fs.writeFileSync(
        path.join(output, name + '.png'),
        Buffer.from(data.split(',')[1], 'base64')
      )
    })
    ipcMain.once('result', (_event, result) => {
      clearTimeout(timeout)
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
  const source = `
    import { Application, ColorMatrixFilter, Container, Rectangle, Sprite, Texture } from 'pixi.js';
    import 'pixi.js/prepare';
    import { ipcRenderer } from 'electron';
    import { HeroPortrait } from './src/visual-components/hero-portrait';
    import { DeckEntryButton } from './src/visual-components/controls/deck-entry-button';
    import { HERO_ARTWORK_PLACEMENTS } from './src/visual-components/hero-portrait-layout';
    import { getDeckHeroTexture, DECK_HERO_ASSET_SOURCES, MATCH_HERO_ASSET_SOURCES } from './src/visual-components/assets/hero-assets';
    import { prepareHeroPortraitTextures, getHeroPortraitLayers, premiumHeroPortrait } from './src/visual-components/assets/hero-portrait-textures';
    import { AssetScope, registerAssetBundle } from './src/visual-components/assets/asset-scope';
    import { HeroView } from './src/scenes/match/board/hero-view';
    import { gsap } from './src/visual-components/animation/animations';
    import frame from './assets/images/heroes/frames/hero-frame.png';
    import premiumFrame from './assets/images/heroes/frames/hero-frame -premium.png';
    import mask from './assets/images/heroes/frames/hero-artwork-mask.png';
    const checks = [], errors = [];
    function check(value, message) { if (!value) throw new Error(message); checks.push(message); }
    const shared = {heroPortraitFrame:frame, heroPortraitPremiumFrame:premiumFrame, heroPortraitMask:mask};
    let preparations = 0;
    const prepare = assets => { preparations++; return prepareHeroPortraitTextures(assets); };
    registerAssetBundle('portrait-menu-check', {...DECK_HERO_ASSET_SOURCES,...shared}, {prepare});
    registerAssetBundle('portrait-match-check', {...MATCH_HERO_ASSET_SOURCES,...shared}, {prepare});
    async function run() {
      const app = new Application();
      await app.init({width:1080,height:860, preference:'webgl', backgroundAlpha:0, antialias:false});
      app.stop();
      const menu = new AssetScope(), overlap = new AssetScope(), match = new AssetScope();
      const [a,b] = await Promise.all([menu.acquire('portrait-menu-check'),overlap.acquire('portrait-menu-check')]);
      check(a === b && preparations === 1, 'Concurrent scene loads share one prepared bundle');
      const game = await match.acquire('portrait-match-check');
      check(preparations === 2, 'Match-only art is assembled separately from menu art');
      const assets = {...a,...game};
      await app.renderer.prepare.upload(Object.values(assets));
      check(assets.heroPortraitFrame === a.heroPortraitFrame, 'Menu and match share the same frame source');
      const canvas = target => app.renderer.extract.canvas({target, frame:new Rectangle(0,0,358,410), resolution:1});
      const pixels = target => canvas(target).getContext('2d').getImageData(0,0,358,410).data;
      const error = (a,b) => { let sum=0; for(let i=0;i<a.length;i+=4) {
        for(let c=0;c<3;c++) sum+=Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255);
        sum+=Math.abs(a[i+3]-b[i+3]);
      } return sum/a.length; };
      let worst = 0;
      const sheet = document.createElement('canvas'); sheet.width=358*5;sheet.height=410*Math.ceil(Object.keys(HERO_ARTWORK_PLACEMENTS).length/5);
      const context = sheet.getContext('2d');context.fillStyle='#343b43';context.fillRect(0,0,sheet.width,sheet.height);
      let index=0;
      for(const key of Object.keys(HERO_ARTWORK_PLACEMENTS)) {
        const texture = assets[key];
        check(texture.width===358 && texture.height===410, key+' retains the original canvas dimensions');
        const live = new HeroPortrait(texture), flat = new Sprite(texture);
        const livePixels = pixels(live), flatPixels = pixels(flat);
        const delta = error(livePixels,flatPixels); worst=Math.max(worst,delta);
        check(delta < .3, key+' live layers match its full-surface snapshot');
        for(let y=0;y<410;y++)for(let x=0;x<358;x++) {
          if(x<16||x>=342||y<16||y>=394) {
            if(livePixels[(y*358+x)*4+3]!==0)throw new Error(key+' restored an outer shadow');
          }
        }
        context.drawImage(canvas(live),(index%5)*358,Math.floor(index/5)*410); index++;
        for(const scale of [.45,1,1.65]) {
          live.anchor.set(.5); flat.anchor.set(.5);
          live.position.set(179,205);flat.position.copyFrom(live.position);
          live.scale.set(scale);flat.scale.copyFrom(live.scale);
          live.rotation=flat.rotation=.12;
          const l=live.getBounds(),r=flat.getBounds();
          check(['x','y','width','height'].every(k=>Math.abs(l[k]-r[k])<.001), key+' keeps bounds at scale '+scale);
        }
        live.destroy();flat.destroy();
        check(!texture.destroyed && !getHeroPortraitLayers(texture).artwork.destroyed, key+' display cleanup preserves shared textures');
      }
      await ipcRenderer.invoke('image','portraits',sheet.toDataURL());
      let mageWins=499;
      const stats={getWins:classId=>classId==='Mage'?mageWins:0};
      check(getDeckHeroTexture(a,'hero-jaina',stats)===a['hero-jaina'],'499 wins keeps the standard frame');
      mageWins=500;
      check(getDeckHeroTexture(a,'hero-jaina',stats)===premiumHeroPortrait(a['hero-jaina']),'500 wins selects the preloaded premium texture');
      check(getDeckHeroTexture(a,'hero-guldan',stats)===a['hero-guldan'],'Other classes do not inherit the unlock');
      const premiumSheet=document.createElement('canvas');premiumSheet.width=sheet.width;premiumSheet.height=sheet.height;
      const premiumContext=premiumSheet.getContext('2d');premiumContext.fillStyle='#343b43';premiumContext.fillRect(0,0,premiumSheet.width,premiumSheet.height);
      let premiumIndex=0;
      for(const key of Object.keys(HERO_ARTWORK_PLACEMENTS)) {
        const texture=premiumHeroPortrait(assets[key]);
        check(texture!==assets[key] && texture.width===358 && texture.height===410,key+' premium variant is prepared at the same size');
        const portrait=new HeroPortrait(texture), flat=new Sprite(texture);
        check(getHeroPortraitLayers(texture).premium && portrait.artwork.filters.length===1 && !portrait.frame.filters?.length,key+' animates artwork only');
        check(error(pixels(portrait),pixels(flat))<.3,key+' premium layers match the shader snapshot at neutral saturation');
        premiumContext.drawImage(canvas(portrait),(premiumIndex%5)*358,Math.floor(premiumIndex/5)*410);premiumIndex++;
        portrait.texture=assets[key];
        check(!portrait.artwork.filters.length,key+' standard replacement removes the premium effect');
        portrait.destroy();flat.destroy();
      }
      await ipcRenderer.invoke('image','premium-portraits',premiumSheet.toDataURL());
      const breathing=new HeroPortrait(premiumHeroPortrait(a['hero-jaina']));app.stage.addChild(breathing);
      const neutral=pixels(breathing);
      await new Promise(resolve=>setTimeout(resolve,500));
      const saturated=pixels(breathing);
      check(error(neutral,saturated)>.01,'Premium artwork saturation changes over time');
      const goldPixel=(25*358+179)*4;
      check([0,1,2,3].every(c=>neutral[goldPixel+c]===saturated[goldPixel+c]),'Saturation pulse leaves the premium frame unchanged');
      breathing.destroy();
      const deckButton=new DeckEntryButton(Texture.WHITE,{portrait:a['hero-jaina'],premiumPortrait:true,deckName:'',showDeckName:false});
      check(deckButton.children[0].filters?.length===1,'Deck-button hero artwork receives the class unlock effect');
      deckButton.destroy({children:true});
      check(!a['hero-jaina'].destroyed,'Premium deck-button cleanup preserves shared portrait resources');
      const portrait = new HeroPortrait(assets['hero-jaina']), flat = new Sprite(assets['hero-jaina']);
      const filter = new ColorMatrixFilter();filter.brightness(.35,false);
      portrait.filters=[filter];flat.filters=[filter];
      check(error(pixels(portrait),pixels(flat))<.3,'Whole-surface filter affects frame and artwork together');
      portrait.filters=null;flat.filters=null;
      const before=pixels(portrait);portrait.artwork.filters=[filter];const after=pixels(portrait);
      const framePixel=(25*358+179)*4,artPixel=(205*358+179)*4;
      check(before[framePixel]===after[framePixel] && after[artPixel]<before[artPixel], 'Artwork-only filter leaves the frame unchanged for future premium portraits');
      portrait.destroy();flat.destroy();filter.destroy();
      const view=HeroView.create({label:'hero.check',attack:0,health:30,maxHealth:30,armor:0,frozen:false,immune:false},{frame:assets['hero-jaina'],attack:Texture.EMPTY,health:Texture.EMPTY,armor:Texture.EMPTY,frozen:Texture.EMPTY,immune:Texture.EMPTY});
      app.stage.addChild(view);view.position.set(250,300);view.scale.set(.7);view.rotation=.2;
      const assembly=view.getChildByLabel('hero.frame');
      check(assembly.artwork.parent===assembly && assembly.frame.parent===assembly, 'Match movement bonds artwork and frame to one parent');
      const replacement=view.replaceFrame(assets['hero-ragnaros']);gsap.globalTimeline.progress(1);await replacement;
      check(assembly.texture===assets['hero-ragnaros'] && assembly.artwork.texture===getHeroPortraitLayers(assembly.texture).artwork, 'Hero replacement updates both layers through the same flip');
      const copy=view.createPortrait();
      check(copy.children[0] instanceof HeroPortrait && copy.children[0].texture===assembly.texture, 'Result and destruction copies retain the full portrait');
      app.renderer.render(copy);copy.destroy({children:true});view.destroy({children:true});
      await menu.releaseAll();check(!a['hero-jaina'].destroyed,'Overlapping scene retains menu portrait textures');
      await overlap.releaseAll();check(a['hero-jaina'].destroyed,'Final menu owner disposes generated portrait textures');
      check(!game.heroPortraitFrame.destroyed,'Match ownership retains the shared frame after menus release');
      const transformed=game['hero-ragnaros'],art=getHeroPortraitLayers(transformed).artwork;
      await match.releaseAll();check(transformed.destroyed && art.destroyed,'Match release disposes snapshots and prepared artwork');
      const reload=new AssetScope();const reloaded=await reload.acquire('portrait-menu-check');
      check(!reloaded['hero-jaina'].destroyed && reloaded['hero-jaina']!==a['hero-jaina'],'Returning scene recreates valid prepared resources');
      await reload.releaseAll();
      check(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,'No WebGL errors');
      app.destroy(true,{children:true});return {checks,worstPixelError:worst};
    }
    run().then(result=>ipcRenderer.send('result',result)).catch(error=>ipcRenderer.send('result',{checks,error:error.stack}));
  `
  await require('esbuild').build({
    stdin: { contents: source, loader: 'ts', resolveDir: root },
    outfile: path.join(output, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    define: { 'import.meta.env.DEV': 'false' },
    external: ['electron'],
    loader: { '.png': 'dataurl' },
    alias: { '@assets': path.join(root, 'assets') },
    logLevel: 'error'
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html><body><script src="renderer.js"></script></body></html>'
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
