// Perceived brightness of the 90 LEDs at time t. The hardware lights one LED at a time; the eye
// integrates. Every pattern is the firmware's, placed on the timeline (sections, lines, marks).
// Index = physical slot around the ring (4 degrees apart, slot 0 at the bottom); firmware index i is
// slot i + 1 (D(i+1)). The Halo scan jumps JUMP = 13 positions round the ring (52 degrees), as the firmware's
// setLed((prevLed + 13) % 90); 13 and 90 are coprime, so 90 steps visit every LED exactly once. The refrain's scan and the audio mode are simulated as the device
// runs them: what the eye sees is each LED's share of its ~50 ms (duty), perceived as duty^0.3.
import {clamp, hash, lowerBound, smooth} from './timeline.js';

export const JUMP = 13;

export function makeLeds(tl, board) {
  const leds = board.leds;                          // sorted by physical slot (see film.js)
  const slotOf = leds.map(l => Math.round((((94 - l.ang) % 360) + 360) % 360 / 4) % 90);
  const fwOfSlot = [];
  slotOf.forEach((s, i) => { fwOfSlot[s] = i; });
  // the lone light of the opening: on the right of the ring, where the grazing camera sees it past the parts
  const INTRO_SLOT = 18;
  const introLed = fwOfSlot[INTRO_SLOT];

  const intro = tl.linesIn('introit');
  const lineA = intro[0], lineB = intro[1];
  const halo = tl.linesIn('halo');
  const refrain = halo[halo.length - 1];
  const S0 = k => tl.sec[k];
  const omnes = refrain.syls.find(s => s.word >= 3) || refrain.syls[Math.floor(refrain.syls.length / 2)];
  const EYE = 0.05, PERCEIVE = 0.3;                 // the eye's integration window; brightness = duty^0.3
  // the ring's even glow once scanned fast enough: 1/90 duty each, i.e. what allOn(1) looked like before
  const toLevels = p => {                            // perceived brightness -> film levels (film.js scales by 1/sqrt(total/6))
    let S = 0;
    for (let i = 0; i < 90; i++) S += p[i];
    const c = S > 6 ? S / 6 : 1;
    for (let i = 0; i < 90; i++) p[i] *= c;
    return p;
  };

  // Halo scan: one JUMP step per sung syllable, then one per bell
  // (the step times are merged and sorted first, then the LEDs assigned in time order, so every consecutive
  // step, and so every arc, is exactly +JUMP)
  const scan = [];
  {
    const times = [];
    for (const L of halo.slice(0, -1)) for (const s of L.syls) times.push(s.t0);
    for (const e of tl.events.bells) if (e.t < refrain.t0) times.push(e.t);
    times.sort((a, b) => a - b);
    let led = 0;
    for (const t of times) { scan.push({t, led}); led = (led + JUMP) % 90; }
  }
  const scanEnd = scan.length ? scan[scan.length - 1].led : 0;

  // The refrain: one JUMP step per beat; from "omnes" the step rate climbs exponentially to the device's
  // own Halo rate, the RTC wake-up every (2 + 1) / (38 kHz LSI / 2) = 158 us, i.e. 6.3 kHz: each LED 70
  // times a second, past flicker fusion, so the ring settles into the even glow of 1/90 duty.
  const accT0 = omnes.t0, accT1 = refrain.t1 - 0.8, KHZ = 38000 / 2 / 3;
  const beatLen = tl.beats.length > 1 ? tl.beats[1] - tl.beats[0] : 0.75;
  const accR0 = 1 / beatLen, accK = Math.log(KHZ / accR0) / Math.max(0.5, accT1 - accT0);
  const scanRate = t => t < accT0 ? accR0 : accR0 * Math.exp(accK * (Math.min(t, accT1) - accT0));
  const steps = [{t: refrain.t0 - 1, led: (scanEnd + JUMP) % 90}];
  {
    let led = steps[0].led;
    for (const b of tl.beats) if (b >= refrain.t0 - 1e-6 && b <= accT0 + 1e-6) { led = (led + JUMP) % 90; steps.push({t: b, led}); }
    const phiEnd = (KHZ - accR0) / accK;
    for (let n = 1; ; n++) {
      const t = n <= phiEnd ? accT0 + Math.log(1 + n * accK / accR0) / accK : accT1 + (n - phiEnd) / KHZ;
      if (t > S0('halo').t1 + 0.6) break;
      led = (led + JUMP) % 90; steps.push({t, led});
    }
  }
  const scanDuty = t => {                            // each LED's share of the eye's last 50 ms
    const p = new Float32Array(90), a = t - EYE;
    for (let i = Math.max(0, lowerBound(steps, a) - 1); i < steps.length && steps[i].t < t; i++) {
      const on = Math.max(a, steps[i].t), off = Math.min(t, i + 1 < steps.length ? steps[i + 1].t : t);
      if (off > on) p[steps[i].led] += (off - on) / EYE;
    }
    const even = Math.pow(1 / 90, PERCEIVE), k = smooth((t - accT1 + 0.4) / 1.0);   // a second, across reaching 6.3 kHz
    for (let i = 0; i < 90; i++) p[i] = (1 - k) * Math.pow(p[i], PERCEIVE) + k * even;
    return p;
  };

  // The audio mode: every ADC conversion lights LED (4140 + rotationCenter + adc) % 90 (4140 = 46 x 90).
  // build/timeline.json carries, per frame, how long each offset from the centre was lit (the real
  // soundtrack through the mic and ADC); rotationCenter++ every 40 ms (TIM2: 16 MHz / 2^7 / 5000).
  const RC_STEP = 0.04;
  const adcFrames = (tl.adc || []).map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
  const centerAt = (t, t0, c0 = 45) => ((c0 + Math.floor(Math.max(0, t - t0) / RC_STEP)) % 90 + 90) % 90;
  const audioDuty = (t, t0, c0 = 45) => {
    const p = new Float32Array(90), h = adcFrames[Math.min(adcFrames.length - 1, Math.max(0, Math.round(t * tl.fps)))];
    if (!h) return p;
    const rc = centerAt(t, t0, c0);
    for (let o = 0; o < 90; o++) p[(rc + o) % 90] = h[o] / 255;
    return p;
  };
  // the LED lit at one instant (for the CPX-line trace): the frame's waveform, 90 samples a frame
  const adcLed = tt => {
    const f = Math.floor(tt * tl.fps), w = tl.wave[f];
    const x = w ? w[Math.min(89, Math.floor((tt * tl.fps - f) * 90))] : 0;
    const n = Math.floor(tt * 30000), noise = (hash(n) + hash(n + 7919) - 1) * 2.4 * (tl.adcNoise || 0.6);
    return ((centerAt(tt, S0('dynamic').t0) + Math.round((tl.adcGain || 45) * x + noise)) % 90 + 90) % 90;
  };
  // what the firmware drives for a physical slot: ledHigh(i) sets CPX[col] high and CPX[row] low
  const drive = slot => {
    const i = (slot + 89) % 90, col = Math.floor(i / 9);
    let row = 9 - (i % 9);
    if (9 - col <= 9 - row) row--;
    return {hi: col, lo: row};
  };

  const persist = (L, events, t, tau, gain = 1) => {
    const i1 = lowerBound(events, t + 1e-9);
    for (let i = i1 - 1; i >= 0; i--) {
      const e = events[i], dt = t - e.t;
      if (dt > tau * 7) break;
      const v = gain * Math.exp(-dt / tau);
      if (v > L[e.led]) L[e.led] = v;
    }
  };
  const sparkleVisual = (L, t, t0, gain, tau = 0.08) => {
    // ~320 Hz wake-ups, rand()%15 == 0 lights rand()%90
    const k1 = Math.floor(t * 320), k0 = Math.max(Math.floor((t - tau * 6) * 320), Math.floor(t0 * 320));
    for (let k = k1; k >= k0; k--) {
      if (Math.floor(hash(k * 2 + 1) * 15) !== 0) continue;
      const led = Math.floor(hash(k * 7 + 3) * 90);
      const v = gain * Math.exp(-(t - k / 320) / tau);
      if (v > L[led]) L[led] = v;
    }
  };
  const S = k => tl.sec[k];
  const allOn = (L, v) => { for (let i = 0; i < 90; i++) L[i] = Math.max(L[i], v); };

  function levels(t) {
    const L = new Float32Array(90);
    const release = tl.M('release', 1.7);
    // prologue: the boot sweep round the ring while the button is held
    if (t < S('introit').t0) {
      persist(L, tl.events.boot, t, 0.22);
      if (t > release) allOn(L, 0.9 * Math.exp(-(t - release) / 0.25));
    }
    // introit: one light; then it circles once, a step per syllable
    if (t > release + 0.4 && t < lineB.t0 + 0.3) {
      L[introLed] = Math.max(L[introLed], smooth((t - release - 0.4) / 2) * (0.82 + 0.18 * Math.sin(t * 1.3)));
    }
    if (t >= lineB.t0 && t < S('halo').t0 + 0.2) {
      const syl = lineB.syls;
      let prog = 0;
      for (let i = 0; i < syl.length; i++) {
        const a = syl[i].t0, b = i + 1 < syl.length ? syl[i + 1].t0 : syl[i].t1;
        if (t >= a) prog = (i + clamp((t - a) / (b - a))) / syl.length;
      }
      const head = INTRO_SLOT + prog * 90;
      const fade = t > lineB.t1 ? Math.exp(-(t - lineB.t1) / 0.9) : 1;
      for (let s = 0; s < 90; s++) {
        const pos = INTRO_SLOT + s;
        if (pos > head && prog < 1) continue;
        const back = (((head - pos) % 90) + 90) % 90;
        const v = back < 0.5 ? 1 : 0.32 * Math.exp(-back / 26) + (back < 3 ? 0.4 * (1 - back / 3) : 0);
        const i = fwOfSlot[(INTRO_SLOT + s) % 90];
        L[i] = Math.max(L[i], v * fade);
      }
    }
    // halo: all of them flash on the downbeat, then the JUMP star, then one alone, then all glow
    const h = S('halo');
    if (t >= h.t0 - 0.05 && t < h.t0 + 1.5) allOn(L, Math.exp(-(t - h.t0 + 0.05) / 0.5));
    if (t >= h.t0 && t < refrain.t0 + 0.3) persist(L, scan, t, t < halo[Math.min(2, halo.length - 1)].t0 ? 0.9 : 0.45);
    // then the button press into the audio mode, the centre circling; the ring hands over to it across a second
    const d = S('dynamic'), X = 0.5;
    if (t >= refrain.t0 && t < d.t0 + X) {
      const p = scanDuty(t), u = smooth((t - d.t0 + X) / (2 * X));
      if (u > 0) { const q = audioDuty(t, d.t0); for (let i = 0; i < 90; i++) p[i] = (1 - u) * p[i] + u * q[i]; }
      return toLevels(p);
    }
    if (t >= d.t0 && t < d.t1) return toLevels(audioDuty(t, d.t0));
    // sparkle, then the whole ring glowing up together into the finale
    const sp = S('sparkle');
    if (t >= sp.t0 && t < sp.t1) {
      persist(L, tl.events.sparkle, t, 0.45);
      const build = clamp((t - (sp.t1 - 5)) / 5);
      sparkleVisual(L, t, sp.t0, 0.6 + 0.3 * build);
      if (build > 0) allOn(L, 0.75 * build * build);
    }
    // open: the hero's ring glows steadily, the ostinato rides on it
    const o = S('open');
    if (t >= o.t0 && t < o.t1) {
      allOn(L, 0.85 + 0.05 * Math.sin(t * 2.1));
      persist(L, tl.events.ostinato, t, 0.1);
    }
    // sleep: steady until held for 500 ms, then HALT
    const z = S('sleep'), halt = tl.M('halt', z.t0 + 5);
    if (t >= z.t0 && t < halt + 0.6) allOn(L, 0.62 * (t >= halt ? Math.exp(-(t - halt) / 0.08) : 1));
    return L;
  }

  function currentSingle(t) {                       // the LED lit at t during the refrain
    return steps[Math.max(0, lowerBound(steps, t + 1e-9) - 1)].led;
  }

  // the wake at the very end: the boot sweep again, inside the closed case
  const boot2 = tl.events.boot2 || [];
  function wake(t) {
    const L = new Float32Array(90);
    persist(L, boot2, t, 0.3);
    return L;
  }

  // other boards in the field: forks of the firmware
  const FORKS = [`+${JUMP}`, '+1', '+7', 'rand()%15', 'breathe', 'adc', '±1', '+29', '+45', '0b…'];
  function fork(kind, t, seed) {
    const L = new Float32Array(90);
    const ph = hash(seed) * 10;
    switch (kind) {
      case `+${JUMP}`: L.fill(0.85); break;   // at persistence-of-vision speed the ring simply glows
      case '+1': case '±1': {
        let head = (t * 30 + ph * 9) % 90;
        if (kind === '±1') { const q = (t * 22 / 90 + ph) % 2; head = (q < 1 ? q : 2 - q) * 89; }
        for (let s = 0; s < 90; s++) L[fwOfSlot[s]] = Math.exp(-(((head - s) % 90) + 90) % 90 / 6);
        break;
      }
      case '+7': case '+29': case '+45': {
        const st = parseInt(kind.slice(1)), n = Math.floor(t * 24 + ph * 5);
        for (let k = 0; k < 14; k++) { const led = ((n - k) * st % 90 + 90) % 90; L[led] = Math.max(L[led], Math.exp(-k / 4)); }
        break;
      }
      case 'rand()%15': sparkleVisual(L, t + ph, t + ph - 1, 1, 0.08); break;
      case 'breathe': L.fill(0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 3 + ph))); break;
      case 'adc': { const p = audioDuty(t, t - 10, Math.floor(ph * 9)); for (let i = 0; i < 90; i++) L[i] = p[i]; break; }
      case '0b…': { const n = Math.floor(t * 8 + ph * 100); for (let b = 0; b < 90; b++) L[fwOfSlot[b]] = (n >> (b % 12)) & 1 ? 0.8 : 0.03; break; }
    }
    return L;
  }

  return {levels, wake, fork, FORKS, fwOfSlot, slotOf, introLed, INTRO_SLOT, scan, refrain, accT0, accT1, scanEnd,
    scanRate, lineA, lineB, currentSingle, adcLed, drive, JUMP};
}
