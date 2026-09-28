// The physical models: KiCad GLB of the populated board + earwire, the STEP case, and a CR2032.
// World units are millimetres, Y up, board face toward +Z, eyelet at the top.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

export const EYELET = new THREE.Vector3(0, 13, 0.5);  // eyelet hole centre (KiCad 0,-13), mid-board

const M = {
  mask: new THREE.MeshPhysicalMaterial({color: 0x0a0a0c, roughness: 0.38, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.34}),
  enig: new THREE.MeshPhysicalMaterial({color: 0xd9ad55, roughness: 0.22, metalness: 1}),
  silk: new THREE.MeshStandardMaterial({color: 0xe9e6df, roughness: 0.75}),
  fr4: new THREE.MeshStandardMaterial({color: 0x2c2a1f, roughness: 0.7}),
  gold: new THREE.MeshPhysicalMaterial({color: 0xe7bb5d, roughness: 0.16, metalness: 1, clearcoat: 0.3}),
  steel: new THREE.MeshPhysicalMaterial({color: 0xc9ccd2, roughness: 0.2, metalness: 1}),
  nickel: new THREE.MeshPhysicalMaterial({color: 0xb9b6ae, roughness: 0.28, metalness: 1}),
  tube: new THREE.MeshPhysicalMaterial({color: 0xf2efe6, roughness: 0.35, transmission: 0.4, thickness: 0.3}),
  maskMatte: new THREE.MeshStandardMaterial({color: 0x0b0b0d, roughness: 0.6, metalness: 0, envMapIntensity: 0.35}),
  magnet: new THREE.MeshPhysicalMaterial({color: 0xcfd0d2, roughness: 0.18, metalness: 1}),
};
export const MATERIALS = M;

// Polished marble, veined in 3D from the surface position (object space, mm), so the veins run
// continuously over edges and chamfers like cut stone, with no UVs needed on the STEP-derived meshes.
const NOISE_GLSL = `
vec3 mm289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mm289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mperm(vec4 x){return mm289(((x*34.0)+1.0)*x);}
vec4 mtis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float msnoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mm289(i);
  vec4 p=mperm(mperm(mperm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=mtis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float mfbm(vec3 p){float a=0.5,f=0.0;for(int i=0;i<5;i++){f+=a*msnoise(p);p*=2.03;a*=0.5;}return f;}
float marbleVein(vec3 p, float seed){
  // Carrara: long veins with one dominant flow (gentle warp, so the bands never fold into closed
  // loops), a soft grey haze around a thinner core, faded in and out along their length, plus sparse hairlines
  vec3 q=p*uMarbleScale+seed;
  float warp=mfbm(q*0.35)*2.2+mfbm(q*1.3+11.0)*0.35;
  float v=abs(sin(dot(q,vec3(0.83,0.31,0.47))*1.7+warp*1.3));
  float fade=0.35+0.65*smoothstep(-0.3,0.35,mfbm(q*0.5+3.7));
  float haze=pow(1.0-v,3.5)*0.5, core=pow(1.0-v,24.0)*0.8;
  float h=abs(sin(dot(q,vec3(-0.2,0.9,0.35))*2.6+mfbm(q*0.8+7.0)*2.4));
  float hair=pow(1.0-h,60.0)*0.55*smoothstep(-0.1,0.4,mfbm(q*0.6+19.0));
  return clamp((haze+core)*fade+hair,0.0,1.0);
}`;

