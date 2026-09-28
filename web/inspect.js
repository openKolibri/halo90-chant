// NONAGINTA — three.js film. asset inspection harness (debugView, caseHeightmap).
import * as THREE from 'three';
import {loadRig} from './rig.js';

const W = 1920, H = 1080;
window.FILM_FPS = 30;

const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050407);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);

const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
key.position.set(40, 60, 90);
key.castShadow = true;
const rim = new THREE.DirectionalLight(0x9fb4ff, 1.4);
rim.position.set(-80, 30, -60);
const fill = new THREE.HemisphereLight(0x404050, 0x101014, 0.6);
scene.add(key, rim, fill);

window.gpuInfo = () => {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
};

let rig;
function snap(fmt = 'jpeg') {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL(`image/${fmt}`, 0.92).split(',')[1];
}

const debugAmb = new THREE.AmbientLight(0xffffff, 0);
scene.add(debugAmb);
window.debugView = ({pos = [0, 0, 90], target = [0, 0, 0], fov = 30, show = ['board', 'hook'], up = [0, 1, 0], amb = 0} = {}) => {
  debugAmb.intensity = amb;
  for (const k of ['board', 'hook', 'case']) rig[k].visible = show.includes(k);
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.position.set(...pos); camera.up.set(...up); camera.lookAt(...target);
  return snap();
};
window.renderFrame = (t) => snap();
window.lidUnderside = (step = 1) => {
  const mesh = rig.case.userData.top;
  mesh.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(mesh);
  const rc = new THREE.Raycaster();
  const rows = [];
  for (let z = bb.min.z; z <= bb.max.z; z += step) {
    let row = '';
    for (let x = bb.min.x; x <= bb.max.x; x += step) {
      rc.set(new THREE.Vector3(x, bb.min.y - 50, z), new THREE.Vector3(0, 1, 0));
      const hit = rc.intersectObject(mesh, false)[0];
      // depth of the cavity above the mating face (y = min)
      const d = hit ? hit.point.y - bb.min.y : -1;
      row += d < 0 ? ' ' : d < 0.3 ? '#' : String(Math.min(9, Math.floor(d)));
    }
    rows.push(row);
  }
  return `lid underside: x ${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)} z ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)} thickness ${(bb.max.y - bb.min.y).toFixed(2)} step ${step} ('#' = mating face, digits = cavity depth mm)\n` + rows.join('\n');
};
window.caseHeightmap = (which = 'bot', step = 2) => {
  const mesh = rig.case.userData[which];
  mesh.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(mesh);
  const rc = new THREE.Raycaster();
  const rows = [];
  for (let z = bb.min.z; z <= bb.max.z; z += step) {
    let row = '';
    for (let x = bb.min.x; x <= bb.max.x; x += step) {
      rc.set(new THREE.Vector3(x, bb.max.y + 50, z), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObject(mesh, false)[0];
      const h = hit ? hit.point.y - bb.min.y : -1;
      row += h < 0 ? ' ' : h > bb.max.y - bb.min.y - 0.3 ? '#' : String(Math.min(9, Math.floor(h)));
    }
    rows.push(row);
  }
  return `x ${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)}  z ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)} step ${step}\n` + rows.join('\n');
};

loadRig().then(r => {
  rig = r;
  scene.add(rig.board, rig.hook, rig.case);
  const bb = new THREE.Box3().setFromObject(rig.hook);
  const bbb = new THREE.Box3().setFromObject(rig.board);
  const cb = new THREE.Box3().setFromObject(rig.case.userData.bot);
  const ct = new THREE.Box3().setFromObject(rig.case.userData.top);
  const f = v => v.toArray().map(x => x.toFixed(2)).join(',');
  console.log('hook bbox', f(bb.min), '|', f(bb.max));
  console.log('board bbox', f(bbb.min), '|', f(bbb.max));
  console.log('caseBot', f(cb.min), '|', f(cb.max), ' caseTop', f(ct.min), '|', f(ct.max));
  const bodies = {};
  rig.board.traverse(o => { if (o.isMesh) { const k = o.material === undefined ? '?' : (o.material.name || o.material.type) + ':' + (o.parent.name || o.parent.parent.name); } });
  for (const n of ['BT1', 'U1', 'S1', 'D1', 'CELL']) { const b = new THREE.Box3().setFromObject(rig.parts[n]); console.log(n, f(b.min), '|', f(b.max)); }
  const fr = []; rig.board.traverse(o => { if (o.isMesh && (o.material.color && o.material.color.getHexString() === '2c2a1f')) fr.push(new THREE.Box3().setFromObject(o)); });
  fr.forEach(b => console.log('FR4', f(b.min), '|', f(b.max)));
  const mk = rig.parts.MK1;
  if (mk) console.log('MK1 bbox', f(new THREE.Box3().setFromObject(mk).min), f(new THREE.Box3().setFromObject(mk).max));
  window.filmReady = true;
}).catch(e => { window.filmError = String(e.stack || e); });
