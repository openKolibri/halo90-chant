// Case loading preview: the open base with both stacks, for choosing how the upper earring faces.
// window.caseView({face: 'up'|'down', view: 'top'|'three'}) -> jpeg base64
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadRig, makeCR2032, MATERIALS} from './rig.js';

const W = 1600, H = 1000;
const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14261c);                 // like the green cloth in the photo
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(40, 120, 60); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400});
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, W / H, 1, 2000);

const E = new THREE.Vector3(0, 13, 0.45);                     // eyelet, board-local
const POCKET = 15.62, FLOOR = 1.0, CELL = 3.2, BACK = 4.49, FRONT = 2.0;

function earring(rig, hook, pos, q, twistY) {
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  const b = rig.board.clone(true), h = hook.clone(true);
  b.matrixAutoUpdate = h.matrixAutoUpdate = false;
  b.matrix.copy(m);
  const tw = new THREE.Matrix4().makeTranslation(E.x, E.y, E.z).multiply(new THREE.Matrix4().makeRotationY(twistY))
    .multiply(new THREE.Matrix4().makeTranslation(-E.x, -E.y, -E.z));
  h.matrix.copy(m).multiply(tw);
  return [b, h];
}

let objs = [], rig;
window.caseView = ({face = 'up', view = 'top'} = {}) => {
  objs.forEach(o => scene.remove(o)); objs = [];
  const qx = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  const qy = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
  // right pocket: spare cell on the floor, the hero face up on it, earwire along the top slot
  const cellR = makeCR2032(); cellR.position.set(POCKET, FLOOR + CELL / 2, 0);
  const heroQ = qx(-Math.PI / 2);                               // face +Y, eyelet toward -Z (top slot)
  const hero = earring(rig, rig.hook, new THREE.Vector3(POCKET, FLOOR + CELL + BACK, 0), heroQ, Math.PI / 2);
  // left pocket: cell A, earring B on top, earwire along the bottom slot
  const cellL = makeCR2032(); cellL.position.set(-POCKET, FLOOR + CELL / 2, 0);
  const twin = face === 'up'
    ? earring(rig, rig.hook, new THREE.Vector3(-POCKET, FLOOR + CELL + BACK, 0), qy(Math.PI).multiply(qx(-Math.PI / 2)), Math.PI / 2)
    : earring(rig, rig.hook, new THREE.Vector3(-POCKET, FLOOR + CELL + FRONT, 0), qx(Math.PI / 2), -Math.PI / 2);
  objs = [cellR, cellL, ...hero, ...twin];
  objs.forEach(o => { o.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } }); scene.add(o); });
  if (view === 'top') { camera.position.set(0, 175, 0.01); camera.up.set(0, 0, -1); camera.fov = 30; }
  else if (view === 'three') { camera.position.set(-70, 60, 95); camera.up.set(0, 1, 0); camera.fov = 26; }
  else { camera.position.set(-15.6, 12, 60); camera.up.set(0, 1, 0); camera.fov = 22; }   // side view of the left stack
  camera.updateProjectionMatrix();
  camera.lookAt(view === 'side' ? -15.6 : 0, view === 'side' ? 6 : 3, 0);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/jpeg', 0.92).split(',')[1];
};

loadRig().then(r => {
  rig = r;
  const {bot} = rig.case.userData;
  bot.material = new THREE.MeshStandardMaterial({color: 0xe9e1dc, roughness: 0.7});   // white PLA, as photographed
  bot.castShadow = bot.receiveShadow = true;
  scene.add(bot);
  window.filmReady = true;
}).catch(e => { window.filmError = String(e.stack || e); });

