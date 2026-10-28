// A small SVG two-well free-energy figure: G(x) = B(x²−1)² − T·x, with a ball
// that sits in a well and rolls over the barrier when the protein switches.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

export class Landscape {
  constructor(host, { left = 'A', right = 'B', height = 150 } = {}) {
    this.W = 320; this.H = height;
    this.svg = el('svg', { viewBox: `0 0 ${this.W} ${this.H}`, class: 'landscape', role: 'img' }, host);
    const defs = el('defs', {}, this.svg);
    const g = el('linearGradient', { id: 'lg' + Math.random().toString(36).slice(2, 7), x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    el('stop', { offset: '0%', 'stop-color': 'var(--helix)' }, g);
    el('stop', { offset: '100%', 'stop-color': 'var(--strand)' }, g);
    this.fillPath = el('path', { class: 'ls-fill' }, this.svg);
    this.path = el('path', { class: 'ls-curve', stroke: `url(#${g.id})` }, this.svg);
    this.barrierLine = el('line', { class: 'ls-barrier' }, this.svg);
    this.barrierText = el('text', { class: 'ls-note', 'text-anchor': 'middle' }, this.svg);
    this.ball = el('circle', { r: 7, class: 'ls-ball' }, this.svg);
    this.lt = el('text', { class: 'ls-label helix', 'text-anchor': 'middle' }, this.svg); this.lt.textContent = left;
    this.rt = el('text', { class: 'ls-label strand', 'text-anchor': 'middle' }, this.svg); this.rt.textContent = right;
    el('text', { x: 6, y: 14, class: 'ls-axis' }, this.svg).textContent = 'free energy';
    this.svg.setAttribute('aria-label', `Energy landscape with two wells, ${left} and ${right}`);
    this.B = 1; this.T = 0; this.x = -1;
  }

  // B: barrier height (0..1.4), T: tilt (+ favours the right well), x: ball position (-1..1)
  set(B, T, x) {
    this.B = B; this.T = T; this.x = x;
    const { W, H } = this;
    const G = u => B * (u * u - 1) ** 2 - T * u;
    const X = u => W / 2 + u * W * 0.36;
    const lo = -0.9, hi = 1.6;
    const Y = v => H - 24 - ((v - lo) / (hi - lo)) * (H - 44);
    let d = '';
    for (let i = 0; i <= 90; i++) { const u = -1.42 + (2.84 * i) / 90; d += (i ? 'L' : 'M') + X(u).toFixed(1) + ' ' + Y(G(u)).toFixed(1); }
    this.path.setAttribute('d', d);
    this.fillPath.setAttribute('d', d + `L${X(1.42)} ${H - 18}L${X(-1.42)} ${H - 18}Z`);
    const bx = Math.max(-1.35, Math.min(1.35, x));
    this.ball.setAttribute('cx', X(bx)); this.ball.setAttribute('cy', Y(G(bx)) - 7);
    this.ball.setAttribute('class', 'ls-ball ' + (x > 0 ? 'strand' : 'helix'));
    // barrier height marker from the current well to the top of the hump
    const well = x > 0 ? 1 : -1, top = G(0);
    this.barrierLine.setAttribute('x1', X(0)); this.barrierLine.setAttribute('x2', X(0));
    this.barrierLine.setAttribute('y1', Y(top)); this.barrierLine.setAttribute('y2', Y(G(well)));
    this.barrierText.setAttribute('x', X(0)); this.barrierText.setAttribute('y', Y(top) - 8);
    this.lt.setAttribute('x', X(-1)); this.lt.setAttribute('y', H - 4);
    this.rt.setAttribute('x', X(1)); this.rt.setAttribute('y', H - 4);
  }
  note(text) { this.barrierText.textContent = text; }
}
