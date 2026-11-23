// UI for VBR Lab. Mounts into #lab (interactive) and #findings (summary table).
import {
  SCENARIOS, NETWORKS, LADDER, SEG, RESERVE, runScenario, runBatch,
} from './sim.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (x, d = 1) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(d));
const NS = 'http://www.w3.org/2000/svg';

// The three players. The buffer-based one is a reference design from outside the project,
// drawn dashed so the main comparison (nominal vs size-aware) stays easy to read.
const PLAYERS = [
  { key: 'nominal', label: 'Nominal', long: 'Nominal-bitrate player', color: 'var(--base)', cls: 'base' },
  { key: 'sizeAware', label: 'Size-aware', long: 'Segment-size-aware player', color: 'var(--accent)', cls: 'accent' },
  { key: 'bufferBased', label: 'Buffer-based', long: 'Buffer-based player (BBA-0)', color: 'var(--third)', cls: 'third', dash: '6 4' },
];
const shown = { bufferBased: true };
const visible = () => PLAYERS.filter((p) => p.key !== 'bufferBased' || shown.bufferBased);

function el(tag, attrs = {}, children = []) {
  const node = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

// ---------- controls ----------
function buildControls(state, onChange) {
  const select = (label, key, options) => {
    const s = el('select', { id: `lab-${key}` });
    for (const [value, o] of Object.entries(options)) s.append(el('option', { value, text: o.label }));
    s.value = state[key];
    s.addEventListener('change', () => { state[key] = s.value; onChange(); });
    return el('label', { class: 'control', for: `lab-${key}` }, [el('span', { text: label }), s]);
  };

  const enc = el('div', { class: 'control' }, [el('span', { text: 'Encoding', id: 'enc-label' })]);
  const seg = el('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'enc-label' });
  for (const [value, text] of [['vbr', 'Capped VBR'], ['cbr', 'CBR']]) {
    const input = el('input', { type: 'radio', name: 'lab-enc', value });
    if (state.encoding === value) input.checked = true;
    input.addEventListener('change', () => { state.encoding = value; onChange(); });
    seg.append(el('label', {}, [input, el('span', { text })]));
  }
  enc.append(seg);

  const seedInput = el('input', { type: 'number', min: '1', max: '9999', id: 'lab-seed', value: String(state.seed) });
  seedInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(9999, parseInt(seedInput.value, 10) || 1));
    seedInput.value = String(v);
    state.seed = v;
    onChange();
  });
  const seed = el('label', { class: 'control', for: 'lab-seed' }, [el('span', { text: 'Seed' }), seedInput]);
  const another = el('button', { type: 'button', text: 'Try another seed' });
  another.addEventListener('click', () => {
    state.seed = 1 + Math.floor(Math.random() * 9999);
    seedInput.value = String(state.seed);
    onChange();
  });

  return el('div', { class: 'controls' }, [
    select('Event', 'scenario', SCENARIOS),
    select('Network', 'network', NETWORKS),
    enc, seed, another,
  ]);
}

// ---------- charts ----------
function axes(svg, { w, h, pad, xMax, yMax, yTicks, yFmt, xLabel }) {
  const x = (v) => pad.l + (v / xMax) * (w - pad.l - pad.r);
  const y = (v) => h - pad.b - (v / yMax) * (h - pad.t - pad.b);
  for (const t of yTicks) {
    svg.append(el('svg:line', { x1: pad.l, x2: w - pad.r, y1: y(t), y2: y(t), stroke: t === 0 ? 'var(--ink)' : 'var(--grid)', 'stroke-width': 1 }));
    svg.append(el('svg:text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end', 'font-size': 12, text: yFmt(t) }));
  }
  const perTick = (w - pad.l - pad.r) / (xMax / 30);
  const step = perTick < 34 ? 90 : perTick < 52 ? 60 : 30;
  // Graph-paper verticals every 10 s, heavier at each labeled tick.
  for (let t = 0; t <= xMax; t += 10) {
    svg.append(el('svg:line', { x1: x(t), x2: x(t), y1: pad.t, y2: h - pad.b, stroke: t === 0 ? 'var(--ink)' : 'var(--grid)', 'stroke-width': t % step === 0 ? 1 : 0.5 }));
  }
  for (let t = 0; t <= xMax; t += step) {
    svg.append(el('svg:text', { x: x(t), y: h - pad.b + 18, 'text-anchor': 'middle', 'font-size': 12, text: `${t}s` }));
  }
  if (xLabel) svg.append(el('svg:text', { x: w - pad.r, y: h - 4, 'text-anchor': 'end', 'font-size': 12, text: xLabel }));
  return { x, y };
}

