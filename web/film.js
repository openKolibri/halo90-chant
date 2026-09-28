// NONAGINTA — the film. One continuous camera, the real KiCad/STEP models, timed by build/timeline.json.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadRig, makeCR2032, MATERIALS, bakeCopper} from './rig.js';
import {isStopper} from './earwire.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {Timeline, clamp, smooth} from './timeline.js';
import {simulatePendulum, earForcing} from './pendulum.js';
import {makeLeds} from './leds.js';
import {makeFx} from './fx.js';
import {makeShots} from './shots.js';
import {makeOverlay, FONT} from './overlay.js';

const params = new URLSearchParams(location.search);
const W = parseInt(params.get('w') || '1920'), H = parseInt(params.get('h') || '1080');
window.FILM_SIZE = [W, H];

const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const out = document.createElement('canvas');
out.width = W; out.height = H;
const g2 = out.getContext('2d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030204);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.5, 20000);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.DirectionalLight(0xffe7cc, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.camera.near = 1; key.shadow.camera.far = 600;
const rim = new THREE.DirectionalLight(0x9fb4ff, 2.2);
const fill = new THREE.HemisphereLight(0x3a3a48, 0x0a0a0c, 0.5);
scene.add(key, key.target, rim, fill);
const ledLights = Array.from({length: 8}, () => {
  const l = new THREE.PointLight(0xff3414, 0, 60, 2);
  scene.add(l);
  return l;
});

const composer = new EffectComposer(renderer);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, {focus: 60, aperture: 0.0002, maxblur: 0.012});
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.42, 1.45);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: {tDiffuse: {value: null}, seed: {value: 0}, vig: {value: 0.9}},
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float seed; uniform float vig; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + seed) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5; q.x *= 1.7778;
      c.rgb *= mix(1.0, smoothstep(1.05, 0.25, length(q)), vig);
      c.rgb += (h(vUv * 1000.0) - 0.5) * 0.012;
      gl_FragColor = vec4(max(c.rgb, vec3(0.0)), c.a);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

window.gpuInfo = () => {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
};

function chainOutline(polys) {
  const rest = polys.map(p => p.slice()), outl = rest.shift();
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  while (rest.length) {
    const end = outl[outl.length - 1];
    let best = 0, rev = false, bd = 1e9;
    rest.forEach((p, i) => {
      if (d(p[0], end) < bd) { bd = d(p[0], end); best = i; rev = false; }
      if (d(p[p.length - 1], end) < bd) { bd = d(p[p.length - 1], end); best = i; rev = true; }
    });
    let p = rest.splice(best, 1)[0];
    if (rev) p = p.reverse();
    outl.push(...p.slice(1));
  }
  return outl;
}

function centerOf(obj) {
  const b = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3();
  b.getCenter(c);
  c.z = b.max.z;
  return c;
}

const rotAbout = (pt, rz, rx) => new THREE.Matrix4().makeTranslation(pt.x, pt.y, pt.z)
  .multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(new THREE.Matrix4().makeRotationX(rx))
  .multiply(new THREE.Matrix4().makeTranslation(-pt.x, -pt.y, -pt.z));

