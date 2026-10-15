import { Filter, type Texture } from 'pixi.js'
import {
  FIRE_VFX_VERTEX_SHADER,
  FIRE_VFX_NOISE_GLSL,
  hexColorToRgb
} from './fire-vfx-shader-common'

export const MISSILE_VFX_TIMING = {
  launch: 0.16,
  arrival: 0.58,
  trailEnd: 0.84
} as const
export interface MissileVfxPalette {
  readonly flameColor: string
  readonly coreColor: string
  readonly headSurfaceColor?: string
  readonly edgeColor?: string
  readonly foldColor?: string
  readonly glowColor?: string
  readonly sootColor?: string
}
export interface MissileVfxTuning {
  readonly intensity: number
  readonly noiseScale: number
  readonly flowSpeed: number
  readonly turbulence: number
  readonly width: number
  /** Maximum deposited trail length, in design pixels. */
  readonly trailLength: number
  readonly glow?: number
  readonly headStartSize?: number
  readonly headEndSize?: number
  readonly headGrowthMs?: number
  readonly durationMs?: number
}
interface MissileVfxUniformValues {
  uHeadStartSize: number
  uHeadEndSize: number
  uHeadGrowthMs: number
  uDurationMs: number
  uGlow: number
  uHeadSurfaceColor: Float32Array
  uEdgeColor: Float32Array
  uFoldColor: Float32Array
  uGlowColor: Float32Array
  uSootColor: Float32Array
  uTime: number
  uProgress: number
  uIntensity: number
  uNoiseScale: number
  uFlowSpeed: number
  uTurbulence: number
  uWidth: number
  uTrailLength: number
  uSize: Float32Array
  uSource: Float32Array
  uTarget: Float32Array
  uFlameColor: Float32Array
  uCoreColor: Float32Array
}
const fragment = `#version 300 es
in vec2 vTextureCoord;
in vec2 vVfxUv;
out vec4 finalColor;
uniform sampler2D uTexture, uNoise;
uniform float uTime, uProgress, uIntensity, uNoiseScale, uFlowSpeed, uTurbulence, uWidth, uTrailLength, uGlow;
uniform float uHeadStartSize, uHeadEndSize, uHeadGrowthMs, uDurationMs;
uniform vec2 uSize, uSource, uTarget;
uniform vec3 uFlameColor, uCoreColor, uHeadSurfaceColor, uEdgeColor, uFoldColor, uGlowColor, uSootColor;
${FIRE_VFX_NOISE_GLSL}
// Coverage and temperature are separate: the bright body stays connected while
// larger rolling folds disturb its silhouette. Fine noise never shreds the core.
vec2 fireOrb(vec2 p, float radius, float age, float seed) {
  float t = uTime * uFlowSpeed;
  vec2 uv = p / radius;
  vec2 flow = uv * uNoiseScale * 0.42;
  vec2 warp = vec2(fireFbm(flow + seed - vec2(0.0,t)),
                   fireFbm(flow + seed + 9.2 + vec2(t*0.7,0.0))) - 0.5;
  float cloud = fireFbm(flow + warp * 2.3 + seed + vec2(0.0,-t*1.2));
  float angle = (dot(p,p)>0.0001 ? atan(p.y,p.x) : 0.0);
  float lobes = sin(angle*5.0 + t*2.1 + cloud*4.0)*0.07
              + sin(angle*3.0 - t*1.4)*0.055;
  float d = length(uv);
  float detail = fireFbm(flow*3.1+warp*3.0-vec2(t*0.4,t*1.3));
  float edge = d + (cloud-0.5)*uTurbulence*0.72 + lobes*uTurbulence
             + (detail-0.5)*0.24*uTurbulence;
  float body = 1.0-smoothstep(0.84,1.04,edge);
  float erosion = smoothstep(age*0.96-0.12,age*0.96+0.10,cloud);
  float fold = fireFbm(flow*1.65+warp*3.2+vec2(t*0.3,-t));
  float ridge = smoothstep(0.39,0.58,fold);
  float hotCenter = 1.0-smoothstep(0.10,0.72,d);
  float heat = clamp(0.40+hotCenter*0.46+ridge*0.28-d*0.16+(detail-0.5)*0.28,0.0,1.0);
  return vec2(body*erosion,heat);
}
void main() {
  vec2 pixel = vVfxUv*uSize;
  float progress = clamp(uProgress,0.0,1.0);
  float t = uTime*uFlowSpeed;
  vec2 path = uTarget-uSource;
  float distance = length(path);
  vec2 direction = distance > 0.001 ? path/distance : vec2(0.0,-1.0);
  vec2 normal = vec2(-direction.y,direction.x);
  vec2 relative = pixel-uSource;
  float along = dot(relative,direction);
  float across = dot(relative,normal);
  float flight = clamp((progress-${MISSILE_VFX_TIMING.launch})/${MISSILE_VFX_TIMING.arrival - MISSILE_VFX_TIMING.launch},0.0,1.0);
  float travel = distance*pow(flight,1.08);
  float post = clamp((progress-${MISSILE_VFX_TIMING.arrival})/${1 - MISSILE_VFX_TIMING.arrival},0.0,1.0);
  float radius = mix(33.0,59.0,clamp((uWidth-0.12)/0.36,0.0,1.0));
  vec2 headPoint = uSource+direction*travel;
  float launch = smoothstep(${MISSILE_VFX_TIMING.launch},${MISSILE_VFX_TIMING.launch + 0.035},progress);
  float headLife = smoothstep(0.0,0.035,progress)*(1.0-smoothstep(${MISSILE_VFX_TIMING.arrival},${MISSILE_VFX_TIMING.arrival + 0.035},progress));
  // The rounded head carries a vertically rolling molten surface. Its shallow
  // leading-edge imperfections are applied separately from the surface islands.
  float growth = uHeadGrowthMs <= 0.0 ? 1.0 : smoothstep(0.0,uHeadGrowthMs,progress*uDurationMs);
  float headRadius = max(mix(uHeadStartSize,uHeadEndSize,growth)*0.5,1.0);
  vec2 headUv = (pixel-headPoint)/max(headRadius,1.0);
  float headDistance = length(headUv);
  // Sample a fixed molten volume on a rotating sphere. Surface features travel
  // coherently and foreshorten at the rim instead of simply flickering in place.
  float sphereZ = sqrt(max(0.0,1.0-dot(headUv,headUv)));
  float spin = t*3.0;
  // Turn over a horizontal axis: texture travels vertically, not around
  // the screen-space circle and not sideways around a vertical axis.
  vec3 sphere = vec3(cos(spin)*headUv.y+sin(spin)*sphereZ,headUv.x,
                     -sin(spin)*headUv.y+cos(spin)*sphereZ);
  float surface = fireNoise(sphere.xy*3.2+6.3)*0.58
                + fireNoise(sphere.yz*3.2+13.1)*0.30
                + fireFbm(sphere.xy*4.0+sphere.z*0.7+6.3)*0.12;
  float surfaceIslands = smoothstep(0.56,0.68,surface)
                   *(1.0-smoothstep(0.68,0.88,headDistance+(surface-0.5)*0.12));
  float hotCore = 1.0-smoothstep(0.30,0.90,headDistance);
  vec3 hotSurface = mix(uFlameColor,uCoreColor,clamp(0.32+hotCore*0.68+(surface-0.5)*0.30,0.0,1.0));
  vec3 islandSurface = mix(uEdgeColor,uHeadSurfaceColor,
                        smoothstep(0.58,0.76,surface));
  vec3 headColor = mix(hotSurface,islandSurface,surfaceIslands);
  // Small flowing imperfections keep a rounded leading dome without a rigid
  // compass-drawn edge. Rear shoulder/roll coordinates remain unchanged.
  float leading = smoothstep(-0.25,0.65,dot(headUv,direction));
  float contourNoise = fireFbm(headUv*3.4+vec2(t*0.35,-t*0.65)+17.4);
  float contourDistance = headDistance+(contourNoise-0.5)*0.34*leading;
  vec2 head = vec2((1.0-smoothstep(0.96,1.02,contourDistance))*headLife,0.85);

  // Broad overlapping hot lobes connect directly to the head. Their centers stay
  // close to the travel axis; local puffs churn without a whole-plume slalom.
  float trailLength = min(travel,uTrailLength);
  float tailStart = max(0.0,travel-trailLength);
  float behind = clamp((travel-along)/max(trailLength,1.0),0.0,1.0);
  float age = clamp((progress-${MISSILE_VFX_TIMING.arrival})/${MISSILE_VFX_TIMING.trailEnd - MISSILE_VFX_TIMING.arrival},0.0,1.0);
  vec2 flow = vec2(along/95.0-t*1.6,across/90.0)*uNoiseScale*0.42;
  vec2 warp = vec2(fireFbm(flow+12.1),fireFbm(flow+31.7))-0.5;
  float cloud = fireFbm(flow+warp*2.0);
  float width = radius*mix(0.10,0.78,pow(1.0-behind,0.48));
  float d = abs(across)/max(width,1.0);
  float wake = (1.0-smoothstep(0.65,1.15,d+(cloud-0.5)*0.45))*0.75;
  for (int i=0; i<11; i++) {
    float fi = float(i);
    float puffSeed = fireHash(vec2(fi,41.3));
    float fraction = clamp((fi+(puffSeed-0.5)*0.4)/10.0,0.0,1.0);
    float centerAlong = travel-headRadius*0.30-fraction*max(trailLength-headRadius*0.30,1.0);
    float puffRadius = radius*(0.12+0.90*pow(1.0-fraction,0.52));
    puffRadius *= (0.82+puffSeed*0.32)*(0.94+sin(fi*1.9+t*2.4)*0.08);
    puffRadius = mix(max(puffRadius,headRadius*0.95),puffRadius,smoothstep(0.0,0.16,fraction));
    float centerAcross = sin(fi*2.4+t*1.8)*puffRadius*0.14*uTurbulence;
    float longitudinal = min(max(trailLength/10.0*0.80,puffRadius*0.85),puffRadius*1.65);
    vec2 puffUv = vec2((along-centerAlong)/max(longitudinal,1.0),
                      (across-centerAcross)/max(puffRadius,1.0));
    float puffEdge = length(puffUv)+(cloud-0.5)*0.48*uTurbulence;
    float puff = 1.0-smoothstep(0.74,1.18,puffEdge);
    wake = max(wake,puff);
  }
  // A broad continuous shoulder replaces the pinched neck immediately behind
  // the round leading half; local folds shade it without cutting a second rim.
  vec2 shoulderUv = vec2((along-travel+headRadius*0.64)/(headRadius*1.05),
                        across/(headRadius*0.94));
  float shoulder = 1.0-smoothstep(0.78,1.12,length(shoulderUv)+(cloud-0.5)*0.12);
  wake = max(wake,shoulder*headLife);
  wake *= smoothstep(tailStart-10.0,tailStart+20.0,along)
        *(1.0-smoothstep(travel-headRadius*0.15,travel+headRadius*0.25,along))*launch*step(0.001,distance);
  float tailBreakup = fireFbm(vec2(along/24.0-t*1.5,across/21.0)+9.7);
  wake *= mix(1.0,smoothstep(0.42,0.62,tailBreakup),smoothstep(0.64,0.90,behind));
  wake *= smoothstep(age*1.15-0.12,age*1.15+0.12,cloud);
  wake *= 1.0-smoothstep(0.48,0.85,age);
  float hotCloud = smoothstep(0.35,0.65,cloud);
  // Two scales of advected folds shade the plume volume without shredding its
  // connected silhouette. Broad warm recesses sit beneath small hot channels.
  float folds = fireFbm(flow*1.55+warp*3.4+vec2(4.2,-t*0.28));
  float channels = fireNoise(flow*4.0+warp*3.0+vec2(-t*0.4,8.1));
  float recess = smoothstep(0.48,0.69,folds);
  float hotChannel = smoothstep(0.46,0.70,channels)*(1.0-recess*0.65);
  float wakeHeat = clamp(0.73+hotCloud*0.14+hotChannel*0.15-recess*0.34
                         -smoothstep(0.45,1.25,d)*0.12-behind*0.04,0.0,1.0);

  // Deposited flame scraps drift and fade independently, without a source swirl.
  vec2 origin = pixel-uSource;
  float chargeRadius = radius;
  float chargeLife = smoothstep(0.035,0.16,progress)*(1.0-smoothstep(0.40,0.88,progress));
  vec2 charge = vec2(0.0);
  // Stationary asymmetric launch flame: an open base and a taller left tongue.
  // The lobes flicker locally and erode; their positions never orbit the source.
  vec2 sourceUv = vec2(dot(origin,normal),dot(origin,direction));
  for (int i=0; i<7; i++) {
    float fi = float(i);
    float angle = 2.55+fi*0.48;
    vec2 center = vec2(cos(angle)*52.0,sin(angle)*43.0);
    vec2 uv = (sourceUv-center)/vec2(20.0+mod(fi*5.3,9.0),25.0+mod(fi*3.7,12.0));
    if (i == 0) { uv.y *= 0.70; uv.x += uv.y*0.18; }
    float fold = fireFbm(uv*1.05+vec2(fi*2.7,-t*1.3));
    float edge = length(uv)+(fold-0.5)*0.48;
    float lobe = (1.0-smoothstep(0.68,1.08,edge))*chargeLife;
    float erosion = smoothstep(0.48,0.82,progress);
    lobe *= mix(1.0,smoothstep(0.37,0.67,fold),erosion);
    if (lobe*0.85 > charge.x) charge.y = fold;
    charge.x = max(charge.x,lobe*0.85);
  }
  float embers = 0.0;
  float emberHeat = 0.5;
  float emberGlow = 0.0;
  float soot = 0.0;
  for (int i=0; i<22; i++) {
    float fi = float(i);
    float seed = fireHash(vec2(fi,13.7));
    float emitted = fi/21.0;
    float birth = 0.11+emitted*0.42+(seed-0.5)*0.018;
    float emberAge = (progress-birth)*uDurationMs/(380.0+seed*220.0);
    float valid = step(0.0,emberAge)*(1.0-smoothstep(0.35,1.0,emberAge))*(0.60+seed*0.40);
    float birthFlight = clamp((birth-${MISSILE_VFX_TIMING.launch})/${MISSILE_VFX_TIMING.arrival - MISSILE_VFX_TIMING.launch},0.0,1.0);
    float deposited = distance*pow(birthFlight,1.08);
    float side = fireHash(vec2(fi,7.3))*2.0-1.0;
    float drift = max(emberAge,0.0);
    vec2 emberPoint = uSource+direction*(deposited-drift*(18.0+mod(fi*7.0,22.0)))
                    +normal*side*(25.0+seed*45.0+drift*(25.0+seed*40.0));
    vec2 ep = pixel-emberPoint;
    float er = (5.0+mod(fi*3.7,8.0)+(1.0-step(4.0,fi))*6.0)*(1.0-drift*0.55);
    vec2 scrapUv = vec2(dot(ep,normal),dot(ep,direction))/max(er,0.5);
    float tilt = (seed-0.5)*1.2;
    scrapUv = mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*scrapUv;
    scrapUv.x += sin(scrapUv.y*1.7+fi)*0.24;
    scrapUv.x /= 0.62+0.28*smoothstep(-1.0,1.0,scrapUv.y);
    scrapUv.y *= 0.48+mod(fi*0.17,0.35);
    float ed = length(scrapUv)+sin(scrapUv.y*3.0+fi)*0.12;
    float scrap = (1.0-smoothstep(0.50,1.1,ed))*valid;
    if (scrap > embers) emberHeat = 0.43+mod(fi*0.13,0.36);
    embers = max(embers,scrap);
    emberGlow += exp(-ed*ed*0.35)*valid*0.08;
    vec2 smokePoint = emberPoint-direction*drift*20.0;
    vec2 smokeUv = (pixel-smokePoint)/max(12.0+seed*9.0+drift*15.0,1.0);
    float smokeNoise = fireNoise(smokeUv*2.0+fi*7.3);
    float smokeLife = step(0.0,emberAge)*smoothstep(0.12,0.45,emberAge)
                    *(1.0-smoothstep(0.65,1.15,emberAge));
    soot = max(soot,exp(-dot(smokeUv,smokeUv)*1.3)*(0.35+smokeNoise*0.65)*smokeLife);
    float ash = (1.0-smoothstep(0.10,0.28,length(smokeUv+vec2(seed*0.3,0.1))))*smokeLife;
    soot = max(soot,ash*(0.45+seed*0.35));

  }

  // A separate cast burst stays near the origin after the projectile departs.
  // Unequal drifting scraps have no shared angular motion or connected swirl.
  for (int i=0; i<9; i++) {
    float fi = float(i);
    float seed = fireHash(vec2(fi,31.4));
    float side = fireHash(vec2(fi,19.2))*2.0-1.0;
    float birth = 0.045+seed*0.09;
    float age = (progress-birth)*uDurationMs/(570.0+seed*180.0);
    float drift = max(age,0.0);
    float life = smoothstep(0.0,0.10,age)*(1.0-smoothstep(0.38,1.0,age));
    vec2 point = uSource+normal*(side*(20.0+seed*22.0)+side*drift*13.0)
               +direction*((seed-0.5)*38.0+drift*(12.0+seed*24.0));
    vec2 local = pixel-point;
    float size = (10.0+seed*9.0)*(1.0-clamp(drift,0.0,1.0)*0.48);
    vec2 uv = vec2(dot(local,normal),dot(local,direction))/max(size,1.0);
    uv.x += sin(uv.y*2.0+fi+t*1.7)*0.22;
    uv.x *= 1.15+seed*0.45;
    uv.y *= 0.55+seed*0.35;
    float shape = length(uv)+(fireNoise(uv*2.4+fi*3.7)-0.5)*0.30;
    float scrap = (1.0-smoothstep(0.45,1.0,shape))*life*0.30;
    if (scrap > embers) emberHeat = 0.48+seed*0.20;
    embers = max(embers,scrap);
    emberGlow += exp(-shape*shape*0.8)*life*0.025;
    vec2 smokeUv = (local-direction*drift*8.0)/(size+drift*12.0+4.0);
    float smokeLife = smoothstep(0.24,0.60,age)*(1.0-smoothstep(0.65,1.08,age));
    soot = max(soot,exp(-dot(smokeUv,smokeUv)*1.8)*smokeLife*0.48);
  }

  // A filled arrival flash opens into asymmetric, disconnected curved fragments.
  vec2 hit = pixel-uTarget;
  float impactRadius = radius*(1.05+0.95*smoothstep(0.0,0.72,post));
  float impactLife = smoothstep(${MISSILE_VFX_TIMING.arrival - 0.008},${MISSILE_VFX_TIMING.arrival + 0.04},progress)
                   *(1.0-smoothstep(0.76,1.0,post));
  vec2 impact = fireOrb(hit,impactRadius,0.0,23.1);
  float hitAngle = (dot(hit,hit)>0.0001 ? atan(hit.y,hit.x) : 0.0);
  float hitRadius = length(hit)/impactRadius;
  float breakup = smoothstep(0.22,0.90,post);
  float fragments = fireFbm(vec2(cos(hitAngle),sin(hitAngle))*3.2+hitRadius*1.6+23.1);
  float shell = smoothstep(0.22+breakup*0.32,0.53+breakup*0.28,
                          hitRadius+(fragments-0.5)*0.65);
  impact.x *= mix(1.0,shell,smoothstep(0.18,0.48,post));
  impact.x *= smoothstep(breakup*0.75-0.15,breakup*0.75+0.08,fragments)*impactLife;
  impact.y = mix(1.0,impact.y,smoothstep(0.12,0.55,post));

  float flame = max(max(head.x,wake),max(max(embers,charge.x),impact.x));
  float wakeWeight = wake*(1.0-head.x*0.92);
  float weight = max(head.x+wakeWeight+embers+charge.x+impact.x,0.001);
  float heat = (head.x*head.y+wakeWeight*wakeHeat+embers*emberHeat+charge.x*charge.y+impact.x*impact.y)/weight;
  // Halo uses the lifecycle, not surface coverage, so it can extend past the edge.
  float halo = exp(-dot(pixel-headPoint,pixel-headPoint)/(headRadius*headRadius*2.8))*headLife*0.40;
  halo += exp(-dot(origin,origin)/(chargeRadius*chargeRadius*1.8))*chargeLife*0.15;
  halo += exp(-dot(hit,hit)/(impactRadius*impactRadius*2.3))*impactLife*(1.0-breakup)*0.55;
  float wakeHalo = exp(-d*d*0.55)*0.12*wake*mix(0.60,0.08,behind);
  halo = (halo+wakeHalo+emberGlow)*uGlow;
  vec3 color = mix(uEdgeColor*0.65,uEdgeColor,smoothstep(0.0,0.25,heat));
  color = mix(color,uFlameColor,smoothstep(0.16,0.52,heat));
  color = mix(color,uCoreColor,smoothstep(0.72,0.98,heat));
  // Material shading is separate from alpha: overlapping orange folds stay
  // opaque while hot ridges reveal a second, brighter layer inside the plume.
  float foldShade = smoothstep(0.50,0.69,folds);
  float ridgeLight = smoothstep(0.38,0.65,channels)*(1.0-foldShade*0.75);
  vec3 plumeColor = mix(uFlameColor,uFoldColor,foldShade*0.58);
  plumeColor = mix(plumeColor,uCoreColor,clamp(0.52+ridgeLight*0.48-foldShade*0.26,0.0,1.0));
  // The head owns the brightness hierarchy; deposited flame cools toward the
  // tail in both opaque material and glow, not only its outer halo.
  float cooling = smoothstep(0.03,0.94,behind);
  vec3 cooledFlame = mix(uFoldColor,uFlameColor,0.62-foldShade*0.24);
  plumeColor = mix(plumeColor,cooledFlame,cooling*0.88);
  plumeColor *= mix(0.96,0.76,cooling);
  color = mix(color,plumeColor,clamp(wake,0.0,1.0)*(1.0-impact.x));
  vec3 sourceColor = mix(uFlameColor,uFoldColor,smoothstep(0.42,0.72,charge.y)*0.48);
  sourceColor = mix(sourceColor,uCoreColor,(1.0-smoothstep(0.34,0.52,charge.y))*0.38);
  color = mix(color,sourceColor,clamp(charge.x/(charge.x+wake+head.x+0.001),0.0,1.0));
  float grain = texture(uNoise,fract(pixel/700.0+vec2(0.0,-t*0.05))).r;
  color *= 0.99+grain*0.02;
  // The rear hemisphere becomes the plume material itself, not a separately
  // outlined disk laid over it. Shared folds cross the interior and rear rim;
  // the leading hemisphere keeps its circular molten surface and vertical roll.
  float rear = dot(headUv,-direction);
  float rearBlend = smoothstep(-0.35,0.30,rear+(folds-0.5)*0.40)*launch;
  vec3 joinedHead = mix(headColor,plumeColor,rearBlend);
  color = mix(color,joinedHead,head.x);
  float bodyAlpha = 1.0-exp(-flame*2.5*uIntensity);
  float agedWake = smoothstep(0.32,0.96,behind)*wake/max(wake+embers,0.001);
  agedWake *= (1.0-head.x)*(1.0-clamp(impact.x,0.0,1.0));
  bodyAlpha *= 1.0-agedWake*0.35;
  float visibility = smoothstep(0.0,0.015,progress)*(1.0-smoothstep(0.97,1.0,progress));
  visibility *= texture(uTexture,vTextureCoord).a;
  // Softly extinguish residual light before the bounded effect quad ends.
  vec2 edgeDistance = min(pixel,uSize-pixel);
  visibility *= smoothstep(0.0,22.0,min(edgeDistance.x,edgeDistance.y));
  // Premultiplied emissive halo adds warm light without painting a foggy opaque disk.
  float smokeAlpha = soot*0.42*(1.0-head.x);
  float alpha = clamp(bodyAlpha+smokeAlpha*(1.0-bodyAlpha)+halo*0.12,0.0,1.0);
  vec3 emission = uGlowColor*halo*0.72;
  emission *= 1.0-head.x*(0.96-rearBlend*0.28);
  vec3 sootColor = uSootColor;
  vec3 premultiplied = color*bodyAlpha+sootColor*smokeAlpha*(1.0-bodyAlpha)+emission;
  finalColor = vec4(premultiplied*visibility,alpha*visibility);
}`

