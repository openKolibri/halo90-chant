'use strict';
/*
 * NONAGINTA — video renderer.
 * Draws every frame from the real HALO-90 KiCad geometry (build/board.json) and the
 * score timeline (build/timeline.json). Stateless per frame so it can render in parallel.
 *
 *   node src/render.js --still 42.5 out.png
 *   node src/render.js --range 0 600 out.mp4
 */
const {createCanvas, GlobalFonts} = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const W = 1920, H = 1080;
const B = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/board.json')));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/timeline.json')));
const FPS = TL.fps;

GlobalFonts.registerFromPath('/System/Library/Fonts/Optima.ttc');
GlobalFonts.registerFromPath('/System/Library/Fonts/SFNSMono.ttf');
GlobalFonts.registerFromPath('/System/Library/Fonts/NewYorkItalic.ttf');
const FONT = {latin: 'Optima', mono: '".SF NS Mono"', ital: '".New York"'};

const COL = {
  bg: [5, 4, 7], red: [255, 38, 16], core: [255, 214, 196], gold: [217, 164, 65],
  bone: [239, 230, 218], copper: [196, 80, 40],
};
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------------------------------------------------------------- math
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = u => (u = clamp(u), u * u * (3 - 2 * u));
const EASE = {
  l: u => u, io: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  o: u => 1 - Math.pow(1 - u, 3), i: u => u * u * u, h: () => 0, s: smooth,
  expo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
};
function kf(keys) {
  return t => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t < keys[i][0]) {
        const [t0, v0] = keys[i - 1], [t1, v1, e] = keys[i];
        return lerp(v0, v1, EASE[e || 'io']((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };
}
const window_ = (t, a, b, fin = 0.4, fout = 0.4) => smooth((t - a) / fin) * smooth((b - t) / fout);
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function lowerBound(arr, t, key = 't') {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][key] < t) lo = m + 1; else hi = m; }
  return lo;
}
const bar = (b, beat = 0) => (b * 4 + beat) * TL.beat;

// ---------------------------------------------------------------- board data
const LED = B.leds;                              // index = firmware LED number
const slotOf = LED.map(l => ((Math.round(((94 - l.ang) % 360 + 360) % 360 / 4)) % 90));
const fwOfSlot = []; slotOf.forEach((s, fw) => { fwOfSlot[s] = fw; });
const PART = Object.fromEntries(B.parts.map(p => [p.ref, p]));
const FW_BY_REF = Object.fromEntries(LED.map(l => [l.ref, l.fw]));

function chainOutline(polys) {
  const rest = polys.map(p => p.slice());
  const out = rest.shift();
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  while (rest.length) {
    const end = out[out.length - 1];
    let best = 0, rev = false, bd = 1e9;
    rest.forEach((p, i) => {
      if (d(p[0], end) < bd) { bd = d(p[0], end); best = i; rev = false; }
      if (d(p[p.length - 1], end) < bd) { bd = d(p[p.length - 1], end); best = i; rev = true; }
    });
    let p = rest.splice(best, 1)[0];
    if (rev) p = p.reverse();
    out.push(...p.slice(1));
  }
  return out;
}
const OUTLINE = chainOutline(B.outline);
const SEG_GROUPS = {};
for (const s of B.segments) {
  const k = `${s.l}|${s.n}`;
  (SEG_GROUPS[k] = SEG_GROUPS[k] || {layer: s.l, net: s.n, segs: [], w: 0}).segs.push(s);
}
for (const g of Object.values(SEG_GROUPS)) g.w = g.segs.reduce((a, s) => a + s.w, 0) / g.segs.length;
const LAYERS = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
const FRONT_PADS = [];
const BACK_PADS = [];
for (const p of B.parts) for (const pd of p.pads) (p.side === 'B.Cu' ? BACK_PADS : FRONT_PADS).push(Object.assign({ref: p.ref}, pd));

// ---------------------------------------------------------------- camera
function makeCam(o) {
  const r = Math.PI / 180;
  const ct = Math.cos(o.tilt * r), st = Math.sin(o.tilt * r);
  const cs = Math.cos(o.spin * r), ss = Math.sin(o.spin * r);
  const cf = Math.cos(o.flip * r), sf = Math.sin(o.flip * r);
  const cr = Math.cos(o.roll * r), sr = Math.sin(o.roll * r);
  const cw = Math.cos(o.sway * r), sw = Math.sin(o.sway * r);
  const D = o.D, zoom = o.zoom, cx = o.cx, cy = o.cy, fx = o.fx, fy = o.fy, px = o.ox || 0, py = o.oy || 0;
  const cam = function (x, y, z = 0) {
    x += px; y += py;
    // pendulum sway about the eyelet
    let dx = x, dy = y + 13.5;
    x = dx * cw - dy * sw; y = dx * sw + dy * cw - 13.5;
    let X = x * cs - y * ss, Y = x * ss + y * cs, Z = z;
    const X2 = X * cf + Z * sf; Z = -X * sf + Z * cf; X = X2;
    X -= fx; Y -= fy;
    const Y2 = Y * ct - Z * st; Z = Y * st + Z * ct; Y = Y2;
    const X4 = X * cr - Y * sr, Y4 = X * sr + Y * cr;
    const s = D > 1e5 ? 1 : D / Math.max(D + Z, 0.5);
    return [cx + X4 * zoom * s, cy + Y4 * zoom * s, s * zoom, Z];
  };
  cam.o = o;
  return cam;
}

// Keyframed camera + board state over the whole film ----------------------------
const T = {
  zoom: kf([[0, 26], [4.6, 26], [7.5, 112, 'io'], [26, 122, 'l'], [29.6, 30, 'io'], [60, 30, 'l'], [63.2, 32, 'l'],
    [65.8, 17, 'io'], [66, 20, 'h'], [90, 20, 'l'], [91.5, 90, 'io'], [95.3, 90, 'l'], [96.6, 20, 'io'],
    [102, 18, 'h'], [120, 18, 'l'], [125.8, 26, 'i'], [126, 27, 'h'], [131, 31, 'l'], [133.6, 16, 'io'],
    [137.5, 5.6, 'io'], [144, 5.6, 'l'], [150, 1.5, 'io'], [153, 1.4, 'l'], [155.6, 22, 'expo'],
    [156, 20, 'h'], [168, 20, 'l'], [168.001, 25, 'h']]),
  cy: kf([[0, 470], [4.6, 470], [7.5, 1210, 'io'], [26, 1210, 'l'], [29.6, 470, 'io'], [66, 470, 'l'],
    [66.001, 575, 'h'], [101, 575, 'l'], [102, 470, 'h'], [126, 470, 'l'], [126.001, 440, 'h'], [131.5, 440, 'l'], [133.5, 470, 'io'],
    [156, 470, 'l'], [156.001, 575, 'h'], [168, 575, 'l'], [168.001, 470, 'h']]),
  tilt: kf([[0, 0], [4.6, 0], [7.5, -63, 'io'], [26, -58, 'l'], [29.6, 0, 'io'], [126, 0, 'l'], [127.8, 58, 'io'],
    [131.5, 52, 'l'], [133.4, 0, 'io']]),
  D: kf([[0, 1e6], [4.6, 1e6], [5.0, 60, 'h'], [7.5, 38, 'io'], [26, 38, 'l'], [29.6, 400, 'io'], [30, 1e6, 'h'],
    [126, 1e6, 'l'], [126.01, 160, 'h'], [133.4, 160, 'l'], [133.5, 1e6, 'h']]),
  spin: kf([[0, 0], [5, 0], [29.6, -62, 'io'], [30, 0, 'h'], [62.8, -40, 'l'], [65.6, 0, 'io'], [102, 0, 'l'],
    [126, -30, 'l'], [126.001, 0, 'h'], [133.5, 110, 'io'], [133.501, 0, 'h']]),
  fy: kf([[0, 0], [5, 0], [7.5, 11.2, 'io'], [26, 11.2, 'l'], [29.6, 0, 'io'], [90, 0, 'l'], [91.5, 1.0, 'io'],
    [95.3, 1.0, 'l'], [96.6, 0, 'io']]),
  flip: kf([[0, 0], [108.2, 0], [109.8, 180, 'io'], [118.6, 180, 'l'], [120.2, 360, 'io'], [120.201, 0, 'h']]),
  explode: kf([[0, 0], [126.2, 0], [128.4, 1, 'io'], [131.6, 1, 'l'], [133.2, 0, 'io']]),
  boardVis: kf([[0, 0], [62.8, 0], [65.2, 1, 'io'], [101, 1, 'l'], [102, 0.35, 'h'], [126, 0.35, 'l'],
    [126.001, 0.9, 'h'], [150, 0.9, 'l'], [156, 0.55, 'io'], [161.5, 0.5, 'l'], [163.5, 0.12, 'o'],
    [168, 0.05, 'l']]),
  hookVis: kf([[0, 0], [63.5, 0], [65.5, 1, 'io'], [102, 1, 'l'], [102.001, 0, 'h'], [156, 0, 'h'],
    [156.001, 1, 'h'], [168, 1, 'l'], [168.001, 0, 'h']]),
  panel: kf([[0, 0], [133.2, 0], [134.8, 1, 'io'], [153, 1, 'l'], [155.8, 0, 'io']]),
};

