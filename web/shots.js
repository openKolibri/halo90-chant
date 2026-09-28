// One continuous camera move through the whole film, placed on the music.
// Keys are in world mm: v = [camX, camY, camZ, targetX, targetY, targetZ, fov, upX, upY, upZ].
// Scene envelopes (lights, effects) and the hand-placed case choreography use the same timeline.
import {env, spline, clamp, smooth, lerp} from './timeline.js';

export const FIELD = {pitch: 26.5, rings: 40, fill: 34};   // hex field: board pitch, rings built, rings on screen at the blaze

export function makeShots(tl, leds, casePose) {
  const sec = tl.sec;
  const lines = k => tl.linesIn(k);
  const intro = lines('introit'), halo = lines('halo'), dyn = lines('dynamic'), spk = lines('sparkle'), open = lines('open');
  const K = [];
  const UP = [0, 1, 0], FLOOR = [0, 0, 1];          // FLOOR: grazing shots, the board is the ground
  const key = (t, cam, tgt, fov = 30, stop = false, up = UP) => K.push({t, v: [...cam, ...tgt, fov, ...up], stop});
  const polar = (deg, r, z) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r, z];

  // PROLOGVS: face-on, the boot sweep; then a slow descent to the board's edge
  const LED_DEG = -94 + 4 * leds.INTRO_SLOT;          // where the opening's lone light sits on the ring
  key(0, [0, 0, 74], [0, 0, 0.5], 30, true);
  key(tl.M('release', 1.7) + 1, [0, -0.5, 68], [0, 0, 0.5], 30);
  key(sec.introit.t0, polar(LED_DEG + 180, 24, 12), polar(LED_DEG, 3, 1.2), 38, false, [0, 0.45, 0.9]);

  // I · INTROITVS: grazing macro across the board to the lone light on the far rim. The line of sight
  // passes beside the MCU and over the passives, never through the mic or the button (checked per frame).
  const lb = leds.lineB;
  key(intro[0].t0 + 3.5, polar(LED_DEG + 180, 18.5, 4.2), polar(LED_DEG, 6, 1.2), 40, false, FLOOR);
  key(lb.t0 - 0.4, polar(LED_DEG + 180, 17.2, 3.8), polar(LED_DEG, 8, 1.3), 40, false, FLOOR);
  // then orbit opposite the travelling light, once around, a step per syllable
  const n = lb.syls.length;
  lb.syls.forEach((s, i) => {
    const prog = i / n;
    key(s.t0 + 0.2, polar(LED_DEG + 180 + 360 * prog, 19, 4.8 + 1.2 * Math.sin(prog * Math.PI) + 3.5 * prog * prog), polar(LED_DEG + 360 * prog, 10, 1.3), 40, false, FLOOR);
  });
  key(lb.t1 - 0.2, polar(LED_DEG + 180 + 360, 20, 9.5), polar(LED_DEG, 4, 1.2), 40, false, [0, 0.3, 0.95]);
  // rise out of the landscape and land face-on on the HALO downbeat
  key(sec.halo.t0, [0, -2, 76], [0, 0, 0.5], 30);

  // II · HALO: slow orbit around the +13 star, in on "una sola", out on "omnes lucent"
  key(halo[1].t0, [7, 2, 71], [0, 0, 0.5], 30);
  key(halo[2].t0, [11, 3, 67], [0, 0.5, 0.5], 30);
  key(leds.refrain.t0, [-7, 1, 62], [0, 0, 0.5], 30);
  key(leds.accT0, [-2, 0, 50], [0, 0, 0.5], 30);
  key(leds.accT1, [10, 10, 96], [0, 6, 0], 30);
  key(sec.dynamic.t0, [16, 15, 114], [0, 8, 0], 30);

  // III · DYNAMICA
  key(dyn[1].t0, [-26, 12, 104], [0, 7, 0], 30);
  key(dyn[2].t0, [-13, 5, 78], [-6, 3, 0], 30);
  key(dyn[3].t1, [-14, 2, 74], [-6, 2, 0], 30);
  key(dyn[4].t0 + 1.8, [7, -6, 18], [0, 0, 1.2], 34);
  key(dyn[4].t1 - 0.3, [5, -4, 15], [0, 0, 1.2], 34);
  key(sec.sparkle.t0, [2, 8, 104], [0, 6, 0], 30);

  // IV · SCINTILLA
  const coinLine = spk[1], hoursLine = spk[2];
  key(coinLine.t0 - 0.8, [20, 6, 94], [0, 5, 0], 30);
  key(coinLine.t0 + 0.6, [66, 5, 30], [0, 0, -1], 30);
  key(coinLine.t0 + 1.6, [54, 3, -46], [0, 0, -2], 30);
  key(coinLine.t0 + 2.6, [6, 1, -76], [0, 0, -2.5], 30);
  key(hoursLine.t1 - 0.8, [-2, 0, -62], [0, 0, -2.5], 30);
  key(hoursLine.t1 + 0.4, [-56, 4, -18], [0, 0, -1], 30);
  key(hoursLine.t1 + 1.6, [-42, 5, 54], [0, 2, 0], 30);
  key(sec.sparkle.t1 - 3.5, [0, 4, 86], [0, 3, 0], 30);
  key(sec.open.t0, [0, 2, 60], [0, 1, 0.5], 30);

  // V · APERTVM: exploded layers; then the hex field grows ring by ring on the beat, faster and faster,
  // and the camera pulls back just ahead of it until it fills the frame on the D-major blaze
  key(open[0].t0 + 2, [58, 40, 64], [0, 0, 0], 32);
  const fieldStart = tl.beatAfter(open[1].t0 - 0.01);
  key(Math.min(open[0].t1 + 0.5, fieldStart - 1.0), [44, 34, 80], [0, 0, 0], 32);   // ahead of the field's first key
  const tBlaze = open[3].t0 + (open[3].t1 - open[3].t0) * 0.5;
  const fieldBeats = tl.beats.filter(b => b >= fieldStart - 1e-6);
  const nFill = Math.max(1, fieldBeats.filter(b => b <= tBlaze + 1e-6).length - 1);
  const accel = (FIELD.fill - nFill) / (nFill * nFill);
  const ringsAtBeat = i => Math.floor(i + 1 + accel * i * i);       // rings shown after beat i (0-based)
  const ringTime = new Array(FIELD.rings + 1).fill(Infinity);
  for (let i = 0; i < fieldBeats.length; i++) {
    const r = Math.min(FIELD.rings, ringsAtBeat(i));
    for (let k = 1; k <= r; k++) if (ringTime[k] === Infinity) ringTime[k] = fieldBeats[i];
  }
  const ringsAt = t => { let r = 0; for (let k = 1; k <= FIELD.rings; k++) if (ringTime[k] <= t) r = k; return r; };
  for (let i = 0; i <= nFill; i += 2) {
    const tb = fieldBeats[i], r = ringsAtBeat(i);
    key(tb + 0.3, [0, 0, Math.max(150, 44 * (r + 1.2))], [0, 0, 0], 30);
  }
  key(tBlaze + 0.5, [0, 0, 44 * (FIELD.fill + 1.2)], [0, 0, 0], 30);
  key(sec.open.t1 - 3.0, [0, -6, 44 * (FIELD.fill + 0.4)], [0, -2, 0], 30);
  key(sec.open.t1, [0, 6, 112], [0, 6, 0], 30);

  // VI · DORMITIO: tilt down to the open case; the spare cell goes into the right pocket, then the hero is
  // laid on it; held 500 ms to HALT; the lid comes down and the magnets seat it on "Amen".
  const z = sec.sleep, MK = tl.marks;
  const halt = tl.M('halt', z.t0 + 4.4), lid = tl.M('lid', halt + 1.5), hold = tl.M('hold', halt - 0.5);
  const carryT = tl.M('carry', z.t0 + 0.8), cellT = tl.M('cell', carryT + 0.6), placeT = tl.M('place', cellT + 1.6);
  const P = casePose.rest;                             // the hero at rest in its pocket (world)
  key(carryT - 0.4, [4, 2, 118], [2, -10, 0], 30);
  key(cellT - 0.5, [8, -28, 118], [4, -58, 0], 30);
  key(cellT + 0.6, [12, -24, 98], [8, -62, 0], 30);
  key(placeT + 0.3, [P.x + 22, P.y + 46, 56], [P.x, P.y, 0], 32);
  key(halt, [P.x + 18, P.y + 36, 42], [P.x, P.y + 1, 0], 32);
  key(lid + 0.6, [P.x + 30, P.y + 62, 100], [0, P.y, 0], 32);
  key(z.t1, [60, P.y + 70, 108], [0, P.y - 2, 0], 32);
  // FINIS: rise above the closed case
  key(sec.finis.t0 + 4, [0, P.y + 110, 84], [0, P.y - 4, 0], 32);
  key(tl.duration, [0, P.y + 118, 70], [0, P.y - 4, 0], 32, true);

  const cam = spline(K);

  // ---- the case, placed by eye (base-local mm; the base's rim is at y = 10) -----------------------------
  const LAND = casePose.land;
  const carry = t => smoother01((t - carryT) / (placeT - carryT));         // hanging -> just above its cell
  const drop = t => {                                                          // let go -> resting on the cell
    const u = clamp((t - placeT) / LAND.place);
    return {fall: 1 - u * u, settle: t > placeT + LAND.place ? 0.35 * Math.exp(-(t - placeT - LAND.place) / 0.05) * Math.sin((t - placeT - LAND.place) * 70) : 0};
  };
  const stopper = t => 1 - smooth((t - carryT) / 0.8);                         // the earwire's silicone stopper fades
  const cell = t => {                                                          // the spare cell, by hand, then let go
    const X = casePose.pocketX, rest = casePose.cellRestY;
    if (t < cellT - 1.0) return null;
    if (t < cellT) {
      const u = smoother01((t - (cellT - 1.0)) / 1.0);
      return {p: [lerp(X + 3, X + 0.4, u), lerp(rest + 40, rest + 3, u), lerp(-6, 0.3, u)], tilt: lerp(0.3, 0.06, u)};
    }
    const u = clamp((t - cellT) / LAND.cell);
    const after = t - cellT - LAND.cell;
    const bounce = after > 0 ? 0.25 * Math.exp(-after / 0.05) * Math.abs(Math.sin(after * 60)) : 0;
    return {p: [lerp(X + 0.4, X, u), lerp(rest + 3, rest, u * u) + bounce, lerp(0.3, 0, u)], tilt: 0.06 * (1 - u)};
  };
  const lidPose = t => {                                                       // brought in, let go, snapped shut
    const a = Math.max(halt + 0.05, lid - 1.6), near = lid - 0.22;
    const hover = {p: [6, 44, -26], rx: -0.9, rz: 0.08}, hi = {p: [0, 14, 0], rx: 0.02, rz: 0};
    if (t < a) return hover;
    if (t < near) {
      const u = smoother01((t - a) / (near - a));
      return {p: hover.p.map((v, i) => lerp(v, hi.p[i], u)), rx: lerp(hover.rx, hi.rx, u), rz: lerp(hover.rz, hi.rz, u)};
    }
    const u = clamp((t - near) / (lid - near));
    const after = t - lid;
    const rebound = after > 0 ? 0.12 * Math.exp(-after / 0.04) * Math.abs(Math.sin(after * 80)) : 0;
    return {p: [0, lerp(14, 10, u * u) + rebound, 0], rx: 0.02 * (1 - u), rz: 0};
  };

  // ---- envelopes ---------------------------------------------------------------------------
  const acc1 = leds.accT1;
  const studio = env([[0, 0], [sec.introit.t0, 0.07], [sec.halo.t0, 0.05], [acc1 - 1.5, 0.05], [acc1 + 1.2, 1], [sec.sparkle.t0 - 0.3, 1], [sec.sparkle.t0 + 1, 0.28],
    [sec.sparkle.t1 - 1, 0.28], [sec.open.t0 + 0.5, 0.5], [open[0].t1, 0.85], [sec.sleep.t0, 0.85], [carryT + 0.6, 0.5], [hold - 0.4, 0.5], [halt, 0.6], [halt + 1.2, 0.3], [tl.duration, 0.25]]);
  const envLight = env([[0, 0.02], [acc1 - 1.5, 0.02], [acc1 + 1.2, 0.55], [sec.sparkle.t0 + 1, 0.2], [sec.open.t0, 0.5],
    [halt + 1.2, 0.18], [tl.duration, 0.18]]);
  const dial = t => clamp(smooth((t - sec.halo.t0 - 0.5) / 1.2) * smooth((leds.refrain.t0 + 0.4 - t) / 0.8));
  const chords = t => clamp(smooth((t - sec.halo.t0) / 0.3) * (t < leds.refrain.t0 ? 1 : Math.exp(-(t - leds.refrain.t0) / 0.25)));
  const nets = t => dyn.length > 3 ? clamp(smooth((t - dyn[2].t0) / 0.8) * smooth((dyn[3].t1 + 0.6 - t) / 0.6)) : 0;
  const heart = t => dyn.length > 4 ? clamp(smooth((t - dyn[4].t0 - 1.2) / 0.8) * smooth((dyn[4].t1 + 0.4 - t) / 0.6)) : 0;
  const explode = t => clamp(smooth((t - open[0].t0 - 0.2) / 2.2) * smooth((open[1].t0 + 1.2 - t) / 1.6));
  const fieldOn = t => clamp(smooth((t - fieldStart + 0.1) / 0.3) * smooth((sec.open.t1 - 0.3 - t) / 2.6));
  const forks = t => (t >= open[2].t0 && t < open[3].t0 ? 1 : 0);
  const blaze = t => (t >= tBlaze ? Math.exp(-(t - tBlaze) / 1.8) : 0);
  const stars = t => 0.9 * clamp(smooth((t - sec.introit.t0 + 1.5) / 2.5) * smooth((sec.halo.t0 + 0.5 - t) / 1.2))
    + 0.6 * clamp(smooth((t - sec.sparkle.t0) / 1.5) * smooth((sec.open.t0 + 0.5 - t) / 0.8))
    + 0.45 * clamp(smooth((t - open[3].t0) / 2) * smooth((sec.open.t1 - t) / 1));
  const motes = t => clamp(smooth((t - sec.sparkle.t0) / 1) * smooth((sec.open.t0 + 1 - t) / 2.5));
  const dimLine = t => clamp(smooth((t - acc1 + 0.8) / 0.6) * smooth((sec.dynamic.t0 + 3.5 - t) / 0.6));
  const gauge = t => spk.length > 2 ? clamp(smooth((t - hoursLine.t0 - 0.2) / 0.5) * smooth((hoursLine.t1 + 0.3 - t) / 0.4)) : 0;
  const swing = env([[0, 0.12], [sec.introit.t0, 0.02], [sec.halo.t0, 0.06], [acc1, 0.25], [sec.dynamic.t0 + 1, 1],
    [sec.sparkle.t0, 0.35], [sec.open.t0, 0.5], [open[1].t0, 0], [sec.open.t1, 0], [sec.open.t1 + 0.5, 0.15], [carryT, 0]]);
  // key light direction (offset from the target): a raking side light once the earring lies face-up
  const kx = env([[0, 50], [z.t0 + 0.5, 50], [z.t0 + 2.5, 95]]), ky = env([[0, 70], [z.t0 + 0.5, 70], [z.t0 + 2.5, 22]]),
    kz = env([[0, 90], [z.t0 + 0.5, 90], [z.t0 + 2.5, -55]]);
  const keyDir = t => [kx(t), ky(t), kz(t)];
  const caseVis = t => t > z.t0 - 1;
  const bloom = env([[0, 0.6], [sec.introit.t0, 0.75], [sec.halo.t0, 0.6], [sec.sparkle.t0, 0.7], [sec.open.t0, 0.6], [tl.duration, 0.6]]);
  const aperture = t => {
    const macro = win1(t, sec.introit.t0 - 0.5, lb.t1 + 1, 1, 1) + win1(t, dyn[4].t0 + 1.2, dyn[4].t1, 0.8, 0.8);
    return 0.0002 + 0.0016 * macro;
  };
  const black = t => clamp(1 - smooth(t / 0.4)) + clamp(smooth((t - (tl.duration - 0.6)) / 0.55));
  return {cam, studio, envLight, dial, chords, nets, heart, explode, fieldOn, forks, blaze, ringTime, ringsAt, fieldStart,
    stars, motes, dimLine, gauge, swing, carry, drop, stopper, cell, lidPose, caseVis, keyDir, bloom, aperture,
    black, keys: K, introSeen: t => t >= tl.M('release', 1.7) + 0.4 && t < sec.halo.t0};
}

function smoother01(u) { u = Math.max(0, Math.min(1, u)); return u * u * u * (u * (u * 6 - 15) + 10); }
function win1(t, a, b, fi, fo) { return Math.max(0, Math.min(1, (t - a) / fi)) * Math.max(0, Math.min(1, (b - t) / fo)); }
