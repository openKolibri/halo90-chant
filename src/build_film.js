'use strict';
// Render the three.js film in parallel headless-Chrome workers, then concat and mux the soundtrack.
//   node src/build_film.js [out.mp4] [--frames a:b]      (RES=480|720|1080; RESUME=1 keeps finished chunks;
//   SEGDIR=build/seg480 for previews so the 1080p chunks in build/seg3d survive)
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {openFilm, renderRange} = require('./render3d');

const ROOT = path.resolve(__dirname, '..');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/timeline.json')));
const args = process.argv.slice(2);
const outFile = path.resolve(args.find(a => a.endsWith('.mp4')) || path.join(ROOT, 'out/HALO-90_NONAGINTA.mp4'));
const fr = (args[args.indexOf('--frames') + 1] || '').split(':');
const F0 = args.includes('--frames') ? parseInt(fr[0]) : 0;
const F1 = args.includes('--frames') ? parseInt(fr[1]) : Math.round(TL.duration * TL.fps);
const JOBS = parseInt(process.env.JOBS || '1');   // one Chrome is fastest: parallel GPU contexts contend on Apple silicon
const segDir = path.resolve(ROOT, process.env.SEGDIR || 'build/seg3d');   // chunks (keep one dir per resolution)
if (process.env.RESUME !== '1') fs.rmSync(segDir, {recursive: true, force: true});
fs.mkdirSync(segDir, {recursive: true});
const RECYCLE = 8;   // chunks per browser: a fresh Chrome every 1200 frames keeps GPU memory from creeping
fs.mkdirSync(path.dirname(outFile), {recursive: true});

(async () => {
  const t0 = Date.now();
  // small interleaved chunks so fast and slow parts of the film spread across workers
  const chunk = 150, chunks = [];
  for (let a = F0; a < F1; a += chunk) chunks.push([a, Math.min(F1, a + chunk)]);
  let next = 0;
  await Promise.all(Array.from({length: JOBS}, async (_, w) => {
    let film = await openFilm(), done = 0;
    while (next < chunks.length) {
      const [a, b] = chunks[next++];
      const seg = path.join(segDir, `c${String(a).padStart(6, '0')}.mp4`);
      if (fs.existsSync(seg)) continue;
      if (done && done % RECYCLE === 0) { await film.close(); film = await openFilm(); }
      for (let attempt = 1; ; attempt++) {
        try {
          await renderRange(film, a, b, seg, TL.fps);
          done++;
          break;
        } catch (e) {
          // a stalled or lost GPU context: restart this worker's browser and redo the chunk
          console.error(`worker ${w} chunk ${a}: ${e.message} (attempt ${attempt})`);
          try { await film.close(); } catch (_) {}
          if (attempt >= 3) throw e;
          film = await openFilm();
        }
      }
    }
    await film.close();
  }));
  console.log(`rendered ${F1 - F0} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const segs = fs.readdirSync(segDir).filter(f => f.endsWith('.mp4') && !f.endsWith('.part.mp4')).sort();
  const list = path.join(segDir, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${path.join(segDir, s)}'`).join('\n'));
  const audio = path.join(ROOT, TL.audio);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-ss', String(F0 / TL.fps), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
    '-t', String((F1 - F0) / TL.fps), '-movflags', '+faststart', outFile], {stdio: 'inherit'});
  console.log('wrote', outFile);
})().catch(e => { console.error(e); process.exit(1); });
