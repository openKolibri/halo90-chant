// The French earwire (H1 in the KiCad export: HAKEN hook wire, KUGEL bead, FEDER coil, FIXIERSCHLAUCH
// silicone stopper). It is always the original STEP geometry; these helpers only name its parts.

const chainOf = o => { const c = []; for (let p = o; p; p = p.parent) c.push(p.name || ''); return c; };

export function isStopper(o) { return chainOf(o).some(n => n.startsWith('FIXIERSCHLAUCH')); }
export function hookPartOf(o) {
  const n = chainOf(o).find(s => /^(HAKEN|KUGEL|FEDER|FIXIERSCHLAUCH)/.test(s));
  return n ? n.split('_')[0] : 'other';
}