export function marbleMaterial({base, cloud, vein, scale = 0.05, seed = 0, roughness = 0.22}) {
  const m = new THREE.MeshPhysicalMaterial({color: 0xffffff, roughness, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.16});
  const U = {uMarbleBase: {value: new THREE.Color(base)}, uMarbleCloud: {value: new THREE.Color(cloud)},
    uMarbleVein: {value: new THREE.Color(vein)}, uMarbleScale: {value: scale}, uMarbleSeed: {value: seed}};
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMarblePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarblePos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vMarblePos;
uniform vec3 uMarbleBase; uniform vec3 uMarbleCloud; uniform vec3 uMarbleVein; uniform float uMarbleScale; uniform float uMarbleSeed;
${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float cl = mfbm(vMarblePos*uMarbleScale*0.35+uMarbleSeed)*0.5+0.5;
  vec3 stone = mix(uMarbleBase, uMarbleCloud, smoothstep(0.25,0.85,cl));
  float vn = marbleVein(vMarblePos, uMarbleSeed);
  diffuseColor.rgb = mix(stone, uMarbleVein, vn);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor + 0.12, marbleVein(vMarblePos, uMarbleSeed));`);
  };
  m.customProgramCacheKey = () => 'marble';
  return m;
}
// white Carrara for both halves (a different seed on the lid so the veins don't repeat)
M.carrara = marbleMaterial({base: 0xeceae6, cloud: 0xdcdad6, vein: 0x6f747d, scale: 0.055, seed: 3.1});
M.carraraLid = marbleMaterial({base: 0xeceae6, cloud: 0xdcdad6, vein: 0x6f747d, scale: 0.055, seed: 17.3});

function mm(obj) { obj.scale.setScalar(1000); return obj; }

export async function loadRig(base = '/build/models/') {
  const [gltf, caseBot, caseTop] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'halo90.glb'),
    new STLLoader().loadAsync(base + 'caseBot.stl'),
    new STLLoader().loadAsync(base + 'caseTop.stl'),
  ]);
  const src = gltf.scene;
  mm(src);
  src.rotation.x = Math.PI / 2;           // glTF (x, y=up/normal, z=KiCad y) -> world (x, -KiCad y, normal)
  src.updateMatrixWorld(true);

  // Split: the earwire (H1) hangs from the "ear"; everything else is the earring body.
  const board = new THREE.Group();
  board.name = 'board';
  const hookParts = new THREE.Group();
  hookParts.name = 'hook';
  const leds = [];
  const parts = {};
  const kids = [...src.children[0].children];
  for (const node of kids) {
    const world = node.matrixWorld.clone();
    node.removeFromParent();
    node.matrix.copy(world);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    (node.name === 'H1' ? hookParts : board).add(node);
    if (node.name) parts[node.name] = node;
  }

  board.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const n = o.material.name;
    const top = o.parent && o.parent.name;
    if (/^mat_(21|22)$/.test(n)) o.material = M.mask;
    else if (/^mat_(17|18)$/.test(n)) o.material = M.enig;
    else if (/^mat_(19|20)$/.test(n)) o.material = M.silk;
    else if (n === 'mat_23') o.material = M.fr4;
  });
  const stopper = [];                      // the silicone stopper on the earwire tip (fades out before the case)
  hookParts.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const chain = [];
    for (let p = o; p; p = p.parent) chain.push(p.name || '');
    const isTube = chain.some(s => s.startsWith('FIXIERSCHLAUCH'));
    o.material = isTube ? M.tube : M.gold;
    if (isTube) stopper.push(o);
    o.userData.part = isTube ? 'stopper' : chain.find(s => /^(HAKEN|KUGEL|FEDER)/.test(s)) || 'wire';
  });
  if (parts.BT1) parts.BT1.traverse(o => { if (o.isMesh) o.material = M.nickel; });
  if (parts.MK1) parts.MK1.traverse(o => {
    if (o.isMesh && o.material.color && o.material.color.r > 0.3 && o.material.color.g > 0.3) o.material = M.steel;
  });

  // Per-LED materials so each 0402 can glow on its own. Chip (red) + lens (translucent) glow.
  for (let i = 1; i <= 90; i++) {
    const node = parts['D' + i];
    const led = {ref: 'D' + i, node, glow: [], pos: new THREE.Vector3()};
    node.traverse(o => {
      if (!o.isMesh) return;
      const n = o.material.name;
      if (n === 'mat_2' || n === 'mat_4') {
        const m = new THREE.MeshPhysicalMaterial({
          color: n === 'mat_2' ? 0x8a1208 : 0xb9b1a6, roughness: 0.4, transparent: n === 'mat_4',
          opacity: n === 'mat_4' ? 0.8 : 1, emissive: 0xff2a10, emissiveIntensity: 0,
        });
        o.material = m;
        led.glow.push(m);
      }
    });
    const bb = new THREE.Box3().setFromObject(node);
    bb.getCenter(led.pos);
    led.pos.z = bb.max.z;
    leds.push(led);
  }

  // CR2032 in the holder on the back: 20.0 x 3.2 mm, negative cap toward the board.
  const cell = makeCR2032();
  const bt = parts.BT1 ? new THREE.Box3().setFromObject(parts.BT1) : null;
  // board FR4 spans z 0..0.91; the holder reaches back to z -4.49. The cell's - cap touches the
  // board pad, the + can is held by the stamped holder.
  cell.position.set(0, bt ? (bt.min.y + bt.max.y) / 2 : -0.06, -1.75);
  cell.rotation.x = -Math.PI / 2;  // lathe +Y (+ face) -> world -Z, away from the board
  board.add(cell);
  parts.CELL = cell;

  const caseGroup = makeCase(caseBot, caseTop);
  return {board, hook: hookParts, leds, parts, stopper, case: caseGroup, cellFactory: makeCR2032};
}

// Copper under the soldermask. Black mask over copper reads as slightly lifted, glossier lines with soft
// edges; vias are tented (mask over the annular ring, a shallow dimple at the drill). Baked from the real KiCad segments
// and vias into color / roughness+metalness / bump maps on planar UVs over the board.
export function bakeCopper(rig, boardData, size = 2048) {
  // 2048 px over 28 mm = 73 px/mm (a 0.127 mm trace is ~9 px). Memory-light on purpose: each canvas is
  // 16 MB, every layer is drawn as a few batched paths, and no canvas filters are used (a filter on a
  // large canvas makes the browser allocate a full-size layer per draw call).
  const X0 = -14, SPAN = 28;                               // board-local mm covered by the texture
  const px = v => (v - X0) / SPAN * size;                  // KiCad x or y -> canvas px (canvas y down = KiCad y down)
  const layerMaps = side => {
    const layer = side === 'top' ? 'F.Cu' : 'B.Cu';
    const segs = boardData.segments.filter(s => s.l === layer);
    const byWidth = new Map();
    for (const s of segs) { const k = s.w.toFixed(3); (byWidth.get(k) || byWidth.set(k, []).get(k)).push(s); }
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d')]; };
    const [cc, color] = mk(), [rc, rough] = mk(), [bc, bump] = mk();
    color.fillStyle = '#0b0b0d'; color.fillRect(0, 0, size, size);
    rough.fillStyle = 'rgb(0,110,0)'; rough.fillRect(0, 0, size, size);      // G = roughness, B = metalness
    bump.fillStyle = '#000'; bump.fillRect(0, 0, size, size);
    const stroke = (g, style, widen = 1) => {
      g.strokeStyle = style; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [w, list] of byWidth) {
        g.lineWidth = parseFloat(w) * widen / SPAN * size;
        g.beginPath();
        for (const s of list) { g.moveTo(px(s.a[0]), px(s.a[1])); g.lineTo(px(s.b[0]), px(s.b[1])); }
        g.stroke();
      }
    };
    stroke(color, '#18171c');
    stroke(rough, 'rgb(0,62,0)');
    stroke(bump, 'rgba(255,255,255,0.35)', 1.6);          // soft shoulder, then the crown: a filter-free bevel
    stroke(bump, '#fff', 1.0);
    const dots = (g, style, radius) => {
      g.fillStyle = style; g.beginPath();
      for (const v of boardData.vias) { const x = px(v.p[0]), y = px(v.p[1]); g.moveTo(x + radius(v), y); g.arc(x, y, radius(v), 0, Math.PI * 2); }
      g.fill();
    };
    const ring = v => v.s / 2 / SPAN * size, hole = () => 0.1 / SPAN * size;
    dots(color, '#1a191e', ring); dots(color, '#0e0e11', hole);
    dots(rough, 'rgb(0,58,0)', ring);
    dots(bump, 'rgba(255,255,255,0.35)', v => ring(v) * 1.25); dots(bump, '#fff', ring); dots(bump, '#6a6a6a', hole);
    const tex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const rm = tex(rc);                                     // one texture: G roughness, B metalness
    return new THREE.MeshPhysicalMaterial({
      map: tex(cc, true), roughnessMap: rm, metalnessMap: rm, bumpMap: tex(bc), bumpScale: 1.2,
      roughness: 1, metalness: 1, clearcoat: 0.45, clearcoatRoughness: 0.34,
    });
  };
  const mats = {top: layerMaps('top'), bottom: layerMaps('bottom')};
  rig.board.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  rig.board.traverse(o => {
    if (!o.isMesh || o.material !== M.mask) return;
    const bb = new THREE.Box3().setFromObject(o);
    const side = (bb.min.z + bb.max.z) / 2 > 0.45 ? 'top' : 'bottom';
    const g = o.geometry.clone();
    const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);          // board-local mm, y up
      uv[i * 2] = (v.x - X0) / SPAN;
      uv[i * 2 + 1] = 1 - (-v.y - X0) / SPAN;                              // canvas is KiCad y-down
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.geometry = g;
    o.material = mats[side];
  });
  return mats;
}

export function makeCR2032() {
  // lathe profile (radius, height) of a CR2032: + can wraps the side, - cap is a smaller raised disc
  const R = 10.0, Hh = 3.2, cap = 8.2, step = 0.25, gasket = 8.6;
  const pts = [
    [0, 0], [cap, 0], [cap + 0.15, 0.05], [cap + 0.2, step], [gasket, step], [gasket + 0.1, step + 0.1],
    [R - 0.35, step + 0.12], [R - 0.05, step + 0.35], [R, step + 0.6], [R, Hh - 0.3], [R - 0.08, Hh - 0.08],
    [R - 0.3, Hh], [0, Hh],
  ].map(([r, y]) => new THREE.Vector2(r, y - Hh / 2));
  const geo = new THREE.LatheGeometry(pts, 128);
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, M.steel);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // engraving on the + face as a decal
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  x.font = '62px Optima'; x.fillText('CR2032', 256, 250);
  x.font = '34px Optima'; x.fillText('3V  LITHIUM', 256, 310);
  x.font = 'bold 80px Optima'; x.fillText('+', 256, 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const decal = new THREE.Mesh(new THREE.CircleGeometry(R - 0.4, 96), new THREE.MeshPhysicalMaterial({
    color: 0xc9ccd2, metalness: 1, roughness: 0.2, bumpMap: tex, bumpScale: -0.6, roughnessMap: tex,
  }));
  decal.rotation.x = -Math.PI / 2;      // face +Y (the + side, top of the lathe)
  decal.position.y = Hh / 2 + 0.005;
  g.add(decal);
  return g;
}

function makeCase(botGeo, topGeo) {
  const g = new THREE.Group();
  g.name = 'case';
  botGeo = mergeVertices(botGeo, 1e-4); botGeo.computeVertexNormals();
  topGeo = mergeVertices(topGeo, 1e-4); topGeo.computeVertexNormals();
  const bot = new THREE.Mesh(botGeo, M.carrara);
  bot.castShadow = bot.receiveShadow = true;
  const top = new THREE.Mesh(topGeo, M.carraraLid);
  top.castShadow = top.receiveShadow = true;
  const hinge = new THREE.Group();   // lid pivots at the back edge
  hinge.add(top);
  g.add(bot, hinge);
  g.userData = {bot, top, hinge};
  return g;
}