function swayAt(t) {
  if (t >= 66 && t < 102) return 3.5 * Math.sin(2 * Math.PI * (t - 66) / (TL.bar * 2)) * smooth((t - 66) / 3);
  if (t >= 156 && t < 168) return 1.2 * Math.sin(2 * Math.PI * (t - 156) / 7);
  return 0;
}

function camAt(t) {
  let zoom = T.zoom(t);
  // taiko pulse
  const k = lowerBound(TL.taiko, t + 1e-6) - 1;
  if (k >= 0 && t >= 30 && t < 152) {
    const h = TL.taiko[k];
    zoom *= 1 + 0.012 * h.v * Math.exp(-(t - h.t) / 0.12);
  }
  const fx = t >= 90 && t < 96.6 ? lerp(0, PART.U1.p[0], smooth((t - 90) / 1.5) * smooth((96.6 - t) / 1.3)) : 0;
  let fy = T.fy(t);
  if (t >= 90 && t < 96.6) fy = lerp(0, PART.U1.p[1], smooth((t - 90) / 1.5) * smooth((96.6 - t) / 1.3));
  return makeCam({zoom, cx: W / 2, cy: T.cy(t), tilt: T.tilt(t), spin: T.spin(t), flip: T.flip(t), roll: 0,
    sway: swayAt(t), D: T.D(t), fx, fy});
}

// ---------------------------------------------------------------- LED model
// Levels are "perceived brightness": the hardware lights one LED at a time and the eye
// integrates. Every pattern below is derived from the firmware or the score.
function persist(L, events, t, tau, gain = 1, fromIdx = 0) {
  const i1 = lowerBound(events, t + 1e-9);
  for (let i = i1 - 1; i >= fromIdx; i--) {
    const e = events[i], dt = t - e.t;
    if (dt > tau * 7) break;
    const v = gain * Math.exp(-dt / tau);
    if (v > L[e.led]) L[e.led] = v;
  }
}

const BOOT2 = TL.boot.map(e => ({t: e.t - 0.6 + 175.4, led: e.led}));
const INTRO_LED = fwOfSlot[45];   // bottom of the ring = nearest the camera in the ringworld shot
const L2 = TL.lines[1];
const HALO_SYL = [];               // one Halo-scan step per sung syllable (lines 3-4), then the bells
{
  let led = 0;
  for (const li of [2, 3]) for (const s of TL.lines[li].syls) { HALO_SYL.push({t: s.t0, led}); led = (led + 13) % 90; }
  for (const e of TL.scan_bells) { HALO_SYL.push({t: e.t, led}); led = (led + 13) % 90; }
}
const SCAN_START = HALO_SYL[HALO_SYL.length - 1].led;
// "una sola ardet": one step per beat; "omnes lucent": exponential speed-up to POV rate
const ACC_T0 = 60, ACC_R0 = 1.4, ACC_K = 3.1;
function accelSteps(t) { return ACC_R0 / ACC_K * (Math.exp(ACC_K * (t - ACC_T0)) - 1); }
function accelTime(n) { return ACC_T0 + Math.log(1 + n * ACC_K / ACC_R0) / ACC_K; }

function sparkleVisual(L, t, t0, gain, tau = 0.05) {
  // the firmware: ~320 Hz wake-ups, rand()%15 == 0 lights rand()%90
  const k1 = Math.floor(t * 320), k0 = Math.max(Math.floor((t - tau * 6) * 320), Math.floor(t0 * 320));
  for (let k = k1; k >= k0; k--) {
    if (Math.floor(hash(k * 2 + 1) * 15) !== 0) continue;
    const led = Math.floor(hash(k * 7 + 3) * 90);
    const v = gain * Math.exp(-(t - k / 320) / tau);
    if (v > L[led]) L[led] = v;
  }
}

function audioMode(L, t, gain = 1) {
  // setLed((4140 + rotationCenter + adc) % 90) — adc swings around its bias with the music
  const f = Math.floor(t * FPS);
  for (let back = 0; back < 3; back++) {
    const w = TL.wave[f - back];
    if (!w) continue;
    const rc = Math.floor((t - back / FPS) * 10) % 90;
    const decay = [1, 0.45, 0.2][back];
    const loud = 0.25 + 1.6 * (TL.rms[f - back] || 0);
    for (let i = 0; i < 90; i += 2) {
      const adc = Math.round(w[i] * 150);
      const led = ((4140 + rc + adc) % 90 + 90) % 90;
      L[led] = Math.min(1, L[led] + 0.16 * decay * gain * loud);
    }
  }
}

function ledLevels(t) {
  const L = new Float32Array(90);
  if (t < 3.0) {
    persist(L, TL.boot, t, 0.22, 1.0);
    if (t > 1.6) for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], 0.9 * Math.exp(-(t - 1.6) / 0.25));
  }
  if (t >= 2.2 && t < 18.3) {
    const breathe = 0.82 + 0.18 * Math.sin(t * 1.3);
    L[INTRO_LED] = Math.max(L[INTRO_LED], smooth((t - 2.2) / 2) * breathe);
  }
  if (t >= 18.0 && t < 30.2) {
    // "circumit": one LED travels once around the ring, a step per sung syllable
    const syl = L2.syls;
    let prog = 0;
    for (let i = 0; i < syl.length; i++) {
      const a = syl[i].t0, b = i + 1 < syl.length ? syl[i + 1].t0 : syl[i].t1;
      if (t >= a) prog = (i + clamp((t - a) / (b - a))) / syl.length;
    }
    const head = 45 + prog * 90;
    for (let s = 0; s < 90; s++) {
      let back = head - (45 + s); back = ((back % 90) + 90) % 90;
      if (45 + s > head && prog < 1) back = 999;           // not reached yet
      const trail = prog >= 1 ? 0.35 : 0.3;
      const v = back < 0.5 ? 1 : trail * Math.exp(-back / 26) + (back < 3 ? 0.4 * (1 - back / 3) : 0);
      const fw = fwOfSlot[s];
      const fade = t > 28.5 ? Math.exp(-(t - 28.5) / 0.9) : 1;
      if (back !== 999) L[fw] = Math.max(L[fw], v * fade);
    }
  }
  if (t >= 29.95 && t < 31.5) for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], Math.exp(-(t - 29.95) / 0.5));
  if (t >= 30 && t < 54.3) persist(L, HALO_SYL, t, t < 42 ? 0.9 : 0.45, 1.0);
  if (t >= 54 && t < 60) {
    const n = Math.floor((t - 54) / TL.beat);
    let led = SCAN_START; for (let i = 0; i <= n; i++) led = (led + 13) % 90;
    L.fill(0);
    L[led] = 1;
  }
  if (t >= 60 && t < 66) {
    const tau = 0.14;
    const n1 = accelSteps(t), n0 = accelSteps(Math.max(60, t - tau * 6));
    let base = 0;
    if (n1 - n0 > 300) base = 1;
    else {
      for (let n = Math.floor(n1); n >= Math.max(0, Math.floor(n0)); n--) {
        let led = SCAN_START; led = (led + 13 * (n + 7)) % 90;
        const v = Math.exp(-(t - accelTime(n)) / tau);
        if (v > L[led]) L[led] = v;
      }
      base = clamp((n1 - n0) / 300);
    }
    for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], base * 0.92);
  }
  if (t >= 66 && t < 101.3) {
    const g = t < 96 ? 0.85 : 1.1;
    audioMode(L, t, g);
    persist(L, TL.ostinato, t, 0.1, 1.0);
  }
  if (t >= 101.3 && t < 102.0) for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], 0.9 * Math.exp(-(t - 101.3) / 0.12));
  if (t >= 102 && t < 126) {
    persist(L, TL.sparkle, t, 0.45, 1.0);
    sparkleVisual(L, t, 102, t > 120 ? 0.7 + (t - 120) * 0.05 : 0.6, 0.08);
    if (t > 121) {
      const u = (t - 121) / 5;
      persist(L, HALO_SYL, 42 + (t - 121) * (1 + u * 6), 0.3, u);
    }
  }
  if (t >= 126 && t < 156) {
    // the "hero" board in the panel: the real Halo pattern at POV speed = a steady ring
    for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], 0.8 + 0.2 * Math.sin(i * 0.7 + t * 9));
    persist(L, TL.ostinato, t, 0.1, 1.0);
  }
  if (t >= 156 && t < 162) {
    const off = t >= 161.5 ? Math.exp(-(t - 161.5) / 0.08) : 1;
    for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], 0.62 * off * (0.97 + 0.03 * hash(i + Math.floor(t * 60))));
  }
  if (t >= 175.4) persist(L, BOOT2, t, 0.3, 1.0);
  return L;
}

