'use strict';
// One Chrome session, several variants of one frame: node src/ab_test.js <t> <outdir> '<name>[@t]=<js>' ...
// Each <js> runs in the page before rendering (state is NOT reset between variants unless the js does it).
const fs = require('fs'), path = require('path');
const {openFilm} = require('./render3d');
(async () => {
  const [t, dir, ...vs] = process.argv.slice(2);
  fs.mkdirSync(dir, {recursive: true});
  const film = await openFilm();
  try {
    for (const v of vs) {
      const i = v.indexOf('='), [name, at] = v.slice(0, i).split('@'), js = v.slice(i + 1);
      if (js) await film.page.evaluate(js);
      fs.writeFileSync(path.join(dir, name + (at ? '_' + at : '') + '.jpg'), await film.frame(parseFloat(at || t)));
    }
  } finally { await film.close(); }
})().catch(e => { console.error(e); process.exit(1); });