function pathFrom(points, x, y, step) {
  let d = '';
  points.forEach(([px, py], i) => {
    if (i === 0) d += `M${x(px).toFixed(1)},${y(py).toFixed(1)}`;
    else if (step) d += `H${x(px).toFixed(1)}V${y(py).toFixed(1)}`;
    else d += `L${x(px).toFixed(1)},${y(py).toFixed(1)}`;
  });
  return d;
}

function line(svg, points, x, y, { color, width = 2, dash, step = false, draw = false }) {
  const p = el('svg:path', {
    d: pathFrom(points, x, y, step), fill: 'none', stroke: color, 'stroke-width': width,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  });
  if (dash) p.setAttribute('stroke-dasharray', dash);
  if (draw) p.setAttribute('class', 'draw');
  svg.append(p);
  return p;
}

function animate(paths) {
  for (const p of paths) {
    const len = p.getTotalLength();
    p.style.setProperty('--len', `${Math.ceil(len)}`);
  }
}

function streamChart(host, run, width) {
  const { content, sizes } = run;
  const rung = 4; // the 5.2 Mbps rung
  const n = content.complexity.length;
  const xMax = n * SEG;
  const h = 210;
  const pad = { l: 52, r: 12, t: 26, b: 30 };
  const svg = el('svg:svg', { viewBox: `0 0 ${width} ${h}`, width, height: h, role: 'img',
    'aria-label': `Actual bitrate of the ${LADDER[rung].name} stream for each segment, against its nominal bitrate, across the scenes of the event.` });
  const yMax = 9;
  const { x, y } = axes(svg, { w: width, h, pad, xMax, yMax, yTicks: [0, 3, 6, 9], yFmt: (t) => `${t} Mbps` });
  content.scenes.forEach((s, i) => {
    if (i % 2 === 0) svg.append(el('svg:rect', { x: x(s.start * SEG), y: pad.t, width: x(s.end * SEG) - x(s.start * SEG), height: h - pad.t - pad.b, fill: 'var(--band)' }));
    const room = x(s.end * SEG) - x(s.start * SEG);
    if (room > s.name.length * 6.6 + 8) {
      svg.append(el('svg:text', { x: x(s.start * SEG) + 4, y: pad.t - 8, 'font-size': 12, text: s.name }));
    }
  });
  const nominal = LADDER[rung].kbps / 1000;
  line(svg, [[0, nominal], [xMax, nominal]], x, y, { color: 'var(--muted)', width: 1.25, dash: '5 4' });
  svg.append(el('svg:text', { x: pad.l + 6, y: y(nominal) - 6, 'font-size': 12, text: `nominal, ${LADDER[rung].name}` }));
  const pts = sizes.map((row, i) => [i * SEG, row[rung] / SEG / 1e6]);
  pts.push([xMax, pts.at(-1)[1]]);
  line(svg, pts, x, y, { color: 'var(--ink)', width: 1.5, step: true });
  host.replaceChildren(svg);
}

function fetchChart(host, run, width) {
  const { bw, results } = run;
  const endT = Math.max(...visible().map((p) => results[p.key].segs.at(-1).at));
  const xMax = Math.ceil(endT / 30) * 30;
  const h = 230;
  const pad = { l: 52, r: 12, t: 12, b: 30 };
  const svg = el('svg:svg', { viewBox: `0 0 ${width} ${h}`, width, height: h, role: 'img',
    'aria-label': 'Bitrate of each segment fetched by each player over time, against network capacity.' });
  const yMax = 14;
  const { x, y } = axes(svg, { w: width, h, pad, xMax, yMax, yTicks: [0, 4, 8, 12], yFmt: (t) => `${t} Mbps` });
  const area = bw.slice(0, xMax + 1).map((v, s) => [s, Math.min(v / 1000, yMax)]);
  const d = `${pathFrom(area, x, y, true)}V${y(0)}H${x(0)}Z`;
  svg.append(el('svg:path', { d, fill: 'var(--band)', stroke: 'none' }));
  svg.append(el('svg:path', { d: pathFrom(area, x, y, true), fill: 'none', stroke: 'var(--rule)', 'stroke-width': 1.25 }));
  const toPts = (segs) => segs.map((s) => [s.at, Math.min(s.kbps / 1000, yMax)]);
  const paths = visible().map((p) => line(svg, toPts(results[p.key].segs), x, y,
    { color: p.color, width: p.dash ? 1.5 : 2, dash: p.dash, step: true, draw: !p.dash }));
  host.replaceChildren(svg);
  animate(paths);
}

