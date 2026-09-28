'use strict';
// Safe boot check: open the film page under the memory guard, report memory, render one frame, close.
//   RES=480 node src/boot_test.js [t]
const {execFileSync} = require('child_process');
const {openFilm} = require('./render3d');
const free = () => parseInt(execFileSync('sysctl', ['-n', 'kern.memorystatus_level']).toString(), 10);
const chromeMB = () => {
  try {
    const out = execFileSync('ps', ['-axo', 'rss,command']).toString().split('\n').filter(l => /Google Chrome/.test(l) && /headless|--type=/.test(l));
    return Math.round(out.reduce((a, l) => a + parseInt(l.trim().split(/\s+/)[0], 10), 0) / 1024);
  } catch (_) { return -1; }
};
(async () => {
  console.log(`before: ${free()}% free`);
  const t0 = Date.now();
  const film = await openFilm();
  console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${free()}% free, Chrome ${chromeMB()} MB,`,
    'JS heap', await film.page.evaluate('Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB"'));
  const t = parseFloat(process.argv[2] || '40');
  const t1 = Date.now();
  const jpg = await film.frame(t);
  require('fs').writeFileSync('build/boot_test.jpg', jpg);
  console.log(`frame ${t} s in ${Date.now() - t1} ms: ${free()}% free, Chrome ${chromeMB()} MB`);
  await film.close();
  console.log(`closed: ${free()}% free`);
  process.exit(0);
})().catch(e => { console.error('boot test failed:', e.message); process.exit(1); });