async function init() {
  const [tlJson, boardData] = await Promise.all([
    fetch(params.get('timeline') || '/build/timeline.json').then(r => r.json()),
    fetch('/build/board.json').then(r => r.json()),
  ]);
  boardData.outlineChain = chainOutline(boardData.outline);
  // index LEDs by physical slot (4 degrees apart, slot 0 at the bottom): +JUMP means JUMP positions round the ring
  const slotOfLed = l => Math.round((((94 - l.ang) % 360) + 360) % 360 / 4) % 90;
  boardData.leds.sort((a, b) => slotOfLed(a) - slotOfLed(b));
  const tl = new Timeline(tlJson);
  window.FILM_FPS = tl.fps;
  window.FILM_DURATION = tl.duration;
  await Promise.all([document.fonts.load(`58px ${FONT.latin}`), document.fonts.load(`22px ${FONT.mono}`),
    document.fonts.load(`italic 26px ${FONT.ital}`)]);

  const rig = await loadRig();
  rig.materials = MATERIALS;
  const leds = makeLeds(tl, boardData);
  leds.board = boardData;
  const ledByFw = boardData.leds.map(l => rig.leds.find(x => x.ref === l.ref));

  // traces and vias under the soldermask, in gentle relief: at full strength the trace and via edges catch
  // the key light and an unlit board glitters as if its LEDs were on
  for (const m of Object.values(bakeCopper(rig, boardData))) m.bumpScale = 0.53;

  // ---- the case, by eye: base on the "table" 70 mm below; base-local y = 10 is its rim ------------------
  const CASE = {y: -70, pocketX: 15.62, floor: 1.0, cellH: 3.2, back: 4.49, E: new THREE.Vector3(0, 13, 0.45),
    magnets: [[-26.57, -11.63], [26.58, 11.59]]};
  const restY = CASE.floor + CASE.cellH + CASE.back;          // earring origin resting on its cell (base-local)
  const E = CASE.E;
  // the earwire in the case (original STEP geometry, never bent): swivelled 90 degrees in the hole about the
  // board normal, so the loop stays threaded and loop and coil lie level along the wall with the hook's plane
  // parallel to it. By eye: the unbent tail runs down through the slot floor and out under the base.
  const about = (m, p = E) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const LOOP_C = new THREE.Vector3(0, 14.49, 0.39);          // centre of the loop, board-local
  const lieRel = about(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  const qTop = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));                // eyelet -> top slot
  const qBottom = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'));  // eyelet -> bottom slot
  const caseM = (x, y, z, q) => new THREE.Matrix4().compose(new THREE.Vector3(x, CASE.y + y, z), q, new THREE.Vector3(1, 1, 1));
  const heroRest = caseM(CASE.pocketX, restY, 0, qTop);

  // earring B, already in the left pocket on its spare cell: unlit, earwire bent and laid in the slot
  const twin = rig.board.clone(true);
  twin.traverse(o => { if (o.isMesh && o.material.emissive && o.material.emissive.r > 0.5) { o.material = o.material.clone(); o.material.emissiveIntensity = 0; } });
  const twinHook = rig.hook.clone(true);
  twinHook.traverse(o => { if (o.isMesh && isStopper(o)) o.visible = false; });
  twin.matrixAutoUpdate = twinHook.matrixAutoUpdate = false;
  twin.matrix.copy(caseM(-CASE.pocketX, restY, 0, qBottom));
  twinHook.matrix.copy(twin.matrix).multiply(lieRel);
  scene.add(rig.board, rig.hook, twin, twinHook);

  // the hero's earwire: its silicone stopper fades as it is carried to the case
  const stopperMats = rig.stopper.map(o => (o.material = o.material.clone(), o.material.transparent = true, o.material));
  // by eye: in the case the unbent earwire's tail runs down through the slot and out under the base, so
  // the earwire (gold is used only by its wire, bead and coil) is cut off at the base's underside
  renderer.localClippingEnabled = true;
  MATERIALS.gold.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -CASE.y)];   // keeps y >= CASE.y
  MATERIALS.gold.clipShadows = true;

  // ear pivot = top of the earwire's curve (hanging shape)
  const P = new THREE.Vector3(0, -1e9, 0);
  rig.hook.updateMatrixWorld(true);
  rig.hook.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y > P.y) P.copy(v); }
  });

  // the case: lid normalised so identity = closed on the base; Ø5 x 3 mm magnets (glued; lid pair at the
  // bottom of its 5.5 mm holes)
  const caseG = rig.case;
  const {top, hinge} = caseG.userData;
  top.geometry.computeBoundingBox();
  {
    const b = top.geometry.boundingBox;
    top.geometry.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    top.geometry.rotateY(Math.PI / 2);
    top.geometry.computeBoundingBox();
  }
  const magGeo = new THREE.CylinderGeometry(2.5, 2.5, 3, 48);
  for (const [x, z] of CASE.magnets) {
    const mb = new THREE.Mesh(magGeo, MATERIALS.magnet); mb.position.set(x, 8.5, z); caseG.add(mb);
    const ml = new THREE.Mesh(magGeo, MATERIALS.magnet); ml.position.set(x, 4.0, z); top.add(ml);
  }
  caseG.position.set(0, CASE.y, 0);
  scene.add(caseG);
  const cellA = makeCR2032(), cellB = makeCR2032();          // spare cells, negative cap up
  cellA.position.set(-CASE.pocketX, CASE.y + CASE.floor + CASE.cellH / 2, 0);
  cellA.rotation.x = Math.PI;
  scene.add(cellA, cellB);

  // light leaking from the seam when it wakes inside the closed case
  const seam = (() => {
    const pos = caseG.userData.bot.geometry.attributes.position, pts = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 9.95) pts.push([pos.getX(i), pos.getZ(i)]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
    const P2 = [], C = [], ang = [];
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
      for (let k = 0; k < n; k++) {
        const u0 = k / n, u1 = (k + 1) / n;
        const x0 = a[0] + (b[0] - a[0]) * u0, z0 = a[1] + (b[1] - a[1]) * u0, x1 = a[0] + (b[0] - a[0]) * u1, z1 = a[1] + (b[1] - a[1]) * u1;
        P2.push(x0, 10.05, z0, x1, 10.05, z1); C.push(0, 0, 0, 0, 0, 0);
        ang.push(((Math.atan2(-(z0 + z1) / 2, (x0 + x1) / 2) + Math.PI / 2) / (2 * Math.PI) + 1) % 1);
      }
    }
    const g = new LineSegmentsGeometry(); g.setPositions(P2); g.setColors(C);
    const mat = new LineMaterial({linewidth: 3 * W / 1920, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
    mat.resolution.set(W, H);
    const o = new LineSegments2(g, mat);
    o.frustumCulled = false; o.visible = false;
    caseG.add(o);
    return {o, ang};
  })();

  const fx = makeFx(scene, rig, boardData, tl, leds, W, H);
  const shots = makeShots(tl, leds, {rest: new THREE.Vector3(CASE.pocketX, CASE.y + restY, 0), pocketX: CASE.pocketX,
    cellRestY: CASE.floor + CASE.cellH / 2, land: {cell: 0.12, place: 0.10}});
  {
    const rt = new THREE.WebGLRenderTarget(1024, 1024, {samples: 4});
    const ortho = new THREE.OrthographicCamera(-14, 14, 14, -14, 1, 200);
    ortho.position.set(0, 0, 60); ortho.lookAt(0, 0, 0);
    // capture on a private layer: only the hero board and the lights take part
    const CAP = 7;
    ortho.layers.set(CAP);
    rig.board.traverse(o => o.layers.enable(CAP));
    scene.traverse(o => { if (o.isLight) o.layers.enable(CAP); });
    const bg = scene.background; scene.background = null;
    key.intensity = 2.0; key.position.set(30, 50, 80); rim.intensity = 0.6; fill.intensity = 0.5; scene.environmentIntensity = 0.45;
    rig.board.updateMatrixWorld(true);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, ortho); renderer.setRenderTarget(null);
    scene.background = bg;
    rig.board.traverse(o => o.layers.disable(CAP));
    fx.setImpostor(rt.texture);
    window.debugImpostor = () => {
      const px = new Uint8Array(1024 * 1024 * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, 1024, 1024, px);
      const c = document.createElement('canvas'); c.width = c.height = 1024;
      const g = c.getContext('2d'), img = g.createImageData(1024, 1024);
      for (let y = 0; y < 1024; y++) img.data.set(px.subarray((1023 - y) * 4096, (1024 - y) * 4096), y * 4096);
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    };
  }
  const pend = simulatePendulum(tl, {l1: P.y - E.y, l2: 13.5, forcing: earForcing(tl, t => shots.swing(t))});
  const overlay = makeOverlay(tl, leds);

  // board materials fade for the exploded view (effects excluded)
  const fxObjs = new Set([fx.chords, fx.dial, fx.traces, fx.heart, fx.dim, fx.gauge, fx.motes, ...fx.layers.flatMap(g => g.children)]);
  const boardMats = new Set();
  rig.board.traverse(o => { if (o.isMesh && !fxObjs.has(o)) boardMats.add(o.material); });
  for (const m of boardMats) { m.userData.baseOpacity = m.opacity; m.userData.wasTransparent = m.transparent; }

  rig.board.matrixAutoUpdate = rig.hook.matrixAutoUpdate = false;
  const mid = {mk1: centerOf(rig.parts.MK1), u1: centerOf(rig.parts.U1).add(new THREE.Vector3(0, -2.6, 0)), s1: centerOf(rig.parts.S1)};
  const layerZ = [0, 0, 0, 0];

  function pose(t) {
    const p = pend.at(t);
    const hangHook = rotAbout(P, p.side1, p.fb1);
    const hangBoard = hangHook.clone().multiply(rotAbout(E, p.side2 - p.side1, p.fb2 - p.fb1));
    const c = shots.carry(t);
    const sf = shots.stopper(t);
    stopperMats.forEach(m => { m.opacity = sf; });
    rig.stopper.forEach(o => { o.visible = sf > 0.01; });
    if (c <= 0) {
      rig.board.matrix.copy(hangBoard);
      rig.hook.matrix.copy(hangHook);
    } else {
      const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sc = new THREE.Vector3();
      const pb = new THREE.Vector3(), qb = new THREE.Quaternion();
      hangBoard.decompose(pa, qa, sc);
      heroRest.decompose(pb, qb, new THREE.Vector3());
      pb.y += 1.5;                                                  // it is let go 1.5 mm above its cell
      const pos = pa.clone().lerp(pb, c);
      pos.y += Math.sin(c * Math.PI) * 10;
      pos.z += Math.sin(c * Math.PI) * 12;
      const d = shots.drop(t);
      if (c >= 1) pos.y = pb.y - 1.5 * (1 - d.fall) + d.settle * 0.3;
      const q = qa.clone().slerp(qb, smooth(clamp((c - 0.15) / 0.7)));
      if (c >= 1 && d.settle) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), d.settle * 0.02));
      rig.board.matrix.compose(pos, q, sc);
      // hanging -> in the case: interpolate the rotation, and carry the loop's centre on a straight line so
      // the loop stays at the hole
      const hangRel = hangBoard.clone().invert().multiply(hangHook);
      const rq = new THREE.Quaternion(), cq = new THREE.Quaternion();
      hangRel.decompose(new THREE.Vector3(), rq, new THREE.Vector3());
      lieRel.decompose(new THREE.Vector3(), cq, new THREE.Vector3());
      const k = smooth(clamp((c - 0.3) / 0.6));
      const R = new THREE.Matrix4().makeRotationFromQuaternion(rq.slerp(cq, k));
      const at = LOOP_C.clone().applyMatrix4(hangRel).lerp(LOOP_C.clone().applyMatrix4(lieRel), k).sub(LOOP_C.clone().applyMatrix4(R));
      rig.hook.matrix.copy(rig.board.matrix).multiply(R.setPosition(at));
    }
    rig.board.matrixWorldNeedsUpdate = rig.hook.matrixWorldNeedsUpdate = true;
  }

  function update(t, frame) {
    pose(t);
    const v = shots.cam(t);
    camera.position.set(v[0], v[1], v[2]);
    camera.fov = v[6];
    camera.updateProjectionMatrix();
    camera.up.set(v[7], v[8], v[9]).normalize();
    camera.lookAt(v[3], v[4], v[5]);

    const st = shots.studio(t);
    key.intensity = 2.6 * st; rim.intensity = 2.2 * st; fill.intensity = 0.5 * st;
    const kd = shots.keyDir(t);
    key.position.set(v[3] + kd[0], v[4] + kd[1], v[5] + kd[2]);
    key.target.position.set(v[3], v[4], v[5]);
    const sc = key.shadow.camera, span = clamp(Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]) * 0.45, 30, 200);
    sc.left = sc.bottom = -span; sc.right = sc.top = span; sc.updateProjectionMatrix();
    rim.position.set(v[3] - 80, v[4] + 30, v[5] - 60);
    scene.environmentIntensity = shots.envLight(t);

    const L = leds.levels(t);
    if (t >= tl.sec.finis.t0) { const wk = leds.wake(t); for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], wk[i]); }
    // one LED at a time: the more of the ring the scan covers, the dimmer each one looks (duty cycle)
    const total = L.reduce((a, b) => a + b, 0);
    const duty = 1 / Math.sqrt(Math.max(1, total / 6));
    const exGlow = 1 - 0.9 * shots.explode(t);
    for (let fw = 0; fw < 90; fw++) for (const m of ledByFw[fw].glow) m.emissiveIntensity = L[fw] * 5 * duty * exGlow;
    // the ring's light on the board: one point light per 45-degree sector, at the sector's brightness-weighted
    // centre with its total, so a near-even ring doesn't make the lights hop between LEDs frame to frame.
    // (With the whole ring lit, each light leaves a small glint on the ENIG pads beneath it: eight faint
    // spokes, kept; the real board shows much the same.)
    const lightScale = 45 / Math.sqrt(Math.max(1, total / 8)) * Math.min(1, duty * 2.2) * exGlow;
    ledLights.forEach((pl, k) => {
      let sum = 0;
      const c = new THREE.Vector3();
      for (let i = Math.ceil(k * 90 / 8); i < Math.ceil((k + 1) * 90 / 8); i++) {
        if (L[i] <= 0.02) continue;
        sum += L[i]; c.addScaledVector(ledByFw[i].pos, L[i]);
      }
      if (sum > 0) c.divideScalar(sum); else c.copy(ledByFw[Math.ceil(k * 90 / 8)].pos);
      pl.position.copy(c).setZ(c.z + 1.5).applyMatrix4(rig.board.matrix);
      pl.intensity = sum * lightScale;
    });

    fx.updateChords(t, leds.scan, shots.chords(t));
    fx.dial.material.opacity = shots.dial(t);
    fx.dial.visible = fx.dial.material.opacity > 0.002;
    const netGlow = {};
    if (t >= tl.sec.dynamic.t0 && t < tl.sec.dynamic.t1) {
      // audio mode: the lines the firmware is driving for the LEDs lit in this frame
      let mx = 1e-6;
      for (let i = 0; i < 90; i++) mx = Math.max(mx, L[i]);
      for (let i = 0; i < 90; i++) {
        const v = L[i] / mx;
        if (v < 0.35) continue;
        const d = leds.drive(i), hi = `CPX-${d.hi}`, lo = `CPX-${d.lo}`;
        netGlow[hi] = Math.max(netGlow[hi] || 0, v); netGlow[lo] = Math.max(netGlow[lo] || 0, v * 0.8);
      }
    } else {
      const os = tl.events.ostinato;
      let lo = 0, hi = os.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (os[m].t <= t) lo = m + 1; else hi = m; }
      for (let i = lo - 1; i >= 0 && i > lo - 6; i--) {
        const e = os[i], vv = Math.exp(-(t - e.t) / 0.14), l = boardData.leds[e.led];
        netGlow[l.A] = Math.max(netGlow[l.A] || 0, vv); netGlow[l.K] = Math.max(netGlow[l.K] || 0, vv * 0.8);
      }
    }
    fx.updateTraces(netGlow, shots.nets(t));
    fx.updateHeart(shots.heart(t));
    const ex = shots.explode(t);
    fx.updateLayers(ex, layerZ);
    const op = 1 - 0.94 * ex;
    for (const m of boardMats) {
      m.transparent = op < 0.999 || m.userData.wasTransparent;
      m.opacity = m.userData.baseOpacity * op;
      m.depthWrite = op > 0.5;
    }
    rig.hook.visible = ex < 0.8;
    fx.dim.material.opacity = shots.dimLine(t);
    fx.dim.visible = fx.dim.material.opacity > 0.002;
    const hours = tl.linesIn('sparkle')[2];
    fx.updateGauge(hours ? clamp((t - hours.t0 - 0.3) / 3) : 0, shots.gauge(t));
    fx.updateMotes(t, tl.events.sparkle, shots.motes(t));
    fx.stars.material.opacity = shots.stars(t);
    fx.stars.visible = fx.stars.material.opacity > 0.002;
    fx.updateField(t, shots.fieldOn(t), shots.ringTime, shots.forks(t), shots.blaze(t), leds.fork, leds.FORKS);

    const cv = shots.caseVis(t);
    caseG.visible = twin.visible = twinHook.visible = cellA.visible = cv;
    const cb = shots.cell(t);
    cellB.visible = cv && !!cb;
    if (cb) {
      cellB.position.set(cb.p[0], CASE.y + cb.p[1], cb.p[2]);
      cellB.rotation.set(Math.PI, 0, cb.tilt);
    }
    const lp = shots.lidPose(t);
    hinge.position.set(lp.p[0], lp.p[1], lp.p[2]);
    hinge.rotation.set(lp.rx, 0, lp.rz);
    hinge.visible = cv && t > tl.M('halt', 1e9) - 0.6;
    // the wake: the boot sweep inside the closed case shows as light round the seam
    const wake = tl.M('wake', 1e9);
    seam.o.visible = t > wake;
    if (seam.o.visible) {
      const head = (t - wake - 0.1) / 1.0, Cc = seam.o.geometry.attributes.instanceColorStart.data.array;
      seam.ang.forEach((a, i) => {
        let v = 0;
        if (head >= 0) {
          const behind = head - a;
          v = behind < 0 ? 0 : head < 1 ? Math.exp(-behind / 0.25) : Math.exp(-(t - wake - 1.1) / 0.6) * 0.7;
          if (head < 1 && behind < 0.02 && behind >= 0) v = 1.3;
        }
        Cc.set([1.6 * v, 0.25 * v, 0.1 * v, 1.6 * v, 0.25 * v, 0.1 * v], i * 6);
      });
      seam.o.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    }

    bokeh.uniforms.focus.value = Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]);
    bokeh.uniforms.aperture.value = shots.aperture(t);
    bloom.strength = 0.8 * shots.bloom(t);           // 20% under the envelope (v3 review)
    grade.uniforms.seed.value = (frame % 97) * 1.37;
  }

  const tmpV = new THREE.Vector3(), camDir = new THREE.Vector3();
  function project(local, m = rig.board.matrix) {
    if (!local) throw new Error("project(undefined) " + new Error().stack.split("\n")[2]);
    tmpV.copy(local).applyMatrix4(m);
    camera.getWorldDirection(camDir);
    const d = tmpV.clone().sub(camera.position).dot(camDir);
    tmpV.project(camera);
    return {x: (tmpV.x + 1) / 2 * 1920, y: (1 - tmpV.y) / 2 * 1080, behind: d < 0 || Math.abs(tmpV.x) > 1.4 || Math.abs(tmpV.y) > 1.4};
  }

  window.renderFrame = (t, fmt = 'jpeg', after) => {
    const frame = Math.round(t * tl.fps);
    update(t, frame);
    if (after) after(window.__dbg);
    composer.render();
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.drawImage(renderer.domElement, 0, 0);
    g2.setTransform(W / 1920, 0, 0, H / 1080, 0, 0);   // typography is laid out at 1920x1080
    const single = leds.currentSingle(t);
    const ident = new THREE.Matrix4();
    const anchors = {
      mk1: project(mid.mk1), u1: project(mid.u1), s1: project(mid.s1), formula: project(new THREE.Vector3(-9.2, -6.2, 1.2)),
      fourDeg: project(new THREE.Vector3(Math.cos(88 * Math.PI / 180) * 15.9, Math.sin(88 * Math.PI / 180) * 15.9, 0.95)),
      dim: project(fx.dimAnchor), gauge: project(new THREE.Vector3(12.8, 0, -4.7)),
      single: project(fx.fwPos[single]), singleRef: boardData.leds[single].ref, center: project(new THREE.Vector3(0, 0, 1)),
      layers: layerZ.map(z => project(new THREE.Vector3(13.5, 0, z))), explode: shots.explode(t),
      forks: shots.forks(t) ? fx.cells.filter(c => c.ring <= 2).map((c, i) => Object.assign(project(new THREE.Vector3(c.x, c.y - 15.5, 0), ident), {kind: leds.FORKS[(i + 1) % leds.FORKS.length]})) : [],
    };
    overlay(g2, t, anchors, {band: 0.5 + 0.35 * shots.fieldOn(t), black: shots.black(t)});
    return out.toDataURL(`image/${fmt}`, 0.95).split(',')[1];
  };
  window.cameraAt = t => shots.cam(t);
  // is the brightest LED visible from the camera, or hidden behind a part? (QA for the opening shots)
  const ray = new THREE.Raycaster();
  window.los = t => {
    update(t, 0);
    rig.board.updateMatrixWorld(true);
    const L = leds.levels(t);
    let best = 0;
    for (let i = 1; i < 90; i++) if (L[i] > L[best]) best = i;
    const led = ledByFw[best];
    const p = led.pos.clone().applyMatrix4(rig.board.matrixWorld);
    const dir = p.clone().sub(camera.position), dist = dir.length();
    ray.set(camera.position, dir.normalize());
    ray.far = dist - 0.25;
    ray.camera = camera;
    const skip = new Set([fx.chords, fx.dial, fx.traces, fx.heart, fx.dim, fx.gauge, fx.motes]);
    const hits = ray.intersectObject(rig.board, true).filter(h => {
      if (skip.has(h.object) || !h.object.isMesh || h.object.isLineSegments2) return false;
      for (let o = h.object; o; o = o.parent) if (o === led.node) return false;
      return true;
    });
    const part = hits.length ? (() => { for (let o = hits[0].object; o; o = o.parent) if (/^[A-Z]+\d+$/.test(o.name)) return o.name; return 'board'; })() : null;
    return {t, led: led.ref, level: +L[best].toFixed(2), blocked: !!hits.length, by: part};
  };
  // QA: the film at time t from a fixed camera, no depth of field or typography, optionally without the case walls.
  //   window.debugCase(161, {pos: [0, 60, 0.01], at: [0, -61, 0], up: [0, 0, -1], fov: 20, walls: false})
  window.debugCase = (t, {pos, at, up = [0, 1, 0], fov = 20, walls = true, lid = true}) => {
    update(t, 0);
    camera.position.set(...pos); camera.up.set(...up); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(...at);
    const vis = [caseG.userData.bot.visible, hinge.visible, bokeh.enabled];
    caseG.userData.bot.visible = walls; hinge.visible = hinge.visible && lid; bokeh.enabled = false;
    composer.render();
    g2.setTransform(1, 0, 0, 1, 0, 0); g2.drawImage(renderer.domElement, 0, 0);
    [caseG.userData.bot.visible, hinge.visible, bokeh.enabled] = vis;
    return out.toDataURL('image/jpeg', 0.95).split(',')[1];
  };
  window.__dbg = {key, rim, fill, bloom, bokeh, ledLights, scene, rig, update, camera};
  window.filmReady = true;
}

init().catch(e => { window.filmError = String(e.stack || e); });
