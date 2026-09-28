// Timing helpers over build/timeline.json. Everything the film does is placed with these,
// so a different soundtrack (and cue sheet) re-times the whole film.

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = u => (u = clamp(u), u * u * (3 - 2 * u));
export const smoother = u => (u = clamp(u), u * u * u * (u * (u * 6 - 15) + 10));
export const win = (t, a, b, fin = 0.4, fout = 0.4) => smooth((t - a) / fin) * smooth((b - t) / fout);

export function lowerBound(arr, t, key = 't') {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if ((key ? arr[m][key] : arr[m]) < t) lo = m + 1; else hi = m;
  }
  return lo;
}

export function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}

export class Timeline {
  constructor(j) {
    Object.assign(this, j);
    this.sec = Object.fromEntries(j.sections.map(s => [s.key, s]));
    this.barLen = j.downbeats.length > 1 ? (j.downbeats[j.downbeats.length - 1] - j.downbeats[0]) / (j.downbeats.length - 1) : 240 / j.bpm;
  }
  // fraction f of a section
  S(key, f = 0) { const s = this.sec[key]; return s.t0 + (s.t1 - s.t0) * f; }
  // n bars (fractional) after the first downbeat of a section
  B(key, n = 0) {
    const d = this.downbeats, s = this.sec[key];
    const i0 = lowerBound(d, s.t0 - 0.2, null);
    const at = k => (k < d.length ? d[k] : d[d.length - 1] + (k - d.length + 1) * this.barLen);
    const k = i0 + Math.floor(n), fr = n - Math.floor(n);
    return at(k) + (at(k + 1) - at(k)) * fr;
  }
  M(name, fallback = 0) { return this.marks[name] ?? fallback; }
  sectionAt(t) { let s = this.sections[0]; for (const x of this.sections) if (x.t0 <= t) s = x; return s; }
  linesIn(key) { const s = this.sec[key]; return this.lines.filter(l => l.t0 >= s.t0 - 0.05 && l.t0 < s.t1); }
  beatAfter(t) { return this.beats[Math.min(this.beats.length - 1, lowerBound(this.beats, t, null))]; }
}

// Cubic Hermite through keys {t, v:[...], stop?} with time-aware tangents (C1: no velocity jumps).
// 'stop' keys get zero tangent (the move settles there).
export function spline(keys, tension = 0.15) {
  keys = keys.slice().sort((a, b) => a.t - b.t);
  const n = keys.length, dim = keys[0].v.length;
  const m = keys.map((k, i) => {
    if (k.stop || i === 0 || i === n - 1) return new Array(dim).fill(0);
    const a = keys[i - 1], b = keys[i + 1];
    return k.v.map((_, j) => (1 - tension) * (b.v[j] - a.v[j]) / (b.t - a.t));
  });
  return t => {
    if (t <= keys[0].t) return keys[0].v.slice();
    if (t >= keys[n - 1].t) return keys[n - 1].v.slice();
    let i = 0;
    while (i < n - 2 && t >= keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1], h = b.t - a.t, u = (t - a.t) / h;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return a.v.map((p0, j) => h00 * p0 + h10 * h * m[i][j] + h01 * b.v[j] + h11 * h * m[i + 1][j]);
  };
}

// scalar envelope from [t, value] pairs, smooth-stepped between them
export function env(pairs) {
  return t => {
    if (t <= pairs[0][0]) return pairs[0][1];
    for (let i = 1; i < pairs.length; i++) {
      if (t < pairs[i][0]) {
        const [t0, v0] = pairs[i - 1], [t1, v1] = pairs[i];
        return lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
      }
    }
    return pairs[pairs.length - 1][1];
  };
}
