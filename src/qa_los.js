'use strict';
// Line-of-sight QA: in the shots that depend on one lit LED, is it hidden behind a part?
//   RES=480 node src/qa_los.js [t0] [t1] [step]      (defaults: the introit)
const {openFilm} = require('./render3d');

(async () => {
  const film = await openFilm();
  const sec = await film.page.evaluate('window.FILM_SECTIONS || null');
  const [a = 2.3, b = 29.9, step = 0.2] = process.argv.slice(2).map(Number);
  const bad = [];
  let n = 0;
  for (let t = a; t <= b + 1e-9; t += step) {
    const r = await film.page.evaluate(t => window.los(t), t);
    n++;
    if (r.blocked && r.level > 0.3) bad.push(r);
  }
  const byPart = {};
  bad.forEach(r => { byPart[r.by] = (byPart[r.by] || 0) + 1; });
  console.log(`checked ${n} frames ${a}-${b} s: ${bad.length} with the lit LED hidden`, JSON.stringify(byPart));
  for (const r of bad.slice(0, 12)) console.log(`  ${r.t.toFixed(2)} s  ${r.led} hidden by ${r.by}`);
  await film.close();
  process.exit(bad.length ? 2 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