function bufferChart(host, run, width) {
  const { results } = run;
  const endT = Math.max(...visible().map((p) => results[p.key].segs.at(-1).at));
  const xMax = Math.ceil(endT / 30) * 30;
  const h = 222;
  const pad = { l: 52, r: 12, t: 12, b: 30 };
  const svg = el('svg:svg', { viewBox: `0 0 ${width} ${h}`, width, height: h, role: 'img',
    'aria-label': 'Seconds of video buffered by each player over time, with stalls marked.' });
  const peak = Math.max(...visible().flatMap((p) => results[p.key].segs.map((s) => s.buffer)));
  const yMax = Math.max(10, Math.ceil(peak / 5) * 5);
  const yTicks = [];
  for (let t = 0; t <= yMax; t += 5) yTicks.push(t);
  const { x, y } = axes(svg, { w: width, h, pad, xMax, yMax, yTicks, yFmt: (t) => `${t}s` });
  line(svg, [[0, RESERVE], [xMax, RESERVE]], x, y, { color: 'var(--muted)', width: 1, dash: '3 4' });
  svg.append(el('svg:text', { x: pad.l + 6, y: y(RESERVE) + 15, 'font-size': 12, text: 'planning reserve, 2.5s' }));
  const paths = [];
  visible().forEach((p, row) => {
    const segs = results[p.key].segs;
    paths.push(line(svg, segs.map((s) => [s.at, s.buffer]), x, y, { color: p.color, width: p.dash ? 1.5 : 2, dash: p.dash, draw: !p.dash }));
    const rowY = h - pad.b - 4 - row * 8;
    for (const s of segs) {
      if (s.stall > 0.05) {
        const cx = x(s.at);
        svg.append(el('svg:path', { d: `M${cx - 4},${rowY - 4}L${cx + 4},${rowY + 4}M${cx - 4},${rowY + 4}L${cx + 4},${rowY - 4}`, stroke: p.color, 'stroke-width': 1.75, 'stroke-linecap': 'round' },
          [el('svg:title', { text: `${p.label} player stalled ${s.stall.toFixed(1)}s` })]));
      }
    }
  });
  host.replaceChildren(svg);
  animate(paths);
}

// ---------- tables ----------
const METRICS = [
  { key: 'rebufferS', label: 'Time spent rebuffering', unit: 's', d: 1, lower: true },
  { key: 'rebuffers', label: 'Rebuffer events', unit: '', d: 0, lower: true },
  { key: 'quality', label: 'Average quality score', unit: '', d: 1, lower: false },
  { key: 'megabytes', label: 'Data transferred', unit: ' MB', d: 0, lower: true },
  { key: 'switches', label: 'Bitrate switches', unit: '', d: 0, lower: true },
];

function compareTable(caption, r, digitsBoost = 0) {
  const tbody = el('tbody');
  const cols = visible();
  for (const m of METRICS) {
    const d = m.key === 'rebuffers' || m.key === 'switches' ? m.d + digitsBoost : m.d;
    const vals = cols.map((p) => r[p.key][m.key]);
    const best = m.lower ? Math.min(...vals) : Math.max(...vals);
    const spread = Math.max(...vals) - Math.min(...vals);
    tbody.append(el('tr', {}, [
      el('td', { text: m.label }),
      ...vals.map((v) => el('td', { text: `${fmt(v, d)}${m.unit}`, class: spread > 1e-6 && Math.abs(v - best) < 1e-9 ? 'better' : '' })),
    ]));
  }
  return el('div', { class: 'scroll-x' }, el('table', { class: 'data' }, [
    el('caption', { text: caption }),
    el('thead', {}, el('tr', {}, [el('th', { text: 'Metric', scope: 'col' }), ...cols.map((p) => el('th', { text: p.label, scope: 'col' }))])),
    tbody,
  ]));
}

