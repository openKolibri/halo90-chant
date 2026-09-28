'use strict';
/*
 * Drives web/film.html (three.js) in headless Chrome and captures deterministic frames.
 *
 *   node src/render3d.js --info
 *   node src/render3d.js --still 57 out.jpg
 *   node src/render3d.js --stills dir 10 20 30
 *   node src/render3d.js --range 0 600 out.mp4
 *   node src/render3d.js --eval "window.debugView({...})" out.jpg      (asset inspection)
 */
const puppeteer = require('puppeteer-core');
const {spawn, execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {start} = require('./serve');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1920, H = 1080;

// Memory guard. This machine has 8 GB: if Chrome's GPU/renderer memory runs away, the kernel stalls
// and the Mac panics (watchdog timeout with the memory compressor full). So: refuse to start when memory
// is already tight, and kill Chrome the moment free memory drops below MIN_FREE_PCT.
const MIN_FREE = parseInt(process.env.MIN_FREE_PCT || '15');
const START_FREE = parseInt(process.env.START_FREE_PCT || '25');
function freePct() {
  try { return parseInt(execFileSync('sysctl', ['-n', 'kern.memorystatus_level']).toString(), 10); } catch (_) { return 100; }
}

async function openFilm() {
  const free0 = freePct();
  if (free0 < START_FREE) throw new Error(`memory guard: only ${free0}% of memory free; close some apps first (need ${START_FREE}%)`);
  const server = await start();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 600000,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--renderer-process-limit=1', '--js-flags=--max-old-space-size=1536'],
  });
  const guard = setInterval(() => {
    const f = freePct();
    if (f < MIN_FREE) {
      console.error(`memory guard: ${f}% of memory free (< ${MIN_FREE}%); killing Chrome to protect the machine`);
      try { browser.process().kill('SIGKILL'); } catch (_) {}
      process.exit(3);
    }
  }, 500);
  guard.unref();
  const page = await browser.newPage();
  await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
  page.on('console', m => { if (!/GPU stall|WebGL/.test(m.text())) console.error('[page]', m.text()); });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  const qs = [];
  if (process.env.TIMELINE) qs.push(`timeline=/${process.env.TIMELINE}`);
  if (process.env.RES) { const [w, h] = {480: [854, 480], 720: [1280, 720], 1080: [1920, 1080]}[process.env.RES]; qs.push(`w=${w}`, `h=${h}`); }
  const q = qs.length ? '?' + qs.join('&') : '';
  await page.goto(`http://127.0.0.1:${server.address().port}/web/film.html${q}`);
  await page.waitForFunction('window.filmReady === true || window.filmError', {timeout: 300000});
  const err = await page.evaluate('window.filmError');
  if (err) throw new Error(err);
  return {
    page,
    async frame(t, fmt = 'jpeg') {
      let timer;
      const watchdog = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`frame ${t.toFixed(3)} timed out`)), 60000); });
      try {
        const b64 = await Promise.race([page.evaluate((t, fmt) => window.renderFrame(t, fmt), t, fmt), watchdog]);
        return Buffer.from(b64, 'base64');
      } finally { clearTimeout(timer); }
    },
    async close() {
      clearInterval(guard);
      // Chrome occasionally never acknowledges close after a long GPU session; don't let that hang the build
      await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
      try { browser.process() && browser.process().kill('SIGKILL'); } catch (_) {}
      server.close();
    },
  };
}

async function renderRange(film, f0, f1, out, fps) {
  const tmp = out + '.part.mp4';
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg',
    '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-tune', 'film', tmp], {stdio: ['pipe', 'inherit', 'inherit']});
  const t0 = Date.now();
  try {
    for (let f = f0; f < f1; f++) {
      const buf = await film.frame(f / fps);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((f - f0) % 120 === 0) process.stderr.write(`[${f0}-${f1}] frame ${f}  ${((Date.now() - t0) / (f - f0 + 1)).toFixed(0)} ms/f\n`);
    }
  } catch (e) {
    ff.stdin.destroy(); ff.kill('SIGKILL');
    throw e;
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  fs.renameSync(tmp, out);
}

async function main() {
  const a = process.argv.slice(2);
  const film = await openFilm();
  try {
    if (a[0] === '--info') {
      console.log(await film.page.evaluate('window.gpuInfo()'));
      const t = Date.now();
      for (let i = 0; i < 10; i++) await film.frame(40 + i / 30);
      console.log('ms/frame', (Date.now() - t) / 10);
    } else if (a[0] === '--still') {
      fs.writeFileSync(a[2] || 'still.jpg', await film.frame(parseFloat(a[1])));
    } else if (a[0] === '--stills') {
      fs.mkdirSync(a[1], {recursive: true});
      for (const s of a.slice(2)) {
        const t = parseFloat(s);
        fs.writeFileSync(path.join(a[1], `t${t.toFixed(2).padStart(7, '0')}.jpg`), await film.frame(t));
      }
    } else if (a[0] === '--eval') {
      const b64 = await film.page.evaluate(a[1]);
      fs.writeFileSync(a[2] || 'eval.jpg', Buffer.from(b64, 'base64'));
    } else if (a[0] === '--range') {
      const fps = await film.page.evaluate('window.FILM_FPS');
      await renderRange(film, parseInt(a[1]), parseInt(a[2]), a[3], fps);
    }
  } finally {
    await film.close();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = {openFilm, renderRange};
