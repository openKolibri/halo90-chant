'use strict';
// Render all frames in parallel segments, then concat and mux with the master audio.
const {spawn, execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/timeline.json')));
const frames = Math.round(TL.duration * TL.fps);
const jobs = parseInt(process.env.JOBS || String(os.cpus().length));
const segDir = path.join(ROOT, 'build/seg');
fs.mkdirSync(segDir, {recursive: true});
fs.mkdirSync(path.join(ROOT, 'out'), {recursive: true});

const per = Math.ceil(frames / jobs);
const segs = [];
const t0 = Date.now();
Promise.all(Array.from({length: jobs}, (_, j) => new Promise((res, rej) => {
  const a = j * per, b = Math.min(frames, a + per);
  const out = path.join(segDir, `seg${String(j).padStart(2, '0')}.mp4`);
  segs[j] = out;
  const p = spawn('node', [path.join(__dirname, 'render.js'), '--range', String(a), String(b), out], {stdio: ['ignore', 'inherit', 'inherit']});
  p.on('close', c => (c === 0 ? res() : rej(new Error(`segment ${j} exit ${c}`))));
}))).then(() => {
  console.log(`frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const list = path.join(segDir, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  const final = path.join(ROOT, 'out/HALO-90_NONAGINTA.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-i', path.join(ROOT, 'build/audio/nonaginta.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '320k', '-t', String(TL.duration), '-movflags', '+faststart', final], {stdio: 'inherit'});
  console.log('wrote', final);
}).catch(e => { console.error(e); process.exit(1); });
