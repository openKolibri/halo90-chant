// The earwire hangs from an (unseen) ear; the earring hangs from the earwire's loop.
// Two planar double pendulums (side-to-side and front-to-back), driven by the "ear" moving,
// precomputed for the whole film so every frame is deterministic.
import {hash} from './timeline.js';

export function simulatePendulum(tl, {l1 = 18, l2 = 13, m1 = 0.35, m2 = 5.2, gScale = 0.1, damp1 = 3.2, damp2 = 2.0,
  forcing, rate = 240} = {}) {
  const g = 9810 * gScale;           // "slow motion": a macro lens shot at high frame rate
  const dt = 1 / 2000, N = Math.ceil(tl.duration * rate) + 2;
  const out = {rate, side1: new Float32Array(N), side2: new Float32Array(N), fb1: new Float32Array(N), fb2: new Float32Array(N)};
  for (const [plane, gain, phase] of [['side', 1, 0], ['fb', 0.45, 1.7]]) {
    let a1 = 0, a2 = 0, w1 = 0, w2 = 0, k = 0;
    const s1 = out[plane + '1'], s2 = out[plane + '2'];
    for (let step = 0, t = 0; k < N; step++, t = step * dt) {
      if (t >= k / rate) { s1[k] = a1; s2[k] = a2; k++; }
      const acc = gain * forcing(t, phase);            // horizontal acceleration of the ear, mm/s^2
      const d = a1 - a2, cd = Math.cos(d), sd = Math.sin(d);
      // mass matrix [[A, B], [C, D]] [a1'', a2''] = [E, F]
      const A = (m1 + m2) * l1, B = m2 * l2 * cd, C = m2 * l1 * cd, D = m2 * l2;
      const E = -m2 * l2 * w2 * w2 * sd - (m1 + m2) * g * Math.sin(a1) - (m1 + m2) * acc * Math.cos(a1) - damp1 * w1 * (m1 + m2);
      const F = m2 * l1 * w1 * w1 * sd - m2 * g * Math.sin(a2) - m2 * acc * Math.cos(a2) - damp2 * (w2 - w1) * m2 * 3;
      const det = A * D - B * C;
      const al1 = (E * D - B * F) / det, al2 = (A * F - C * E) / det;
      w1 += al1 * dt; w2 += al2 * dt;
      a1 += w1 * dt; a2 += w2 * dt;
    }
  }
  out.at = (t) => {
    const x = t * rate, i = Math.max(0, Math.min(N - 2, Math.floor(x))), f = x - i;
    const s = arr => arr[i] + (arr[i + 1] - arr[i]) * f;
    return {side1: s(out.side1), side2: s(out.side2), fb1: s(out.fb1), fb2: s(out.fb2)};
  };
  return out;
}

// How the ear moves: a slow living sway, plus a nudge on the drum hits of the busy sections.
export function earForcing(tl, gainAt) {
  const hits = tl.events.hits;
  return (t, phase) => {
    const gain = gainAt(t);
    if (gain <= 0) return 0;
    let a = 22 * (Math.sin(2 * Math.PI * 0.11 * t + phase) + 0.6 * Math.sin(2 * Math.PI * 0.23 * t + 2 * phase + 1)
      + 0.35 * Math.sin(2 * Math.PI * 0.41 * t + 3 * phase));
    // drum hits within the last 80 ms push the ear sideways, alternating direction
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i], dtt = t - h.t;
      if (dtt < 0) continue;
      if (dtt > 0.08) break;
      const dir = hash(i * 7 + (phase > 0 ? 3 : 0)) < 0.5 ? -1 : 1;
      a += dir * 260 * h.v * Math.exp(-dtt / 0.02);
    }
    return a * gain;
  };
}
