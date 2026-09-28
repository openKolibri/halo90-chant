// Screen-space typography over the 3D frame: lyrics, HUD, logic analyzer, titles, and callouts
// whose leader lines are pinned to projected 3D points on the real parts.
import {clamp, hash, lerp, lowerBound, smooth, win} from './timeline.js';

const W = 1920, H = 1080;
export const FONT = {latin: 'Optima', mono: 'SFMono', ital: 'NewYorkItalic'};
const COL = {bone: [239, 230, 218], gold: [217, 164, 65]};
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const latinOf = s => s.toUpperCase().replace(/U/g, 'V');

export function label(g, x, y, txt, alpha, o = {}) {
  if (alpha <= 0.002) return;
  const fam = o.font || FONT.mono;
  g.font = `${o.italic ? 'italic ' : ''}${o.size || 22}px ${fam}`;
  g.textAlign = o.align || 'left';
  g.letterSpacing = o.spacing || '0px';
  g.fillStyle = rgba(o.color || COL.bone, alpha);
  g.fillText(txt, x, y);
  g.letterSpacing = '0px';
}
const typed = (s, dt, cps = 40) => s.slice(0, Math.floor(clamp(dt * cps / Math.max(1, s.length)) * s.length));

export function makeOverlay(tl, leds) {
  const S = k => tl.sec[k];
  const L = key => tl.linesIn(key);

  function lyrics(g, t) {
    tl.lines.forEach((Ln, li) => {
      const next = tl.lines[li + 1];
      const end = next ? Math.min(Ln.t1 + 1.3, next.t0 - 0.5) : Ln.t1 + 1.3;
      const a = win(t, Ln.t0 - 0.45, end, 0.4, Math.min(0.7, Math.max(0.25, end - Ln.t1)));
      if (a <= 0) return;
      const y = 902;
      g.font = `58px ${FONT.latin}`;
      g.letterSpacing = '9px';
      const parts = [];
      let prev = -1;
      for (const s of Ln.syls) {
        if (s.word !== prev && parts.length) parts.push({space: true});
        parts.push({s, txt: latinOf(s.text)});
        prev = s.word;
      }
      let total = 0;
      for (const p of parts) total += p.space ? 30 : g.measureText(p.txt).width;
      let x = W / 2 - total / 2;
      g.textAlign = 'left';
      for (const p of parts) {
        if (p.space) { x += 30; continue; }
        const s = p.s, w = g.measureText(p.txt).width;
        const on = t >= s.t0 - 0.04 && t <= s.t1 + 0.05, sung = t > s.t1;
        if (on) { g.shadowColor = 'rgba(255,50,20,0.95)'; g.shadowBlur = 22; }
        g.fillStyle = rgba(on ? [255, 236, 226] : COL.bone, (on ? 1 : sung ? 0.82 : 0.26) * a);
        g.fillText(p.txt, x, y);
        g.shadowBlur = 0;
        if (on) {
          g.fillStyle = `rgba(255,60,30,${0.9 * a})`;
          g.fillRect(x, y + 16, (w - 9) * clamp((t - s.t0) / Math.max(0.2, s.t1 - s.t0)), 2);
        }
        x += w;
      }
      g.letterSpacing = '0px';
      label(g, W / 2, y + 52, Ln.en, 0.62 * a, {font: FONT.ital, italic: true, size: 26, align: 'center'});
      const tech = typed(Ln.tech, t - Ln.t0 + 0.2, 38);
      const caret = Math.floor(t * 2.5) % 2 && tech.length < Ln.tech.length ? '▌' : ' ';
      label(g, W / 2, y + 96, tech + caret, 0.9 * a, {size: 22, align: 'center', color: COL.gold});
    });
  }

  const MODES = {
    halo: ['HALO', '10.88 mA', '≈ 20.2 h'], dynamic: ['DYNAMIC', '11.71 mA', '≈ 18.8 h'],
    sparkle: ['SPARKLE', '2.01 mA', '≈ 109.5 h'], open: ['HALO × 35', '380.8 mA', 'one panel'],
    sleep: ['HALO', '10.88 mA', '≈ 20.2 h'],
  };
  function hud(g, t) {
    const sec = tl.sectionAt(t);
    if (sec.key !== 'prologue' && sec.key !== 'finis') {
      const a = win(t, sec.t0 + 0.3, sec.t1, 0.8, 0.5);
      const big = win(t, sec.t0 + 0.2, sec.t0 + 3.6, 0.6, 1.0);
      label(g, 80, 92, sec.name, (0.5 + 0.45 * big) * a, {font: FONT.latin, size: 30, spacing: '8px'});
      label(g, 82, 124, sec.sub, 0.55 * a, {size: 18, color: COL.gold});
    }
    let m = MODES[sec.key];
    if (sec.key === 'sleep' && t >= tl.M('halt', 1e9)) m = ['HALT', '15 µA', '≈ 1.7 years'];
    if (m) {
      const a = win(t, sec.t0 + 0.5, sec.t1, 0.6, 0.4);
      label(g, W - 80, 92, m[0], 0.6 * a, {size: 18, align: 'right', color: COL.gold, spacing: '3px'});
      label(g, W - 80, 122, `I = ${m[1]}   ${m[2]}`, 0.55 * a, {size: 18, align: 'right'});
      g.strokeStyle = `rgba(217,164,65,${0.45 * a})`; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = W - 80 - 240 + i * 2;
        let v = 0.6 + 0.08 * (hash(Math.floor(t * 30) * 977 + i) - 0.5);
        if (m[0] === 'SPARKLE') v = hash(Math.floor(t * 60) * 131 + i) < 0.07 ? 1 : 0.1;
        if (m[0] === 'HALT') v = 0.02;
        const y = 150 - v * 18;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  }

  // leader line from a projected 3D anchor to a label placed at a fixed screen offset
  function callout(g, anchor, off, lines, a, t0, t, o = {}) {
    if (a <= 0.003 || !anchor || anchor.behind) return;
    const u = 1 - Math.pow(1 - clamp((t - t0) / 0.6), 3);
    const to = [anchor.x + off[0], anchor.y + off[1]];
    const mx = lerp(anchor.x, to[0], u), my = lerp(anchor.y, to[1], u);
    g.strokeStyle = rgba(COL.gold, 0.85 * a); g.lineWidth = 1.2;
    g.beginPath(); g.arc(anchor.x, anchor.y, o.ring || 6, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(anchor.x, anchor.y); g.lineTo(mx, my);
    const dir = off[0] >= 0 ? 1 : -1;
    if (u >= 1) g.lineTo(to[0] + dir * 30, to[1]);
    g.stroke();
    if (u >= 0.95) lines.forEach((ln, i) => label(g, to[0] + dir * 40, to[1] + 8 + i * 30, typed(ln, t - t0 - 0.5, 45),
      a * (i ? 0.7 : 1), {align: dir > 0 ? 'left' : 'right', size: i ? 19 : 23, color: i ? COL.bone : COL.gold}));
  }

  function logic(g, t) {
    const dl = L('dynamic');
    if (dl.length < 4) return;
    const a0 = dl[2].t0, a1 = dl[3].t1 + 0.6;
    const a = win(t, a0 + 0.2, a1, 0.6, 0.5);
    if (a <= 0) return;
    const x0 = 1370, x1 = 1850, y0 = 300, dy = 42;
    const span = t < dl[3].t0 ? 1.5 : lerp(1.5, 0.02, smooth((t - dl[3].t0) / 1.5));
    label(g, x0, y0 - 40, span > 0.1 ? `CPX lines · ${span.toFixed(1)} s window` : `CPX lines · ${(span * 1000).toFixed(0)} ms window · > 1 kHz`,
      0.7 * a, {size: 17, color: COL.gold});
    const stateAt = tt => leds.drive(leds.adcLed(tt));       // the audio mode: one ADC sample, one LED
    for (let c = 0; c < 10; c++) {
      const yc = y0 + c * dy;
      label(g, x0 - 16, yc + 6, `CPX-${c}`, 0.6 * a, {size: 15, align: 'right'});
      g.lineWidth = 1.5;
      g.beginPath();
      let prevY = null;
      for (let i = 0; i <= 240; i++) {
        const tt = t - span + span * i / 240;
        const d = stateAt(tt);
        const y = d.hi === c ? yc - 12 : d.lo === c ? yc + 12 : yc;
        const x = lerp(x0, x1, i / 240);
        if (prevY === null) g.moveTo(x, y); else { if (y !== prevY) g.lineTo(x, prevY); g.lineTo(x, y); }
        prevY = y;
      }
      g.strokeStyle = `rgba(255,90,50,${0.8 * a})`;
      g.stroke();
    }
    label(g, x0, y0 + 10 * dy + 12, 'HIGH = anode   LOW = cathode   ─ = Hi-Z', 0.45 * a, {size: 14});
  }

  function titles(g, t) {
    const intro = S('introit').t0, rel = tl.M('release', 1.7);
    const ta = win(t, rel + 0.7, intro - 0.1, 0.9, 0.9);
    if (ta > 0) {
      label(g, W / 2, 470, 'NONAGINTA', ta, {font: FONT.latin, size: 118, align: 'center', spacing: '34px'});
      label(g, W / 2, 540, 'a canticle for ninety lights', 0.8 * ta, {font: FONT.ital, italic: true, size: 34, align: 'center'});
      label(g, W / 2, 610, 'HALO-90', 0.7 * ta, {size: 22, align: 'center', color: COL.gold, spacing: '8px'});
    }
    const pa = win(t, 0.1, rel + 0.5, 0.3, 0.5);
    if (pa > 0) label(g, W / 2, 1010, 'press and hold', 0.7 * pa, {size: 22, align: 'center', color: COL.gold, spacing: '4px'});
    const f = S('finis');
    const fa = win(t, f.t0 + 0.4, tl.duration + 5, 1.2, 0.1);
    if (fa > 0) {
      label(g, W / 2, 330, 'HALO-90', fa, {font: FONT.latin, size: 128, align: 'center', spacing: '30px'});
      label(g, W / 2, 405, 'Ninety lights. One at a time.', 0.85 * fa * smooth((t - f.t0 - 1.2) / 1), {font: FONT.ital, italic: true, size: 38, align: 'center'});
      const b = fa * smooth((t - f.t0 - 2.2) / 1);
      label(g, W / 2, 890, 'open hardware  ·  CERN-OHL-S 2.0  ·  GPL-3.0  ·  CC BY-SA 4.0', 0.6 * b, {size: 19, align: 'center'});
      label(g, W / 2, 926, 'github.com/openKolibri/halo-90      openkolibri.com/hlo/90', 0.85 * b, {size: 21, align: 'center', color: COL.gold});
      label(g, W / 2, 1030, 'every note and every light in this film was generated from the HALO-90 repository', 0.55 * fa * smooth((t - f.t0 - 3) / 1.5), {size: 16, align: 'center'});
    }
  }

  // text tied to particular lines
  function lineNotes(g, t, A) {
    const hl = L('halo');
    if (hl.length >= 4) {
      const tre = hl[2];
      const a = win(t, tre.t0 + 0.3, tre.t1 + 0.4, 0.5, 0.3);
      if (a > 0) {
        const i = lowerBound(leds.scan, t + 1e-9) - 1;
        const cur = leds.scan[Math.max(0, i)].led, prev = leds.scan[Math.max(0, i - 1)].led;
        label(g, W / 2, 105, `prevLed = ${String(prev).padStart(2)}   →   setLed(${String(cur).padStart(2)})   ·   ${leds.board.leds[cur].ref}`, 0.8 * a, {size: 24, align: 'center', color: COL.gold});
      }
      const r = leds.refrain;
      const sa = win(t, r.t0 + 0.3, leds.accT0, 0.4, 0.3);
      if (sa > 0) {
        label(g, W / 2, 105, 'the actual state of the ring at any instant', 0.6 * sa, {size: 20, align: 'center'});
        const dx = A.center.x - A.single.x, dy = A.center.y - A.single.y, dn = Math.hypot(dx, dy) || 1;
        callout(g, A.single, [dx / dn * 190, dy / dn * 190], [`${A.singleRef} — the only one on`], sa, r.t0 + 0.3, t);
      }
      const ra = win(t, leds.accT0 + 0.2, leds.accT1 + 0.7, 0.3, 0.4);
      if (ra > 0) {
        const rate = leds.scanRate(t), each = t >= leds.accT1 ? `  ·  each LED ${Math.round(rate / 90)}× a second` : '';
        label(g, W / 2, 105, `scan rate ${rate < 1000 ? rate.toFixed(0) : (rate / 1000).toFixed(1) + 'k'} LED/s${each}`, 0.75 * ra, {size: 24, align: 'center', color: COL.gold});
      }
      const q = hl[1];
      callout(g, A.fourDeg, [140, -60], ['4° apart · 90 × 4° = 360°'], win(t, q.t0 + 0.4, q.t1 + 0.3, 0.3, 0.4), q.t0 + 0.4, t);
    }
    const dimA = win(t, leds.accT1 - 0.8, S('dynamic').t0 + 3.5, 0.6, 0.6);
    if (dimA > 0 && A.dim && !A.dim.behind) label(g, A.dim.x, A.dim.y + 36, 'Ø 24 mm  ·  5.2 g', 0.85 * dimA, {size: 22, align: 'center'});
    const dl = L('dynamic');
    if (dl.length >= 5) {
      callout(g, A.mk1, [330, -130], ['MK1 · SPW2430 MEMS microphone', 'every ADC sample picks an LED'], win(t, dl[0].t0 + 0.3, dl[0].t1 + 0.4, 0.3, 0.4), dl[0].t0 + 0.3, t);
      callout(g, A.formula, [-300, -70], ['setLed((4140 + rc + adc) % 90)', 'rc circles · the louder, the wider'], win(t, dl[1].t0 + 0.3, dl[1].t1 + 0.4, 0.3, 0.4), dl[1].t0 + 0.3, t);
      callout(g, A.u1, [420, -300], ['U1 · STM8L151G4', '8-bit · 16 MHz · 16 KB flash · ♥ on the silkscreen'], win(t, dl[4].t0 + 1.4, dl[4].t1 + 0.2, 0.3, 0.3), dl[4].t0 + 1.4, t);
    }
    const sl = L('sparkle');
    if (sl.length >= 3) {
      const c = sl[2];
      const ga = win(t, c.t0 + 0.2, c.t1 + 0.3, 0.5, 0.4);
      if (ga > 0 && A.gauge && !A.gauge.behind) {
        const h = 109.5 * (1 - Math.pow(1 - clamp((t - c.t0 - 0.3) / 3), 3));
        label(g, A.gauge.x + 40, A.gauge.y - 20, `${h.toFixed(1)} h`, ga, {font: FONT.latin, size: 64, spacing: '4px'});
        [['DYNAMIC', '11.71 mA', '18.8 h'], ['HALO', '10.88 mA', '20.2 h'], ['SPARKLE', '2.01 mA', '109.5 h']].forEach((r, i) =>
          label(g, A.gauge.x + 42, A.gauge.y + 30 + i * 30, `${r[0].padEnd(8)} ${r[1].padStart(9)}  ${r[2].padStart(8)}`,
            0.7 * ga * smooth((t - c.t0 - 0.8 - i * 0.25) / 0.4), {size: 18, color: i === 2 ? COL.gold : COL.bone}));
      }
    }
    const ol = L('open');
    if (ol.length >= 3) {
      const a = win(t, ol[0].t0 + 0.4, ol[0].t1 + 0.4, 0.6, 0.5);
      ['hardware   CERN-OHL-S 2.0', 'firmware   GNU GPL 3.0', 'docs       CC BY-SA 4.0'].forEach((s, i) =>
        label(g, 120, 470 + i * 38, typed(s, t - ol[0].t0 - 0.7 - i * 0.35), a, {size: 23, color: i ? COL.bone : COL.gold}));
      (A.layers || []).forEach((p, i) => { if (p && !p.behind) label(g, p.x + 24, p.y + 6, ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'][i], a * A.explode, {size: 20, color: COL.gold}); });
      const m = ol[2];
      const fa = win(t, m.t0 + 0.2, m.t1 + 0.2, 0.4, 0.4);
      if (fa > 0) {
        const nums = ['13', '7', '29', '1', '45'];
        const span = (m.t1 - m.t0) / nums.length;
        const k = Math.floor((t - m.t0) / span) % nums.length, within = ((t - m.t0) % span) / span;
        let n = nums[Math.max(0, k)];
        if (within > 0.75) n = n.slice(0, Math.max(0, Math.floor((1 - (within - 0.75) / 0.25) * n.length)));
        label(g, W / 2, 105, `setLed((prevLed + ${n}${within > 0.75 && Math.floor(t * 6) % 2 ? '▌' : ''}) % 90);`, fa, {size: 26, align: 'center', color: COL.gold});
        (A.forks || []).forEach(p => { if (p && !p.behind) label(g, p.x, p.y, p.kind, 0.8 * fa, {size: 16, align: 'center', color: COL.gold}); });
      }
    }
    // the hold: 500 ms on S1
    const hold = tl.M('hold', 1e9), halt = tl.M('halt', 1e9);
    const ha = win(t, hold - 0.3, halt + 0.3, 0.2, 0.2);
    if (ha > 0 && A.s1 && !A.s1.behind) {
      const u = clamp((t - hold) / Math.max(0.1, halt - hold));
      g.strokeStyle = `rgba(217,164,65,${ha})`; g.lineWidth = 2.5;
      g.beginPath(); g.arc(A.s1.x, A.s1.y, 30, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); g.stroke();
      label(g, A.s1.x - 46, A.s1.y + 8, u < 1 ? `${Math.round(u * 500)} ms` : 'HALT', ha, {size: 20, align: 'right', color: COL.gold});
    }
  }

  function vignetteBand(g, band) {
    const lg = g.createLinearGradient(0, H * 0.72, 0, H);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.45, `rgba(0,0,0,${band * 0.8})`); lg.addColorStop(1, `rgba(0,0,0,${band})`);
    g.fillStyle = lg; g.fillRect(0, H * 0.72, W, H * 0.28);
  }

  return function draw(g, t, anchors, extra) {
    vignetteBand(g, extra.band);
    hud(g, t);
    lineNotes(g, t, anchors);
    logic(g, t);
    lyrics(g, t);
    titles(g, t);
    if (extra.black > 0) { g.fillStyle = `rgba(0,0,0,${extra.black})`; g.fillRect(0, 0, W, H); }
  };
}