// ---------------------------------------------------------------- sprites
function makeGlow(size, stops) {
  const c = createCanvas(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
const GLOW = makeGlow(256, [[0, 'rgba(255,120,90,1)'], [0.08, 'rgba(255,60,30,0.85)'], [0.25, 'rgba(255,32,12,0.32)'],
  [0.55, 'rgba(220,20,8,0.08)'], [1, 'rgba(200,10,0,0)']]);
const CORE = makeGlow(64, [[0, 'rgba(255,240,230,1)'], [0.35, 'rgba(255,170,140,0.9)'], [1, 'rgba(255,60,30,0)']]);
const STAR = makeGlow(32, [[0, 'rgba(255,245,235,1)'], [0.3, 'rgba(255,230,210,0.4)'], [1, 'rgba(255,220,200,0)']]);
const GOLDGLOW = makeGlow(128, [[0, 'rgba(255,200,120,0.9)'], [0.3, 'rgba(217,164,65,0.35)'], [1, 'rgba(217,164,65,0)']]);
// ring sprite for far-away boards in the field
const RINGSPR = (() => {
  const s = 256, c = createCanvas(s, s), g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const a = i / 90 * Math.PI * 2, x = s / 2 + Math.cos(a) * s * 0.36, y = s / 2 + Math.sin(a) * s * 0.36;
    g.drawImage(GLOW, x - 30, y - 30, 60, 60);
  }
  return c;
})();
const GRAIN = [0, 1, 2, 3].map(k => {
  const c = createCanvas(512, 512), g = c.getContext('2d');
  const img = g.createImageData(512, 512), rnd = mulberry(k * 999 + 1);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rnd() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
});
const STARS = (() => {
  const r = mulberry(12345), out = [];
  for (let i = 0; i < 700; i++) out.push({x: (r() - 0.5) * 2, y: (r() - 0.5) * 2, d: 0.15 + r() * 0.85, b: r(), tw: r() * 6});
  return out;
})();

// ---------------------------------------------------------------- drawing: board
function poly(g, cam, pts, z = 0) {
  g.beginPath();
  pts.forEach((p, i) => { const q = cam(p[0], p[1], z); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
  g.closePath();
}
function rectPts(cx, cy, w, h, rotDeg) {
  const a = -rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function drawBoardBody(g, cam, vis, t, levels, back) {
  if (vis <= 0.003) return;
  poly(g, cam, OUTLINE);
  const c = cam(0, 0), e = cam(12, 0);
  const R = Math.hypot(e[0] - c[0], e[1] - c[1]) || 1;
  const gr = g.createRadialGradient(c[0] - R * 0.3, c[1] - R * 0.4, R * 0.1, c[0], c[1], R * 1.3);
  gr.addColorStop(0, `rgba(30,26,30,${vis})`);
  gr.addColorStop(1, `rgba(10,9,11,${vis})`);
  g.fillStyle = gr; g.fill();
  // rim light: warm edge from the LEDs, cool edge from "the room"
  g.lineWidth = Math.max(1, cam.o.zoom * 0.12);
  g.strokeStyle = `rgba(255,70,40,${0.35 * vis})`; g.stroke();
  // eyelet hole
  const h = cam(0, -13), hr = cam(0.5, -13);
  g.beginPath(); g.arc(h[0], h[1], Math.max(1, Math.abs(hr[0] - h[0])), 0, Math.PI * 2);
  g.fillStyle = rgba(COL.bg, 1); g.fill();
  g.strokeStyle = `rgba(217,164,65,${0.8 * vis})`; g.lineWidth = Math.max(1, cam.o.zoom * 0.18); g.stroke();
}

function netGlow(t) {
  // which charlieplex nets are driven right now (col HIGH = anode, row LOW = cathode)
  const out = {};
  const i1 = lowerBound(TL.ostinato, t + 1e-9);
  for (let i = i1 - 1; i >= 0 && i > i1 - 6; i--) {
    const e = TL.ostinato[i], v = Math.exp(-(t - e.t) / 0.14);
    const l = LED[e.led];
    out[l.A] = Math.max(out[l.A] || 0, v);
    out[l.K] = Math.max(out[l.K] || 0, v * 0.8);
  }
  return out;
}

function drawTraces(g, cam, t, alpha, mode, zOffset = null) {
  if (alpha <= 0.003) return;
  const glow = mode === 'nets' ? netGlow(t) : null;
  g.lineCap = 'round';
  for (const grp of Object.values(SEG_GROUPS)) {
    let a = alpha, col = [60, 52, 48];
    const li = LAYERS.indexOf(grp.layer);
    let z = 0;
    if (zOffset) z = zOffset[li];
    if (mode === 'dim') { if (grp.layer !== 'F.Cu') continue; a *= 0.55; col = [48, 42, 42]; }
    else if (mode === 'nets') {
      if (grp.layer === 'B.Cu') continue;
      const v = glow[grp.net] || 0;
      if (grp.net.startsWith('CPX')) { col = [lerp(70, 255, v), lerp(40, 80, v), lerp(30, 30, v)]; a *= 0.35 + 0.65 * v; }
      else { col = [80, 64, 40]; a *= 0.25; }
      if (grp.layer !== 'F.Cu') a *= 0.5;
    } else if (mode === 'layers') {
      col = [[233, 180, 80], [255, 70, 40], [220, 50, 30], [200, 150, 70]][li];
      a *= [1, 0.8, 0.75, 0.7][li];
    }
    g.strokeStyle = rgba(col, a);
    g.lineWidth = Math.max(0.6, grp.w * cam.o.zoom * (zOffset ? 1 : 1));
    g.beginPath();
    for (const s of grp.segs) {
      const p = cam(s.a[0], s.a[1], z), q = cam(s.b[0], s.b[1], z);
      g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
    }
    g.stroke();
  }
}

function drawPads(g, cam, vis, t, levels, back, ledOnly = false) {
  if (vis <= 0.003) return;
  const pads = back ? BACK_PADS : FRONT_PADS;
  for (const pd of pads) {
    if (pd.w < 0.05) continue;
    if (ledOnly && FW_BY_REF[pd.ref] === undefined) continue;
    let light = 0;
    if (levels && FW_BY_REF[pd.ref] !== undefined) light = levels[FW_BY_REF[pd.ref]];
    const pts = rectPts(pd.p[0], pd.p[1], pd.w, pd.h, pd.r);
    poly(g, cam, pts);
    const k = 0.5 + 0.5 * light;
    g.fillStyle = `rgba(${Math.round(lerp(150, 255, light))},${Math.round(lerp(112, 180, light))},${Math.round(lerp(50, 90, light))},${vis * k})`;
    g.fill();
  }
}

function drawComponents(g, cam, vis, t) {
  if (vis <= 0.003) return;
  const body = (ref, w, h, fill, stroke) => {
    const p = PART[ref]; if (!p) return;
    poly(g, cam, rectPts(p.p[0], p.p[1], w, h, p.r));
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = Math.max(0.5, cam.o.zoom * 0.05); g.stroke(); }
  };
  body('U1', 4, 4, `rgba(22,22,26,${vis})`, `rgba(90,90,100,${0.6 * vis})`);
  body('MK1', 3.1, 2.5, `rgba(150,150,158,${vis})`, `rgba(210,210,220,${0.5 * vis})`);
  body('S1', 3, 2, `rgba(20,20,22,${vis})`, `rgba(120,120,120,${0.5 * vis})`);
  if (PART.S1) {
    const p = PART.S1;
    poly(g, cam, rectPts(p.p[0], p.p[1], 1.0, 0.8, p.r));
    g.fillStyle = `rgba(200,200,205,${vis})`; g.fill();
  }
  body('R3', 1.0, 0.5, `rgba(20,20,20,${vis})`);
  body('C1', 1.0, 0.5, `rgba(170,140,100,${vis})`);
  body('C2', 1.0, 0.5, `rgba(170,140,100,${vis})`);
  // mic port and the silkscreen heart under U1
  if (PART.MK1) {
    const m = cam(PART.MK1.p[0], PART.MK1.p[1]);
    g.beginPath(); g.arc(m[0], m[1], Math.max(0.8, cam.o.zoom * 0.35), 0, 7); g.fillStyle = `rgba(30,30,34,${vis})`; g.fill();
  }
}

function drawSilk(g, cam, vis, heartGlow = 0) {
  if (vis <= 0.003 && heartGlow <= 0) return;
  g.lineCap = 'round';
  for (const pl of B.silk) {
    g.beginPath();
    pl.forEach((p, i) => { const q = cam(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
    g.strokeStyle = heartGlow > 0 ? `rgba(255,${Math.round(lerp(230, 90, heartGlow))},${Math.round(lerp(220, 70, heartGlow))},${clamp(vis + heartGlow)})` : `rgba(235,230,225,${vis * 0.8})`;
    g.lineWidth = Math.max(1, cam.o.zoom * 0.127 * (1 + heartGlow));
    g.stroke();
  }
}

function drawLedBodies(g, cam, vis, levels) {
  if (vis <= 0.003) return;
  for (const l of LED) {
    const pts = rectPts(l.p[0], l.p[1], 0.62, 0.5, l.r);
    poly(g, cam, pts);
    const v = levels ? levels[l.fw] : 0;
    g.fillStyle = `rgba(${Math.round(lerp(205, 255, v))},${Math.round(lerp(196, 120, v))},${Math.round(lerp(185, 100, v))},${vis * (0.55 + 0.45 * v)})`;
    g.fill();
  }
}

function drawLedGlows(g, bloom, cam, levels, scale = 1, alpha = 1) {
  g.globalCompositeOperation = 'lighter';
  bloom.globalCompositeOperation = 'lighter';
  for (const l of LED) {
    const v = levels[l.fw] * alpha;
    if (v < 0.004) continue;
    const p = cam(l.p[0], l.p[1]);
    const s = p[2];                       // px per mm at this depth
    const r = Math.max(6, s * 2.6) * scale;
    g.globalAlpha = clamp(v);
    g.drawImage(GLOW, p[0] - r, p[1] - r, r * 2, r * 2);
    const cr = Math.max(2.2, s * 0.55) * scale;
    g.drawImage(CORE, p[0] - cr, p[1] - cr, cr * 2, cr * 2);
    bloom.globalAlpha = clamp(v * 0.9);
    const br = Math.max(10, s * 3.4) * scale / 4;
    bloom.drawImage(GLOW, p[0] / 4 - br, p[1] / 4 - br, br * 2, br * 2);
  }
  g.globalAlpha = 1; bloom.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function drawHook(g, cam, vis) {
  if (vis <= 0.003) return;
  const P = pts => pts.map(p => cam(p[0], p[1]));
  const [a, b, c, d, e, f] = P([[0, -13.6], [0, -16.5], [0, -24.5], [8.6, -26.5], [8.8, -19], [8.0, -15]]);
  g.lineCap = 'round';
  for (const [w, col] of [[0.8, `rgba(150,105,35,${vis})`], [0.45, `rgba(232,186,92,${vis})`], [0.15, `rgba(255,236,190,${vis * 0.8})`]]) {
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    g.bezierCurveTo(c[0], c[1], d[0], d[1], e[0], e[1]); g.lineTo(f[0], f[1]);
    g.strokeStyle = col; g.lineWidth = Math.max(1, w * cam.o.zoom); g.stroke();
  }
  // the little coil bead
  for (let i = 0; i < 5; i++) {
    const q = cam(0, -15.4 - i * 0.28), rx = cam.o.zoom * 0.55;
    g.beginPath(); g.ellipse(q[0], q[1], Math.max(1, rx), Math.max(0.5, rx * 0.35), 0, 0, 7);
    g.strokeStyle = `rgba(232,186,92,${vis})`; g.lineWidth = Math.max(0.8, cam.o.zoom * 0.14); g.stroke();
  }
}

function drawBack(g, cam, vis, t) {
  // back side: CR2032 in its stamped holder, and the back silkscreen
  poly(g, cam, OUTLINE);
  g.fillStyle = `rgba(14,12,14,${vis})`; g.fill();
  const c = cam(0, 0.3), e = cam(10, 0.3);
  const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
  const sx = (e[0] - c[0]) / r || 1;
  g.save();
  g.translate(c[0], c[1]);
  g.scale(Math.abs(sx) < 0.02 ? 0.02 : Math.abs(sx), 1);
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
  gr.addColorStop(0, `rgba(235,235,240,${vis})`); gr.addColorStop(0.55, `rgba(165,168,175,${vis})`);
  gr.addColorStop(1, `rgba(95,98,105,${vis})`);
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = gr; g.fill();
  g.lineWidth = r * 0.04; g.strokeStyle = `rgba(60,62,68,${vis})`; g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.93, 0, 7); g.lineWidth = r * 0.01; g.strokeStyle = `rgba(255,255,255,${0.4 * vis})`; g.stroke();
  // stamped holder tabs
  g.fillStyle = `rgba(70,72,78,${vis})`;
  g.textAlign = 'center';
  g.font = `${Math.round(r * 0.26)}px ${FONT.latin}`;
  g.fillText('CR2032', 0, r * 0.02);
  g.font = `${Math.round(r * 0.13)}px ${FONT.mono}`;
  g.fillText('3V  LITHIUM', 0, r * 0.25);
  g.fillText('+', 0, -r * 0.45);
  g.restore();
  // back silk (mirrored text on the real board)
  const s = cam(0, -10.1 - 0.9), sz = cam.o.zoom * 0.8;
  g.fillStyle = `rgba(235,230,225,${0.75 * vis})`;
  g.font = `${Math.max(6, sz)}px ${FONT.mono}`;
  g.textAlign = 'center';
  ['KOLIBRI', 'sawaiz 2021-01', 'HALO-90 0v5'].forEach((txt, i) => g.fillText(txt, s[0], s[1] + (i - 1) * sz * 1.25));
}

// ---------------------------------------------------------------- scene helpers
function drawStars(g, t, cam, amount, extra = 0) {
  if (amount <= 0) return;
  g.globalCompositeOperation = 'lighter';
  const spin = cam.o.spin * Math.PI / 180, zoom = cam.o.zoom;
  const tiltShift = cam.o.tilt / 90;
  for (const s of STARS) {
    const par = Math.pow(s.d, 1.5);
    const a = spin * par * 0.4;
    let x = s.x * Math.cos(a) - s.y * Math.sin(a), y = s.x * Math.sin(a) + s.y * Math.cos(a);
    const sc = 1 + (zoom / 30 - 1) * par * 0.08;
    x = W / 2 + x * W * 0.62 * sc; y = H / 2 + (y - tiltShift * 0.4 * par) * H * 0.62 * sc + t * 2 * par;
    y = ((y % (H * 1.3)) + H * 1.3) % (H * 1.3) - H * 0.15;
    const tw = 0.6 + 0.4 * Math.sin(t * (0.6 + s.tw) + s.tw * 7);
    const al = amount * (0.15 + 0.6 * s.b * s.b) * tw;
    const r = 1.2 + 2.6 * s.b * s.d;
    g.globalAlpha = clamp(al);
    g.drawImage(STAR, x - r * 2, y - r * 2, r * 4, r * 4);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function sparkleStars(g, bloom, cam, t) {
  // each musical sparkle becomes a star that drifts out into the dark
  if (t < 102 || t > 128) return;
  g.globalCompositeOperation = 'lighter';
  const fade = t > 124 ? smooth((127 - t) / 3) : 1;
  for (const e of TL.sparkle) {
    if (e.t > t) break;
    const age = t - e.t;
    const l = LED[e.led];
    const dir = Math.atan2(l.p[1], l.p[0]) + (hash(e.led * 13) - 0.5) * 0.6;
    const dist = 11 + age * (2.2 + hash(e.led * 7) * 3);
    const p = cam(Math.cos(dir) * dist, Math.sin(dir) * dist);
    const al = smooth(age / 0.4) * 0.8 * fade * (0.6 + 0.4 * Math.sin(age * 3 + e.led));
    const r = 3 + 3 * hash(e.led);
    g.globalAlpha = clamp(al);
    g.drawImage(STAR, p[0] - r * 2.5, p[1] - r * 2.5, r * 5, r * 5);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function drawChords(g, cam, t) {
  // the Halo scan drawn as string art: a line from each lit LED to the next (+13)
  if (t < 30 || t > 56) return;
  const fadeAll = t > 54 ? Math.exp(-(t - 54) / 0.25) : 1;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  const i1 = lowerBound(HALO_SYL, t + 1e-9);
  const tau = t < 42 ? 6 : 3.5;
  for (let i = Math.max(1, i1 - 90); i < i1; i++) {
    const a = HALO_SYL[i - 1], b = HALO_SYL[i];
    const age = t - b.t;
    const v = Math.exp(-age / tau) * fadeAll;
    if (v < 0.01) continue;
    const p = cam(LED[a.led].p[0], LED[a.led].p[1]), q = cam(LED[b.led].p[0], LED[b.led].p[1]);
    // draw on: the newest chord grows from a to b
    const u = clamp(age / 0.18);
    const qx = lerp(p[0], q[0], EASE.o(u)), qy = lerp(p[1], q[1], EASE.o(u));
    g.strokeStyle = `rgba(255,60,30,${0.55 * v})`;
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(qx, qy); g.stroke();
    if (age < 0.5) {
      g.strokeStyle = `rgba(255,190,150,${0.6 * (1 - age / 0.5)})`;
      g.lineWidth = 2.5; g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
}

function drawDial(g, cam, t, alpha) {
  // protractor ticks: 90 positions, 4 degrees apart
  if (alpha <= 0) return;
  const c = cam(0, 0);
  const R = cam.o.zoom * 13.2;
  g.save();
  g.translate(c[0], c[1]);
  for (let i = 0; i < 90; i++) {
    const a = (94 - i * 4 + cam.o.spin) * Math.PI / 180;
    const long = i % 5 === 0;
    const r0 = R, r1 = R + (long ? 16 : 8);
    g.strokeStyle = `rgba(217,164,65,${alpha * (long ? 0.7 : 0.35)})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
  }
  // highlight 4° between two neighbours
  const u = smooth((t - 36.2) / 1.2) * smooth((42.5 - t) / 0.6);
  if (u > 0) {
    const a0 = (94 - 45 * 4 + cam.o.spin) * Math.PI / 180, a1 = a0 - 4 * Math.PI / 180;
    g.strokeStyle = `rgba(255,210,140,${u})`; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, R + 30, a1, a0); g.stroke();
    [a0, a1].forEach(a => { g.beginPath(); g.moveTo(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6)); g.lineTo(Math.cos(a) * (R + 38), Math.sin(a) * (R + 38)); g.stroke(); });
    g.fillStyle = `rgba(255,220,170,${u})`;
    g.font = `26px ${FONT.mono}`; g.textAlign = 'center';
    const am = (a0 + a1) / 2;
    g.fillText('4°', Math.cos(am) * (R + 66), Math.sin(am) * (R + 66) + 9);
  }
  g.restore();
}

function label(g, x, y, txt, alpha, opts = {}) {
  if (alpha <= 0) return;
  const fam = opts.font || FONT.mono;
  g.font = fam.startsWith('italic ') ? `italic ${opts.size || 22}px ${fam.slice(7)}` : `${opts.size || 22}px ${fam}`;
  g.textAlign = opts.align || 'left';
  g.fillStyle = opts.color ? rgba(opts.color, alpha) : rgba(COL.bone, alpha);
  if (opts.spacing) g.letterSpacing = opts.spacing; else g.letterSpacing = '0px';
  g.fillText(txt, x, y);
  g.letterSpacing = '0px';
}

function callout(g, from, to, lines, alpha, t0, t) {
  if (alpha <= 0) return;
  const u = EASE.o(clamp((t - t0) / 0.6));
  g.strokeStyle = rgba(COL.gold, 0.8 * alpha); g.lineWidth = 1.2;
  const mx = lerp(from[0], to[0], u), my = lerp(from[1], to[1], u);
  g.beginPath(); g.arc(from[0], from[1], 6, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(from[0], from[1]); g.lineTo(mx, my);
  if (u >= 1) g.lineTo(to[0] + (to[0] > from[0] ? 30 : -30), to[1]);
  g.stroke();
  if (u >= 0.95) {
    const dir = to[0] > from[0] ? 1 : -1;
    lines.forEach((ln, i) => label(g, to[0] + dir * 40, to[1] + 8 + i * 30, typed(ln, t - t0 - 0.5), alpha * (i ? 0.7 : 1),
      {align: dir > 0 ? 'left' : 'right', size: i ? 19 : 23, color: i ? COL.bone : COL.gold}));
  }
}

function typed(s, dt, cps = 45) {
  const n = Math.floor(clamp(dt * cps / s.length) * s.length);
  return s.slice(0, n);
}

// ---------------------------------------------------------------- overlays
const latinOf = s => s.toUpperCase().replace(/U/g, 'V');

function drawLyrics(g, t) {
  TL.lines.forEach((L, li) => {
    // each line must be gone before the next one starts to appear
    const next = TL.lines[li + 1];
    const end = next ? Math.min(L.t1 + 1.3, next.t0 - 0.5) : L.t1 + 1.3;
    const a = window_(t, L.t0 - 0.45, end, 0.4, Math.min(0.7, Math.max(0.25, end - L.t1)));
    if (a <= 0) return;
    const y = 902;
    // Latin line: inscription capitals, each syllable lights as it is sung
    g.font = `58px ${FONT.latin}`;
    g.letterSpacing = '9px';
    const parts = [];
    let prevWord = -1;
    for (const s of L.syls) {
      if (s.word !== prevWord && parts.length) parts.push({space: true});
      parts.push({s, txt: latinOf(s.text)});
      prevWord = s.word;
    }
    const space = 30;
    let total = 0;
    for (const p of parts) total += p.space ? space : g.measureText(p.txt).width;
    let x = W / 2 - total / 2;
    g.textAlign = 'left';
    for (const p of parts) {
      if (p.space) { x += space; continue; }
      const s = p.s, w = g.measureText(p.txt).width;
      const on = t >= s.t0 - 0.04 && t <= s.t1 + 0.05;
      const sung = t > s.t1;
      let col, al, blur = 0;
      if (on) { col = [255, 236, 226]; al = 1; blur = 22; }
      else if (sung) { col = COL.bone; al = 0.82; }
      else { col = COL.bone; al = 0.26; }
      if (blur) { g.shadowColor = 'rgba(255,50,20,0.95)'; g.shadowBlur = blur; }
      g.fillStyle = rgba(col, al * a);
      g.fillText(p.txt, x, y);
      g.shadowBlur = 0;
      if (on) {
        const u = clamp((t - s.t0) / Math.max(0.2, s.t1 - s.t0));
        g.fillStyle = `rgba(255,60,30,${0.9 * a})`;
        g.fillRect(x, y + 16, (w - 9) * u, 2);
      }
      x += w;
    }
    g.letterSpacing = '0px';
    label(g, W / 2, y + 52, L.en, 0.62 * a, {font: `italic ${FONT.ital}`, size: 25, align: 'center'});
    const tech = typed(L.tech, t - L.t0 + 0.2, 38);
    const caret = Math.floor(t * 2.5) % 2 && tech.length < L.tech.length + 1 ? '▌' : ' ';
    label(g, W / 2, y + 96, tech + caret, 0.9 * a, {size: 23, align: 'center', color: COL.gold});
  });
}

const MODES = [
  [30, 66, 'HALO', '10.88 mA', '≈ 20.2 h'],
  [66, 102, 'DYNAMIC', '11.71 mA', '≈ 18.8 h'],
  [102, 126, 'SPARKLE', '2.01 mA', '≈ 109.5 h'],
  [126, 156, 'HALO × 35', '380.8 mA', 'one panel'],
  [156, 161.5, 'HALO', '10.88 mA', '≈ 20.2 h'],
  [161.5, 168, 'HALT', '15 µA', '≈ 1.7 years'],
];

function drawHud(g, t) {
  const sec = TL.sections.find(s => t >= s.t0 && t < s.t1);
  if (sec && sec.name !== 'PROLOGVS' && sec.name !== 'FINIS') {
    const a = window_(t, sec.t0 + 0.3, sec.t1, 0.8, 0.5);
    const big = window_(t, sec.t0 + 0.2, sec.t0 + 3.6, 0.6, 1.0);
    label(g, 80, 92, sec.name, (0.5 + 0.45 * big) * a, {font: FONT.latin, size: 30, spacing: '8px'});
    label(g, 82, 124, sec.sub, 0.55 * a, {size: 18, color: COL.gold});
  }
  const m = MODES.find(x => t >= x[0] && t < x[1]);
  if (m) {
    const a = window_(t, m[0] + 0.5, m[1], 0.6, 0.4);
    label(g, W - 80, 92, `${m[2]}`, 0.6 * a, {size: 18, align: 'right', color: COL.gold, spacing: '3px'});
    label(g, W - 80, 122, `I = ${m[3]}   ${m[4]}`, 0.55 * a, {size: 18, align: 'right'});
    // tiny current trace, like the power-profile captures in the manual
    g.strokeStyle = `rgba(217,164,65,${0.45 * a})`; g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const x = W - 80 - 240 + i * 2;
      let v = m[2] === 'SPARKLE' ? (hash(Math.floor(t * 60) * 131 + i) < 0.07 ? 1 : 0.1) : m[2] === 'HALT' ? 0.02 :
        0.6 + 0.08 * (hash(Math.floor(t * 30) * 977 + i) - 0.5);
      if (m[2] === 'DYNAMIC') v = 0.62 + 0.05 * (hash(i + Math.floor(t * 30) * 55) - 0.5);
      const y = 150 - v * 18;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}

function logicAnalyzer(g, t) {
  const a = window_(t, 78.2, 90.2, 0.6, 0.5);
  if (a <= 0) return;
  const x0 = 1370, x1 = 1850, y0 = 300, dy = 42;
  const span = t < 84 ? 1.5 : lerp(1.5, 0.02, smooth((t - 84) / 1.5));
  label(g, x0, y0 - 40, span > 0.1 ? `CPX lines · ${span.toFixed(1)} s/div` : `CPX lines · ${(span * 1000).toFixed(0)} ms window · > 1 kHz`, 0.7 * a, {size: 17, color: COL.gold});
  const stateAt = (tt) => {
    if (span < 0.3) {
      // audio mode: one LED per ADC conversion; show the true ~kHz switching
      const k = Math.floor(tt * 1200);
      return Math.floor(hash(k * 3 + 17) * 90);
    }
    const i = lowerBound(TL.ostinato, tt + 1e-9) - 1;
    return i >= 0 ? TL.ostinato[i].led : 0;
  };
  for (let c = 0; c < 10; c++) {
    const yc = y0 + c * dy;
    label(g, x0 - 16, yc + 6, `CPX-${c}`, 0.6 * a, {size: 15, align: 'right'});
    g.lineWidth = 1.5;
    let prevY = null;
    g.beginPath();
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const tt = t - span + span * i / N;
      const l = LED[stateAt(tt)];
      const hi = l.A === `CPX-${c}`, lo = l.K === `CPX-${c}`;
      const y = hi ? yc - 12 : lo ? yc + 12 : yc;
      const x = lerp(x0, x1, i / N);
      if (prevY === null) g.moveTo(x, y); else { if (y !== prevY) g.lineTo(x, prevY); g.lineTo(x, y); }
      prevY = y;
    }
    g.strokeStyle = `rgba(255,90,50,${0.8 * a})`;
    g.stroke();
  }
  label(g, x0, y0 + 10 * dy + 12, 'HIGH = anode   LOW = cathode   ─ = Hi-Z', 0.45 * a, {size: 14});
}

function vignette(g, amt = 1, band = 0.55) {
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.75 * amt})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const lg = g.createLinearGradient(0, H * 0.72, 0, H);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.45, `rgba(0,0,0,${band * 0.8})`); lg.addColorStop(1, `rgba(0,0,0,${band})`);
  g.fillStyle = lg; g.fillRect(0, H * 0.72, W, H * 0.28);
}

function grain(g, frame) {
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.05;
  const img = GRAIN[frame % 4];
  const ox = -Math.floor(hash(frame) * 512), oy = -Math.floor(hash(frame + 7) * 512);
  for (let x = ox; x < W; x += 512) for (let y = oy; y < H; y += 512) g.drawImage(img, x, y);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- the panel / field
function hexLattice(n) {
  // 35-up panel from the manual: 5 rows of 7, alternate rows offset
  const out = [];
  const px = 26.5, py = 23.2;
  for (let r = -n; r <= n; r++) for (let c = -n * 2; c <= n * 2; c++) {
    out.push({x: c * px + (Math.abs(r) % 2 ? px / 2 : 0), y: r * py, r, c});
  }
  return out;
}
const LATTICE = hexLattice(22).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
const PANEL = LATTICE.filter(p => Math.abs(p.r) <= 2 && Math.abs(p.c) <= 3).slice(0, 35);
const FORKS = ['+13', '+1', '+7', 'rand()%15', 'breathe', 'adc', '±1', '+29', '+45', '0b…'];

function forkLevels(kind, t, seed) {
  const L = new Float32Array(90);
  const ph = hash(seed) * 10;
  switch (kind) {
    case '+13': for (let i = 0; i < 90; i++) L[i] = 0.85; break;
    case '+1': case '±1': {
      const sp = kind === '+1' ? 30 : 22;
      let head = (t * sp + ph * 9) % 90;
      if (kind === '±1') { const q = (t * sp / 90 + ph) % 2; head = (q < 1 ? q : 2 - q) * 89; }
      for (let s = 0; s < 90; s++) { let d = (head - s + 90) % 90; L[fwOfSlot[s]] = Math.exp(-d / 6); }
      break;
    }
    case '+7': case '+29': case '+45': {
      const st = parseInt(kind.slice(1));
      const n = Math.floor(t * 24 + ph * 5);
      for (let k = 0; k < 14; k++) { const led = ((n - k) * st % 90 + 90) % 90; L[led] = Math.max(L[led], Math.exp(-k / 4)); }
      break;
    }
    case 'rand()%15': sparkleVisual(L, t + ph, t + ph - 1, 1, 0.08); break;
    case 'breathe': { const v = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 3 + ph)); L.fill(v); break; }
    case 'adc': audioMode(L, t, 1.2); break;
    case '0b…': { const n = Math.floor(t * 8 + ph * 100); for (let b = 0; b < 90; b++) L[fwOfSlot[b]] = (n >> (b % 12)) & 1 ? 0.8 : 0.03; break; }
  }
  return L;
}

function drawPanel(g, bloom, t, amount) {
  const zoom = T.zoom(t);
  const cam0 = makeCam({zoom, cx: W / 2, cy: T.cy(t), tilt: 0, spin: 0, flip: 0, roll: 0, sway: 0, D: 1e6, fx: 0, fy: 0});
  const inPanel = t < 144;
  const list = inPanel ? PANEL : LATTICE;
  const fieldIn = smooth((t - 143.5) / 3);
  const blaze = t >= 150 ? Math.exp(-(t - 150) / 1.8) : 0;
  const keepHero = t > 153 ? smooth((155.7 - t) / 2.7) : 1;
  list.forEach((pos, i) => {
    if (i === 0) return;                                  // the hero board is drawn by the main pass
    const appear = inPanel ? smooth((t - 133.4 - i * 0.07) / 0.6) : (i < 35 ? 1 : fieldIn * smooth((t - 143.5 - Math.hypot(pos.x, pos.y) * 0.004) / 1.2));
    const a = amount * appear * keepHero * 0.8;
    if (a <= 0.01) return;
    const c = cam0(pos.x, pos.y);
    const R = 13 * zoom;
    if (c[0] < -R || c[0] > W + R || c[1] < -R || c[1] > H + R) return;
    const kind = t < 138 ? '+13' : FORKS[i % FORKS.length];
    if (R > 60) {
      const cam = makeCam({zoom, cx: c[0], cy: c[1], tilt: 0, spin: 0, flip: 0, roll: 0, sway: 0, D: 1e6, fx: 0, fy: 0});
      const lv = forkLevels(t < 138 ? '+13' : kind, t, i);
      if (t < 138) for (let k = 0; k < 90; k++) lv[k] = 0.85 * (0.75 + 0.25 * Math.sin(k * 0.7 + t * 9 + i));
      drawBoardBody(g, cam, 0.9 * a, t, lv, false);
      if (R > 150) drawTraces(g, cam, t, 0.9 * a, 'dim');
      drawPads(g, cam, 0.8 * a, t, null, false);
      drawComponents(g, cam, 0.9 * a, t);
      drawLedBodies(g, cam, a, lv);
      drawLedGlows(g, bloom, cam, lv, 1, a);
      if (t >= 138 && t < 144 && i < 35) label(g, c[0], c[1] + R + 26, kind, 0.8 * a * smooth((t - 138.3 - i * 0.03) / 0.5), {size: 17, align: 'center', color: COL.gold});
    } else {
      g.globalCompositeOperation = 'lighter';
      const flick = 0.55 + 0.35 * Math.sin(t * 3 + i * 1.7) + blaze * 1.5;
      g.globalAlpha = clamp(a * flick * (0.4 + 0.6 * clamp(R / 40)));
      g.drawImage(RINGSPR, c[0] - R * 1.4, c[1] - R * 1.4, R * 2.8, R * 2.8);
      bloom.globalCompositeOperation = 'lighter';
      bloom.globalAlpha = clamp(a * flick * 0.6);
      bloom.drawImage(RINGSPR, (c[0] - R * 1.4) / 4, (c[1] - R * 1.4) / 4, R * 0.7, R * 0.7);
      g.globalAlpha = 1; bloom.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  });
}

// ---------------------------------------------------------------- frame
const canvas = createCanvas(W, H);
const g = canvas.getContext('2d');
const bloomC = createCanvas(W / 4, H / 4), bloom = bloomC.getContext('2d');
const blurC = createCanvas(W / 4, H / 4), blurG = blurC.getContext('2d');

function drawFrame(t, frame) {
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = rgba(COL.bg); g.fillRect(0, 0, W, H);
  bloom.clearRect(0, 0, W / 4, H / 4);
  const cam = camAt(t);
  const levels = ledLevels(t);
  const flipped = ((cam.o.flip % 360) + 360) % 360;
  const back = flipped > 90 && flipped < 270;

  // stars: the ringworld sky, the sparkle cosmos, the field
  const starAmt = window_(t, 4.5, 30, 2.5, 0.8) * 0.9 + window_(t, 102, 126.5, 1.5, 0.6) * 0.55 + window_(t, 143, 156, 2, 1) * 0.3;
  drawStars(g, t, cam, starAmt);

  const panelAmt = T.panel(t);
  if (panelAmt > 0) drawPanel(g, bloom, t, panelAmt);

  const bv = T.boardVis(t);
  const ex = T.explode(t);
  if (back) {
    drawBack(g, cam, Math.max(bv, 0.8), t);
  } else if (ex > 0.001) {
    // exploded stack: the four copper layers, lifted apart
    const zs = [3.2 * ex, 1.1 * ex, -1.1 * ex, -3.2 * ex];
    for (let li = 3; li >= 0; li--) {
      poly(g, cam, OUTLINE, zs[li]);
      g.fillStyle = `rgba(16,13,16,${0.55 + 0.2 * (3 - li) / 3})`; g.fill();
      g.strokeStyle = `rgba(217,164,65,${0.4 * ex})`; g.lineWidth = 1; g.stroke();
    }
    drawTraces(g, cam, t, 0.95, 'layers', zs);
    const names = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
    zs.forEach((z, li) => {
      const p = cam(13.5, 0, z);
      label(g, p[0] + 24, p[1] + 6, names[li], ex * window_(t, 127, 133, 1, 0.6), {size: 20, color: COL.gold});
    });
  } else {
    drawBoardBody(g, cam, bv, t, levels, false);
    const traceMode = t >= 78 && t < 90.3 ? 'nets' : 'dim';
    const trA = traceMode === 'nets' ? window_(t, 78, 90.3, 0.6, 0.5) : bv * 0.9;
    drawTraces(g, cam, t, trA, traceMode);
    if (t < 30 && bv < 0.01) drawPads(g, cam, 0.3, t, levels, false, true);
    else drawPads(g, cam, bv, t, levels, false);
    drawComponents(g, cam, bv, t);
    const heart = t >= 90 && t < 97 ? window_(t, 91.2, 96.8, 0.8, 0.6) : 0;
    drawSilk(g, cam, bv * 0.7, heart);
    drawLedBodies(g, cam, Math.max(bv, t < 30 ? 0.35 : 0.2), levels);
    drawHook(g, cam, T.hookVis(t) * bv);
  }

  drawChords(g, cam, t);
  if (!back && ex < 0.5) drawLedGlows(g, bloom, cam, levels, t < 30 ? 1.2 : 1);
  sparkleStars(g, bloom, cam, t);

  // bloom pass
  blurG.clearRect(0, 0, W / 4, H / 4);
  blurG.filter = 'blur(6px)';
  blurG.drawImage(bloomC, 0, 0);
  blurG.filter = 'none';
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.9;
  g.drawImage(blurC, 0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // scene annotations
  sceneOverlays(g, cam, t, levels);
  vignette(g, 1, 0.55 + 0.33 * window_(t, 133.5, 156, 1, 1));
  drawHud(g, t);
  drawLyrics(g, t);
  grain(g, frame);

  // dips to black
  const dip = Math.max(window_(t, -1, 0.35, 0.01, 0.35) * 0 , 0);
  let black = 1 - smooth(t / 0.3);
  if (t > 176.5) black = 1;
  if (t >= 101.25 && t < 102) black = Math.max(black, smooth((t - 101.25) / 0.25) * smooth((102.2 - t) / 0.2));
  if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, H); }
  return canvas;
}

function sceneOverlays(g, cam, t, levels) {
  // prologue: press & hold
  if (t < 2.4) {
    const a = window_(t, 0.1, 2.2, 0.3, 0.5);
    const s = cam(PART.S1.p[0], PART.S1.p[1]);
    label(g, W / 2, 930, 'press and hold', 0.7 * a, {size: 22, align: 'center', color: COL.gold, spacing: '4px'});
    if (t > 0.5 && t < 1.8) {
      const u = clamp((t - 0.5) / 1.18);
      g.strokeStyle = `rgba(217,164,65,${0.9 * a})`; g.lineWidth = 2;
      g.beginPath(); g.arc(s[0], s[1], 26, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); g.stroke();
    }
  }
  // title
  const ta = window_(t, 2.4, 5.9, 0.9, 0.9);
  if (ta > 0) {
    label(g, W / 2, 470, 'NONAGINTA', ta, {font: FONT.latin, size: 118, align: 'center', spacing: '34px'});
    label(g, W / 2, 540, 'a canticle for ninety lights', 0.8 * ta, {font: `italic ${FONT.ital}`, size: 32, align: 'center'});
    label(g, W / 2, 610, 'HALO-90', 0.7 * ta, {size: 22, align: 'center', color: COL.gold, spacing: '8px'});
  }
  // HALO: protractor + live firmware variable
  drawDial(g, cam, t, window_(t, 30.5, 54, 1.2, 0.8) * 0.9);
  if (t >= 42 && t < 54.2) {
    const i = lowerBound(HALO_SYL, t + 1e-9) - 1;
    const cur = HALO_SYL[Math.max(0, i)].led, prev = HALO_SYL[Math.max(0, i - 1)].led;
    const a = window_(t, 42.3, 54, 0.5, 0.3);
    label(g, W / 2, 105, `prevLed = ${String(prev).padStart(2)}   →   setLed(${String(cur).padStart(2)})   ·   ${LED[cur].ref}`, 0.8 * a, {size: 24, align: 'center', color: COL.gold});
  }
  if (t >= 54 && t < 60.2) {
    const n = Math.floor((t - 54) / TL.beat);
    let led = SCAN_START; for (let i = 0; i <= n; i++) led = (led + 13) % 90;
    const p = cam(LED[led].p[0], LED[led].p[1]);
    const a = window_(t, 54.3, 60, 0.4, 0.3);
    const c0 = cam(0, 0);
    const outx = lerp(p[0], c0[0], 0.38), outy = lerp(p[1], c0[1], 0.38);
    g.strokeStyle = rgba(COL.gold, 0.7 * a); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(lerp(p[0], c0[0], 0.06), lerp(p[1], c0[1], 0.06)); g.lineTo(outx, outy); g.stroke();
    label(g, outx, outy + (outy > c0[1] ? -14 : 28), `${LED[led].ref} — the only one on`, a, {size: 21, align: 'center', color: COL.gold});
    label(g, W / 2, 105, 'actual state of the ring at any instant', 0.6 * a, {size: 20, align: 'center'});
  }
  if (t >= 60 && t < 63.5) {
    const a = window_(t, 60.2, 63.5, 0.3, 0.4);
    const r = ACC_R0 * Math.exp(ACC_K * (t - ACC_T0));
    label(g, W / 2, 105, `scan rate ${r < 1000 ? r.toFixed(0) : (r / 1000).toFixed(1) + 'k'} LED/s`, 0.75 * a, {size: 24, align: 'center', color: COL.gold});
  }
  // reveal: it is an earring, 24 mm across
  const ra = t < 66 ? window_(t, 64.4, 66.0, 0.8, 0.25) : 0;
  if (ra > 0) {
    const l = cam(-12, 14.5), r = cam(12, 14.5);
    g.strokeStyle = rgba(COL.bone, 0.6 * ra); g.lineWidth = 1;
    g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(r[0], r[1]);
    g.moveTo(l[0], l[1] - 8); g.lineTo(l[0], l[1] + 8); g.moveTo(r[0], r[1] - 8); g.lineTo(r[0], r[1] + 8); g.stroke();
    label(g, (l[0] + r[0]) / 2, l[1] + 34, 'Ø 24 mm  ·  5.2 g', 0.85 * ra, {size: 22, align: 'center'});
  }
  // DYNAMICA callouts
  if (t >= 66 && t < 72.6 && PART.MK1) {
    const p = cam(PART.MK1.p[0], PART.MK1.p[1]);
    callout(g, p, [p[0] + 330, p[1] - 150], ['MK1 · SPW2430 MEMS microphone', 'every ADC sample picks an LED'], window_(t, 66.3, 72.5, 0.3, 0.4), 66.3, t);
  }
  if (t >= 72 && t < 78.4) {
    const p = cam(9.2, 6.2);
    callout(g, p, [p[0] + 200, p[1] + 60], ['setLed((4140 + rc + adc) % 90)', 'the waveform, wrapped round the ring'], window_(t, 72.3, 78.2, 0.3, 0.4), 72.3, t);
  }
  logicAnalyzer(g, t);
  if (t >= 91 && t < 96.6 && PART.U1) {
    const p = cam(PART.U1.p[0], PART.U1.p[1] + 2.4);
    callout(g, p, [p[0] + 420, p[1] - 330], ['U1 · STM8L151G4', '8-bit · 16 MHz · 16 KB flash · ♥ on the silkscreen'], window_(t, 91.8, 96.4, 0.3, 0.3), 91.8, t);
  }
  // SCINTILLA: battery life
  if (t >= 114 && t < 119) {
    const a = window_(t, 114.2, 118.8, 0.5, 0.4);
    const h = 109.5 * EASE.o(clamp((t - 114.3) / 3));
    const c = cam(0, 0.3), R = cam.o.zoom * 12.5;
    g.strokeStyle = `rgba(217,164,65,${0.8 * a})`; g.lineWidth = 3;
    g.beginPath(); g.arc(c[0], c[1], R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * h / 109.5); g.stroke();
    label(g, c[0] + R + 60, c[1] - 30, `${h.toFixed(1)} h`, a, {font: FONT.latin, size: 64, spacing: '4px'});
    const rows = [['DYNAMIC', '11.71 mA', '18.8 h'], ['HALO', '10.88 mA', '20.2 h'], ['SPARKLE', '2.01 mA', '109.5 h']];
    rows.forEach((r, i) => label(g, c[0] + R + 62, c[1] + 22 + i * 30, `${r[0].padEnd(8)} ${r[1].padStart(9)}  ${r[2].padStart(8)}`, 0.7 * a * smooth((t - 114.8 - i * 0.25) / 0.4), {size: 18, color: i === 2 ? COL.gold : COL.bone}));
  }
  // APERTVM: licences on the layers, the fork edit
  if (t >= 127 && t < 133) {
    const a = window_(t, 127.5, 132.8, 0.6, 0.5);
    ['hardware   CERN-OHL-S 2.0', 'firmware   GNU GPL 3.0', 'docs       CC BY-SA 4.0'].forEach((s, i) =>
      label(g, 120, 470 + i * 38, typed(s, t - 127.8 - i * 0.35), a, {size: 23, color: i ? COL.bone : COL.gold}));
  }
  if (t >= 138.3 && t < 144.2) {
    const a = window_(t, 138.4, 144, 0.4, 0.4);
    const nums = ['13', '7', '29', '1', '45'];
    const k = Math.floor((t - 138.4) / 1.1) % nums.length;
    const within = ((t - 138.4) % 1.1) / 1.1;
    let n = nums[k];
    if (within > 0.75) n = n.slice(0, Math.max(0, Math.floor((1 - (within - 0.75) / 0.25) * n.length)));
    label(g, W / 2, 105, `setLed((prevLed + ${n}${within > 0.75 && Math.floor(t * 6) % 2 ? '▌' : ''}) % 90);`, a, {size: 26, align: 'center', color: COL.gold});
  }
  // DORMITIO: hold the button
  if (t >= 160.6 && t < 163.5) {
    const s = cam(PART.S1.p[0], PART.S1.p[1]);
    const a = window_(t, 160.7, 163.3, 0.2, 0.6);
    const u = clamp((t - 161.0) / 0.5);
    g.strokeStyle = `rgba(217,164,65,${a})`; g.lineWidth = 2.5;
    g.beginPath(); g.arc(s[0], s[1], 30, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); g.stroke();
    label(g, s[0] - 46, s[1] + 8, u < 1 ? `${Math.round(u * 500)} ms` : 'HALT', a, {size: 20, align: 'right', color: COL.gold});
  }
  // FINIS
  const fa = window_(t, 168.4, 176.5, 1.2, 0.01);
  if (fa > 0) {
    label(g, W / 2, 500, 'HALO-90', fa, {font: FONT.latin, size: 128, align: 'center', spacing: '30px'});
    label(g, W / 2, 575, 'Ninety lights. One at a time.', 0.85 * fa * smooth((t - 169.2) / 1), {font: `italic ${FONT.ital}`, size: 36, align: 'center'});
    const b = fa * smooth((t - 170.2) / 1);
    label(g, W / 2, 800, 'open hardware  ·  CERN-OHL-S 2.0  ·  GPL-3.0  ·  CC BY-SA 4.0', 0.6 * b, {size: 19, align: 'center'});
    label(g, W / 2, 836, 'github.com/openKolibri/halo-90      openkolibri.com/hlo/90', 0.85 * b, {size: 21, align: 'center', color: COL.gold});
    label(g, W / 2, 1010, 'every note and every light in this film was generated from the HALO-90 repository', 0.55 * fa * smooth((t - 171) / 1.5), {size: 16, align: 'center'});
  }
}

// ---------------------------------------------------------------- main
function frameJpeg(t, f) { drawFrame(t, f); return canvas.encodeSync('jpeg', 97); }

async function renderRange(f0, f1, out) {
  // JPEG frames over image2pipe: self-delimiting, so partial pipe reads can't tear a frame
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg',
    '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-tune', 'film', out], {stdio: ['pipe', 'inherit', 'inherit']});
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    const buf = frameJpeg(f / FPS, f);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 150 === 0) process.stderr.write(`[${f0}-${f1}] frame ${f} ${((Date.now() - t0) / Math.max(1, f - f0 + 1)).toFixed(0)} ms/f\n`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === '--still') {
    const t = parseFloat(a[1]);
    drawFrame(t, Math.round(t * FPS));
    fs.writeFileSync(a[2] || 'still.png', canvas.toBuffer('image/png'));
  } else if (a[0] === '--stills') {
    const dir = a[1];
    fs.mkdirSync(dir, {recursive: true});
    for (const t of a.slice(2).map(parseFloat)) {
      drawFrame(t, Math.round(t * FPS));
      fs.writeFileSync(path.join(dir, `t${t.toFixed(2).padStart(7, '0')}.jpg`), canvas.toBuffer('image/jpeg', 85));
    }
  } else if (a[0] === '--range') {
    renderRange(parseInt(a[1]), parseInt(a[2]), a[3]);
  }
}
module.exports = {drawFrame, W, H, FPS};
