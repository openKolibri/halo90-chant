'use strict';
// One Chrome session, several page expressions that each return a base64 JPEG:
//   node src/evals.js <outdir> 'name=window.debugCase(161, {...})' ...
const fs = require('fs'), path = require('path');
const {openFilm} = require('./render3d');
(async () => {
  const [dir, ...vs] = process.argv.slice(2);
  fs.mkdirSync(dir, {recursive: true});
  const film = await openFilm();
  try {
    for (const v of vs) {
      const i = v.indexOf('=');
      fs.writeFileSync(path.join(dir, v.slice(0, i) + '.jpg'), Buffer.from(await film.page.evaluate(v.slice(i + 1)), 'base64'));
    }
  } finally { await film.close(); }
})().catch(e => { console.error(e); process.exit(1); });
