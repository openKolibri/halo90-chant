// Effects that live in the 3D world, parented to the board so they move with it.
import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {clamp, hash, lowerBound} from './timeline.js';

const k2w = (p, z = 0) => [p[0], -p[1], z];   // KiCad (x, y down) -> board-local (x, y up, z)
const smoothstep01 = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

let W = 1920, H = 1080;
function lineMat(opts = {}) {
  const m = new LineMaterial({
    color: 0xffffff, linewidth: (opts.width || 1.5) * W / 1920, vertexColors: true, transparent: true,
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false,
    worldUnits: !!opts.worldUnits, opacity: 1, toneMapped: false,
  });
  m.resolution.set(W, H);
  return m;
}

function segs(positions, colors, mat) {
  const g = new LineSegmentsGeometry();
  g.setPositions(positions);
  g.setColors(colors);
  const o = new LineSegments2(g, mat);
  o.frustumCulled = false;
  o.renderOrder = 10;
  return o;
}

export function makeFx(scene, rig, boardData, tl, leds, width = 1920, height = 1080) {
  W = width; H = height;
  const board = rig.board;
  const fx = {};
  const ledPos = leds.fwOfSlot.map(() => null);
  const byRef = Object.fromEntries(rig.leds.map(l => [l.ref, l]));
  const fwPos = boardData.leds.map(l => byRef[l.ref].pos.clone());   // board-local, indexed by firmware LED

  // ---- string art: each +13 jump is an arc that leaps over the board, lens to lens ---------------
  // 13 slots = 52 degrees, a 9.6 mm chord near the rim; the arc peaks ~4 mm up, well clear of the
  // tallest part (the mic can, 2.0 mm) and of the LEDs it passes over.
  const MAXC = 90, ARC = 16;
  const lensZ = 1.42;
  const chordPos = new Float32Array(MAXC * ARC * 6), chordCol = new Float32Array(MAXC * ARC * 6);
  fx.chords = segs(chordPos, chordCol, lineMat({width: 2.0}));
  board.add(fx.chords);
  fx.arcHeight = d => 1.0 + 0.3 * d;
  const arcPoint = (a, b, s, out) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    out[0] = a.x + (b.x - a.x) * s;
    out[1] = a.y + (b.y - a.y) * s;
    out[2] = lensZ + fx.arcHeight(d) * 4 * s * (1 - s);
    return out;
  };
  fx.arcPoint = arcPoint;
  fx.updateChords = (t, scan, amount) => {
    const P = fx.chords.geometry.attributes.instanceStart.data.array;
    const Cc = fx.chords.geometry.attributes.instanceColorStart.data.array;
    P.fill(0); Cc.fill(0);
    if (amount > 0) {
      const i1 = lowerBound(scan, t + 1e-9);
      let k = 0;
      const tau = 5, p0 = [0, 0, 0], p1 = [0, 0, 0];
      for (let i = Math.max(1, i1 - MAXC); i < i1; i++) {
        const a = fwPos[scan[i - 1].led], b = fwPos[scan[i].led];
        const age = t - scan[i].t, v = Math.exp(-age / tau) * amount;
        const u = Math.min(1, age / 0.22), grow = 1 - Math.pow(1 - u, 3);
        const hot = age < 0.5 ? (1 - age / 0.5) : 0;
        for (let j = 0; j < ARC; j++, k++) {
          const s0 = j / ARC, s1 = (j + 1) / ARC;
          if (s0 >= grow) break;
          arcPoint(a, b, s0, p0); arcPoint(a, b, Math.min(s1, grow), p1);
          P.set([p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]], k * 6);
          // the leading end burns hottest while the jump is in flight
          const tip = hot * Math.max(0, 1 - Math.abs(s1 - grow) * 3);
          const c = [1.2 * v + hot * 0.6 + tip, 0.22 * v + 0.35 * hot + 0.6 * tip, 0.1 * v + 0.25 * hot + 0.45 * tip];
          Cc.set([...c, ...c], k * 6);
        }
      }
    }
    fx.chords.geometry.attributes.instanceStart.data.needsUpdate = true;
    fx.chords.geometry.attributes.instanceColorStart.data.needsUpdate = true;
  };

  // ---- dial: 90 ticks, 4 degrees apart --------------------------------------------------------
  {
    const P = [], C = [];
    for (let s = 0; s < 90; s++) {
      const a = (-94 + s * 4) * Math.PI / 180;       // board-local angle (y up) of slot s
      const long = s % 5 === 0, hl = s === 45 || s === 46;
      const r0 = 13.4, r1 = hl ? 15.6 : long ? 14.4 : 13.9;
      P.push(Math.cos(a) * r0, Math.sin(a) * r0, 0.95, Math.cos(a) * r1, Math.sin(a) * r1, 0.95);
      const c = hl ? [1.3, 1.0, 0.6] : long ? [0.85, 0.64, 0.25] : [0.45, 0.34, 0.14];
      C.push(...c, ...c);
    }
    fx.dial = segs(new Float32Array(P), new Float32Array(C), lineMat({width: 1.4}));
    fx.dial.material.opacity = 0;
    board.add(fx.dial);
    fx.fourDeg = new THREE.Vector3(Math.cos(-92 * Math.PI / 180 + Math.PI) * -16.5, 16.3, 0.95);
  }

  // ---- copper: F.Cu traces lit by net; the four layers for the exploded view -------------------
  const layerNames = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
  const byLayer = Object.fromEntries(layerNames.map(n => [n, boardData.segments.filter(s => s.l === n)]));
  {
    const segsF = byLayer['F.Cu'];
    const P = new Float32Array(segsF.length * 6), C = new Float32Array(segsF.length * 6);
    segsF.forEach((s, i) => P.set([...k2w(s.a, 0.97), ...k2w(s.b, 0.97)], i * 6));
    fx.traces = segs(P, C, lineMat({width: 0.9}));
    fx.traceNets = segsF.map(s => s.n);
    board.add(fx.traces);
  }
  fx.updateTraces = (netGlow, amount) => {
    const Cc = fx.traces.geometry.attributes.instanceColorStart.data.array;
    fx.traceNets.forEach((n, i) => {
      let r = 0, g = 0, b = 0;
      if (amount > 0) {
        const v = netGlow[n] || 0;
        if (n.startsWith('CPX')) { r = (0.12 + 1.6 * v) * amount; g = (0.05 + 0.35 * v) * amount; b = 0.02 * amount; }
        else { r = 0.08 * amount; g = 0.06 * amount; b = 0.02 * amount; }
      }
      Cc.set([r, g, b, r, g, b], i * 6);
    });
    fx.traces.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    fx.traces.visible = amount > 0.002;
  };
  fx.layers = layerNames.map((n, li) => {
    const list = byLayer[n];
    const P = new Float32Array(list.length * 6), C = new Float32Array(list.length * 6);
    const col = [[1.2, 0.85, 0.35], [1.3, 0.3, 0.15], [1.0, 0.2, 0.1], [0.9, 0.65, 0.3]][li];
    list.forEach((s, i) => { P.set([...k2w(s.a), ...k2w(s.b)], i * 6); C.set([...col, ...col], i * 6); });
    const o = segs(P, C, lineMat({width: 1.3}));
    // outline of the layer
    const ring = [];
    const outline = boardData.outlineChain;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      ring.push(...k2w(a), ...k2w(b));
    }
    const oc = new Float32Array(ring.length).fill(0).map((_, i) => [0.5, 0.38, 0.16][i % 3]);
    const edge = segs(new Float32Array(ring), oc, lineMat({width: 1.0}));
    const g = new THREE.Group();
    g.add(o, edge);
    g.visible = false;
    board.add(g);
    return g;
  });
  fx.updateLayers = (ex, labelsOut) => {
    const zs = [7.5, 2.5, -2.5, -7.5];
    fx.layers.forEach((g, i) => {
      g.visible = ex > 0.01;
      g.position.z = 0.5 + zs[i] * ex;
      g.children.forEach(c => { c.material.opacity = clamp(ex * 1.4); });
      labelsOut[i] = g.position.z;
    });
  };

  // ---- the silkscreen heart under U1 -----------------------------------------------------------
  {
    const P = [];
    for (const pl of boardData.silk) for (let i = 0; i + 1 < pl.length; i++) P.push(...k2w(pl[i], 0.99), ...k2w(pl[i + 1], 0.99));
    const C = new Float32Array(P.length).fill(0);
    fx.heart = segs(new Float32Array(P), C, lineMat({width: 3}));
    board.add(fx.heart);
  }
  fx.updateHeart = v => {
    const Cc = fx.heart.geometry.attributes.instanceColorStart.data.array;
    for (let i = 0; i < Cc.length; i += 3) { Cc[i] = 2.2 * v; Cc[i + 1] = 0.35 * v; Cc[i + 2] = 0.25 * v; }
    fx.heart.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    fx.heart.visible = v > 0.002;
  };

  // ---- dimension line under the board ----------------------------------------------------------
  {
    const y = -14.6, z = 0.5;
    const P = new Float32Array([-12, y, z, 12, y, z, -12, y - 0.9, z, -12, y + 0.9, z, 12, y - 0.9, z, 12, y + 0.9, z]);
    const C = new Float32Array(P.length).fill(0.8);
    fx.dim = segs(P, C, lineMat({width: 1.2, additive: false}));
    fx.dim.material.opacity = 0;
    board.add(fx.dim);
    fx.dimAnchor = new THREE.Vector3(0, y, z);
  }

  // ---- battery gauge behind the coin -----------------------------------------------------------
  {
    const N = 128, P = new Float32Array(N * 6), C = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI / 2 - i / N * Math.PI * 2, a1 = Math.PI / 2 - (i + 1) / N * Math.PI * 2;
      P.set([Math.cos(a0) * 12.6, Math.sin(a0) * 12.6 - 0.06, -4.7, Math.cos(a1) * 12.6, Math.sin(a1) * 12.6 - 0.06, -4.7], i * 6);
    }
    fx.gauge = segs(P, C, lineMat({width: 3}));
    fx.gaugeN = N;
    board.add(fx.gauge);
  }
  fx.updateGauge = (u, a) => {
    const Cc = fx.gauge.geometry.attributes.instanceColorStart.data.array;
    for (let i = 0; i < fx.gaugeN; i++) {
      const on = i / fx.gaugeN < u ? a : 0.08 * a;
      Cc.set([1.1 * on, 0.8 * on, 0.3 * on, 1.1 * on, 0.8 * on, 0.3 * on], i * 6);
    }
    fx.gauge.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    fx.gauge.visible = a > 0.002;
  };

  // ---- stars and sparkle motes -----------------------------------------------------------------
  const starTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,245,235,1)'); gr.addColorStop(0.25, 'rgba(255,230,210,0.5)'); gr.addColorStop(1, 'rgba(255,220,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  {
    const N = 2400, P = new Float32Array(N * 3), C = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = hash(i * 3 + 1) * 2 - 1, th = hash(i * 3 + 2) * Math.PI * 2, r = 600 + hash(i * 3 + 3) * 2400;
      const s = Math.sqrt(1 - u * u);
      P.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const b = 0.25 + 0.75 * Math.pow(hash(i * 5 + 7), 3);
      C.set([b, b * 0.96, b * 0.92], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    fx.stars = new THREE.Points(g, new THREE.PointsMaterial({size: 7, map: starTex, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0}));
    scene.add(fx.stars);
  }
  {
    const N = 96, P = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    fx.motes = new THREE.Points(g, new THREE.PointsMaterial({size: 1.6, map: starTex, color: 0xffd8c8, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0}));
    fx.motes.frustumCulled = false;
    board.add(fx.motes);
  }
  fx.updateMotes = (t, events, amount) => {
    const P = fx.motes.geometry.attributes.position.array;
    P.fill(0);
    let k = 0;
    for (let i = lowerBound(events, t + 1e-9) - 1; i >= 0 && k < 96; i--, k++) {
      const e = events[i], age = t - e.t;
      const p = fwPos[e.led];
      const dir = Math.atan2(p.y, p.x) + (hash(i * 13) - 0.5) * 0.6;
      const dist = 11.5 + age * (2.2 + hash(i * 7) * 3);
      P.set([Math.cos(dir) * dist, Math.sin(dir) * dist, 1.2 + age * (hash(i * 3) - 0.3) * 2], k * 3);
    }
    fx.motes.geometry.attributes.position.needsUpdate = true;
    fx.motes.material.opacity = amount;
    fx.motes.visible = amount > 0.002;
  };

  // ---- the infinite hex field ------------------------------------------------------------------------
  // Boards on a hexagonal lattice round the hero (rows horizontal, like the real 35-up panel), revealed
  // ring by ring. Each board is an impostor: a top-down render of the real hero board (set by the film),
  // with its own LEDs glowing on the near rings and a ring of glow further out.
  {
    const PITCH = 26.5, RINGS = 40, NEAR = 8;
    const cells = [];
    for (let q = -RINGS; q <= RINGS; q++) for (let r = -RINGS; r <= RINGS; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (ring === 0 || ring > RINGS) continue;
      cells.push({x: PITCH * (q + r / 2), y: PITCH * Math.sqrt(3) / 2 * r, ring});
    }
    cells.sort((a, b) => a.ring - b.ring || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    fx.cells = cells;
    const N = cells.length, nearN = cells.filter(c => c.ring <= NEAR).length;
    const m = new THREE.Matrix4(), q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    fx.fieldBoards = new THREE.InstancedMesh(new THREE.PlaneGeometry(28, 28),
      new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, alphaTest: 0.6, depthWrite: true}), N);
    fx.fieldLeds = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({color: 0xffffff, map: starTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}), nearN * 90);
    const ringTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 90; i++) {
        const a = i / 90 * Math.PI * 2, x = 128 + Math.cos(a) * 118 * 0.84, y = 128 + Math.sin(a) * 118 * 0.84;
        const gr = g.createRadialGradient(x, y, 0, x, y, 14);
        gr.addColorStop(0, 'rgba(255,120,80,0.9)'); gr.addColorStop(0.4, 'rgba(255,40,15,0.35)'); gr.addColorStop(1, 'rgba(255,20,0,0)');
        g.fillStyle = gr; g.fillRect(x - 14, y - 14, 28, 28);
      }
      return new THREE.CanvasTexture(c);
    })();
    fx.fieldRings = new THREE.InstancedMesh(new THREE.PlaneGeometry(28, 28), new THREE.MeshBasicMaterial({map: ringTex,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}), N);
    cells.forEach((c, i) => {
      m.compose(new THREE.Vector3(c.x, c.y, 0.5), q0, one); fx.fieldBoards.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(c.x, c.y, 1.4), q0, one); fx.fieldRings.setMatrixAt(i, m);
      if (c.ring <= NEAR) fwPos.forEach((lp, j) => {
        m.compose(new THREE.Vector3(c.x + lp.x, c.y + lp.y, 1.5), q0, one);
        fx.fieldLeds.setMatrixAt(i * 90 + j, m);
      });
    });
    fx.fieldGroup = new THREE.Group();
    fx.fieldGroup.add(fx.fieldBoards, fx.fieldRings, fx.fieldLeds);
    fx.fieldGroup.visible = false;
    fx.fieldGroup.frustumCulled = false;
    [fx.fieldBoards, fx.fieldRings, fx.fieldLeds].forEach(o => { o.frustumCulled = false; });
    scene.add(fx.fieldGroup);
    fx.setImpostor = tex => { fx.fieldBoards.material.map = tex; fx.fieldBoards.material.needsUpdate = true; };
    const col = new THREE.Color();
    fx.updateField = (t, on, ringTime, forkAmt, blaze, forkFn, FORKS) => {
      fx.fieldGroup.visible = on > 0.003;
      if (!fx.fieldGroup.visible) return;
      cells.forEach((c, i) => {
        const age = t - ringTime[c.ring];
        const appear = age < 0 ? 0 : Math.min(1, age / 0.25);
        const a = appear * appear * (3 - 2 * appear) * on;
        const s = 0.75 + 0.25 * a;
        m.compose(new THREE.Vector3(c.x, c.y, 0.5), q0, new THREE.Vector3(s, s, s));
        fx.fieldBoards.setMatrixAt(i, m);
        col.setScalar(a);
        fx.fieldBoards.setColorAt(i, col);
        // the ring's own glow: steady at persistence-of-vision speed, flaring on the blaze
        const glow = a * (c.ring > NEAR ? 0.75 : 0.0) + a * blaze * 1.6;
        col.setScalar(glow);
        fx.fieldRings.setColorAt(i, col);
        if (c.ring <= NEAR) {
          const kind = forkAmt > 0.5 && c.ring <= 2 ? FORKS[(i + 1) % FORKS.length] : '+13';
          const L = kind === '+13' ? null : forkFn(kind, t, i + 1);
          for (let j = 0; j < 90; j++) {
            const lv = (L ? L[j] : 0.8) * a;
            const v = Math.min(3, lv * 2.2 + blaze * a * 2);
            col.setRGB(v, v * 0.2, v * 0.1);
            fx.fieldLeds.setColorAt(i * 90 + j, col);
          }
        }
      });
      fx.fieldBoards.instanceMatrix.needsUpdate = true;
      fx.fieldBoards.instanceColor.needsUpdate = true;
      fx.fieldRings.instanceColor.needsUpdate = true;
      fx.fieldLeds.instanceColor.needsUpdate = true;
    };
  }

  fx.fwPos = fwPos;
  return fx;
}
