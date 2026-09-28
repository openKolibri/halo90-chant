'use strict';
// Tiny static server for the three.js film: project files, node_modules/three, and macOS system fonts.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.stl': 'model/stl', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
};

function start(port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (url.startsWith('/sysfont/')) file = path.join('/System/Library/Fonts', path.basename(url));
    else file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) && !file.startsWith('/System/Library/Fonts')) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'});
      res.end(data);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

module.exports = {start};
if (require.main === module) start(8090).then(s => console.log('serving on', s.address().port));