/** Charge, deposited trail, arrival flash and dissolving flame shell in one bounded quad. */
export class MissileVfxShader {
  readonly filter: Filter
  private readonly uniforms: MissileVfxUniformValues
  constructor(noise: Texture) {
    this.filter = Filter.from({
      gl: {
        vertex: FIRE_VFX_VERTEX_SHADER,
        fragment,
        name: 'missile-vfx',
        preferredFragmentPrecision: 'highp'
      },
      padding: 0,
      clipToViewport: false,
      antialias: 'inherit',
      resources: {
        uNoise: noise.source,
        missileVfxUniforms: {
          uHeadStartSize: { value: 28, type: 'f32' },
          uHeadEndSize: { value: 116, type: 'f32' },
          uHeadGrowthMs: { value: 350, type: 'f32' },
          uDurationMs: { value: 950, type: 'f32' },
          uGlow: { value: 0.8, type: 'f32' },
          uHeadSurfaceColor: { value: hexColorToRgb('#d90c00'), type: 'vec3<f32>' },
          uEdgeColor: { value: hexColorToRgb('#ff6300'), type: 'vec3<f32>' },
          uFoldColor: { value: hexColorToRgb('#d84a08'), type: 'vec3<f32>' },
          uGlowColor: { value: hexColorToRgb('#ffb02e'), type: 'vec3<f32>' },
          uSootColor: { value: hexColorToRgb('#1f130b'), type: 'vec3<f32>' },
          uTime: { value: 0, type: 'f32' },
          uProgress: { value: 1, type: 'f32' },
          uIntensity: { value: 1.7, type: 'f32' },
          uNoiseScale: { value: 2.8, type: 'f32' },
          uFlowSpeed: { value: 1.2, type: 'f32' },
          uTurbulence: { value: 0.85, type: 'f32' },
          uWidth: { value: 0.32, type: 'f32' },
          uTrailLength: { value: 550, type: 'f32' },
          uSize: { value: new Float32Array([290, 945]), type: 'vec2<f32>' },
          uSource: { value: new Float32Array([145, 800]), type: 'vec2<f32>' },
          uTarget: { value: new Float32Array([145, 145]), type: 'vec2<f32>' },
          uFlameColor: { value: hexColorToRgb('#ffd820'), type: 'vec3<f32>' },
          uCoreColor: { value: hexColorToRgb('#fffdd6'), type: 'vec3<f32>' }
        }
      }
    })
    this.uniforms = this.filter.resources.missileVfxUniforms
      .uniforms as MissileVfxUniformValues
  }
  setPalette(palette: MissileVfxPalette): void {
    this.uniforms.uHeadSurfaceColor.set(
      hexColorToRgb(palette.headSurfaceColor ?? palette.edgeColor ?? palette.flameColor)
    )
    this.uniforms.uEdgeColor.set(hexColorToRgb(palette.edgeColor ?? palette.flameColor))
    this.uniforms.uFoldColor.set(
      hexColorToRgb(palette.foldColor ?? palette.edgeColor ?? palette.flameColor)
    )
    this.uniforms.uGlowColor.set(hexColorToRgb(palette.glowColor ?? palette.flameColor))
    this.uniforms.uSootColor.set(hexColorToRgb(palette.sootColor ?? '#1f130b'))
    this.uniforms.uFlameColor.set(hexColorToRgb(palette.flameColor))
    this.uniforms.uCoreColor.set(hexColorToRgb(palette.coreColor))
  }
  setTuning(tuning: MissileVfxTuning): void {
    this.uniforms.uHeadStartSize = tuning.headStartSize ?? 28
    this.uniforms.uHeadEndSize = tuning.headEndSize ?? 116
    this.uniforms.uHeadGrowthMs = tuning.headGrowthMs ?? 350
    this.uniforms.uDurationMs = tuning.durationMs ?? 950
    this.uniforms.uGlow = tuning.glow ?? 0.8
    this.uniforms.uIntensity = tuning.intensity
    this.uniforms.uNoiseScale = tuning.noiseScale
    this.uniforms.uFlowSpeed = tuning.flowSpeed
    this.uniforms.uTurbulence = tuning.turbulence
    this.uniforms.uWidth = tuning.width
    this.uniforms.uTrailLength = tuning.trailLength
  }
  setGeometry(
    size: { width: number; height: number },
    source: { x: number; y: number },
    target: { x: number; y: number }
  ): void {
    this.uniforms.uSize.set([size.width, size.height])
    this.uniforms.uSource.set([source.x, source.y])
    this.uniforms.uTarget.set([target.x, target.y])
  }
  setFrame(time: number, progress: number): void {
    this.uniforms.uTime = time
    this.uniforms.uProgress = progress
  }
  dispose(): void {
    this.filter.destroy()
  }
}
