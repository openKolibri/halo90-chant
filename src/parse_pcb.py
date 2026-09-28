"""Extract HALO-90 board geometry from the KiCad PCB into JSON for the renderer.

Units stay in mm, KiCad coords (y down). LED firmware index is derived from the
charlieplex nets using the same col/row mapping as the firmware.
"""
import json, math, re, sys

def tokenize(s):
    for m in re.finditer(r'\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+', s):
        t = m.group(0)
        yield t

def parse(s):
    stack = [[]]
    for t in tokenize(s):
        if t == '(':
            stack.append([])
        elif t == ')':
            node = stack.pop()
            stack[-1].append(node)
        else:
            if t.startswith('"'):
                t = t[1:-1]
            stack[-1].append(t)
    return stack[0][0]

def find(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]

def first(node, key):
    r = find(node, key)
    return r[0] if r else None

def f(x):
    return float(x)

def rot(x, y, deg):
    a = math.radians(deg)
    # KiCad rotation is CCW on screen with y down -> negate
    c, s = math.cos(a), math.sin(a)
    return x * c + y * s, -x * s + y * c

def firmware_map():
    """(anode CPX, cathode CPX) -> firmware index. ledHigh(led) drives CPX[col] high and CPX[row] low.
    Read literally against the schematic's A/K pins, index+1 would land 9 LEDs away; the real board
    clusters (index = "angle/4", as the firmware says), which it does exactly when each LED sits the
    other way round: the lit LED is anode on `row`, cathode on `col`, and index i is D(i+1)."""
    m = {}
    for led in range(90):
        col = led // 9
        top = 9 - col
        row = 9 - (led % 9)
        if top <= (9 - row):
            row -= 1
        m[(row, col)] = led
    return m

def arc_points(cx, cy, sx, sy, ang, n=None):
    r = math.hypot(sx - cx, sy - cy)
    a0 = math.atan2(sy - cy, sx - cx)
    n = n or max(4, int(abs(ang) / 3))
    return [[cx + r * math.cos(a0 + math.radians(ang) * i / n),
             cy + r * math.sin(a0 + math.radians(ang) * i / n)] for i in range(n + 1)]

def main(src, dst):
    root = parse(open(src).read())
    nets = {int(n[1]): n[2] for n in find(root, 'net')}
    out = {'segments': [], 'vias': [], 'outline': [], 'leds': [], 'parts': [], 'silk': []}
    for seg in find(root, 'segment'):
        st, en = first(seg, 'start'), first(seg, 'end')
        out['segments'].append({
            'a': [f(st[1]), f(st[2])], 'b': [f(en[1]), f(en[2])],
            'w': f(first(seg, 'width')[1]), 'l': first(seg, 'layer')[1],
            'n': nets.get(int(first(seg, 'net')[1]), '')})
    for v in find(root, 'via'):
        at = first(v, 'at')
        out['vias'].append({'p': [f(at[1]), f(at[2])], 's': f(first(v, 'size')[1]),
                            'n': nets.get(int(first(v, 'net')[1]), '')})
    for g in find(root, 'gr_arc') + find(root, 'gr_line') + find(root, 'gr_circle'):
        layer = first(g, 'layer')[1]
        st, en = first(g, 'start'), first(g, 'end')
        if g[0] == 'gr_arc':
            pts = arc_points(f(st[1]), f(st[2]), f(en[1]), f(en[2]), f(first(g, 'angle')[1]))
        elif g[0] == 'gr_circle':
            cx, cy = f(st[1]), f(st[2])
            pts = arc_points(cx, cy, f(en[1]), f(en[2]), 360, 72)
        else:
            pts = [[f(st[1]), f(st[2])], [f(en[1]), f(en[2])]]
        (out['outline'] if layer == 'Edge.Cuts' else out['silk'] if layer == 'F.SilkS' else []).append(pts)
    fw = firmware_map()
    for fp in find(root, 'footprint'):
        at = first(fp, 'at')
        x, y = f(at[1]), f(at[2])
        r = f(at[3]) if len(at) > 3 else 0.0
        ref = next((t[2] for t in find(fp, 'fp_text') if t[1] == 'reference'), '')
        pads = []
        for p in find(fp, 'pad'):
            pat, size = first(p, 'at'), first(p, 'size')
            px, py = rot(f(pat[1]), f(pat[2]), r)
            prot = f(pat[3]) if len(pat) > 3 else r
            net = first(p, 'net')
            pads.append({'num': p[1], 'shape': p[3], 'p': [x + px, y + py], 'r': prot,
                         'w': f(size[1]), 'h': f(size[2]),
                         'n': net[2] if net else '', 'fn': (first(p, 'pinfunction') or [0, ''])[1]})
        part = {'ref': ref, 'p': [x, y], 'r': r, 'fp': fp[1], 'side': first(fp, 'layer')[1], 'pads': pads}
        if ref.startswith('D') and ref[1:].isdigit():
            an = next(pd['n'] for pd in pads if pd['fn'] == 'A')
            kn = next(pd['n'] for pd in pads if pd['fn'] == 'K')
            col, row = int(an.split('-')[1]), int(kn.split('-')[1])
            idx = fw.get((col, row))
            out['leds'].append({'ref': ref, 'p': [x, y], 'r': r, 'fw': idx, 'A': an, 'K': kn,
                                'ang': math.degrees(math.atan2(y, x))})
        out['parts'].append(part)
    out['leds'].sort(key=lambda d: d['fw'] if d['fw'] is not None else 999)
    missing = [d['ref'] for d in out['leds'] if d['fw'] is None]
    json.dump(out, open(dst, 'w'))
    print(f"segments={len(out['segments'])} vias={len(out['vias'])} parts={len(out['parts'])} "
          f"leds={len(out['leds'])} unmapped={missing} outline={len(out['outline'])}")
    for d in out['leds'][:15]:
        print(d['fw'], d['ref'], round(d['ang'], 1), d['A'], d['K'])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