// ---------- mount ----------
export function mountLab(root) {
  // Seed 16 is a typical run for these settings (close to the 50-seed average), not a best case.
  const state = { scenario: 'fight', network: 'lte', encoding: 'vbr', seed: 16 };
  const controls = buildControls(state, render);
  const toggle = el('input', { type: 'checkbox', id: 'lab-bba', checked: '' });
  toggle.addEventListener('change', () => { shown.bufferBased = toggle.checked; render(); });
  const legend = el('div', { class: 'legend' }, [
    ...PLAYERS.map((p) => el('span', { class: `key ${p.cls}`, 'aria-hidden': 'true' }, [el('span', { class: 'swatch' }), el('span', { class: 't', text: p.long })])),
    el('label', { class: 'toggle', for: 'lab-bba' }, [toggle, el('span', { text: 'Show the buffer-based player' })]),
  ]);
  const c1 = el('div', { class: 'chart-svg' });
  const c2 = el('div', { class: 'chart-svg' });
  const c3 = el('div', { class: 'chart-svg' });
  const single = el('div');
  const batch = el('div');
  root.replaceChildren(
    controls, legend,
    el('div', { class: 'chart' }, [el('h3', { text: 'What the encoder sends' }),
      el('p', { class: 'note', text: 'Actual bitrate of the 5.2 Mbps stream, segment by segment. Under capped VBR it sinks on easy scenes and rises above its label on hard ones.' }), c1]),
    el('div', { class: 'chart' }, [el('h3', { text: 'What each player fetched' }),
      el('p', { class: 'note', text: 'Real bitrate of every segment each player downloaded. The shaded area is the network capacity at that moment.' }), c2]),
    el('div', { class: 'chart' }, [el('h3', { text: 'Buffer, and where playback stalled' }),
      el('p', { class: 'note', text: 'Seconds of video waiting to play. Each × marks a stall, in that player’s colour. Live playback caps the buffer, because the player can’t download past the live edge.' }), c3]),
    el('div', { class: 'results' }, [single, batch]),
  );

  let last = null;
  function draw() {
    if (!last) return;
    const width = Math.max(260, Math.floor(c1.clientWidth || root.clientWidth));
    streamChart(c1, last, width);
    fetchChart(c2, last, width);
    bufferChart(c3, last, width);
  }
  function render() {
    last = runScenario(state);
    draw();
    single.replaceChildren(
      compareTable(`This run (seed ${state.seed})`, last.results),
      el('p', { class: 'batch-line muted', text: 'One run depends on its random network and scene trace, so it can go either way. The 50-seed average is the fair comparison.' }),
    );
    const b = runBatch({ ...state, seeds: 50 });
    batch.replaceChildren(
      compareTable('Average of 50 seeds, same settings', b, 1),
      el('p', { class: 'batch-line muted', text: `The size-aware player rebuffered no more than the nominal player in ${Math.round(b.sizeAwareNoWorseShare * 50)} of 50 runs.` }),
    );
  }
  let lastW = 0;
  new ResizeObserver(() => {
    const w = c1.clientWidth;
    if (Math.abs(w - lastW) > 4) { lastW = w; draw(); }
  }).observe(c1);
  render();
}

export function mountFindings(root) {
  const tbody = el('tbody');
  for (const [sk, sc] of Object.entries(SCENARIOS)) {
    for (const [nk, n] of Object.entries(NETWORKS)) {
      const b = runBatch({ scenario: sk, network: nk, encoding: 'vbr', seeds: 50 });
      const cells = (metric, d, unit, lower) => {
        const vals = PLAYERS.map((p) => b[p.key][metric]);
        const best = lower ? Math.min(...vals) : Math.max(...vals);
        const spread = Math.max(...vals) - Math.min(...vals);
        const show = (v) => (v > 0 && v < 0.05 ? `<0.1${unit}` : `${fmt(v, d)}${unit}`);
        return vals.map((v, i) => el('td', { text: show(v),
          class: [spread > 0.05 && Math.abs(v - best) < 1e-9 ? 'better' : '', i === 0 && metric === 'quality' ? 'split' : ''].join(' ').trim() }));
      };
      tbody.append(el('tr', {}, [
        el('td', { text: `${sc.label}, ${n.short}` }),
        ...cells('rebufferS', 1, 's', true),
        ...cells('quality', 1, '', false),
      ]));
    }
  }
  const heads = PLAYERS.map((p) => el('th', { text: p.label, scope: 'col' }));
  root.replaceChildren(el('div', { class: 'scroll-x' }, el('table', { class: 'data findings-table' }, [
    el('caption', { text: 'Capped VBR, average of 50 seeds per row; the best value in each group is highlighted. Computed in your browser when this page loaded.' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Event and network', scope: 'col', rowspan: '2' }),
        el('th', { text: 'Time rebuffering', scope: 'colgroup', colspan: '3', class: 'group' }),
        el('th', { text: 'Average quality score', scope: 'colgroup', colspan: '3', class: 'group split' }),
      ]),
      el('tr', {}, [...heads, ...PLAYERS.map((p, i) => el('th', { text: p.label, scope: 'col', class: i === 0 ? 'split' : '' }))]),
    ]),
    tbody,
  ])));
}

const labRoot = $('#lab');
if (labRoot) mountLab(labRoot);
const findingsRoot = $('#findings');
if (findingsRoot) mountFindings(findingsRoot);
