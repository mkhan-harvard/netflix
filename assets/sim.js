// VBR Lab — a small simulator for adaptive bitrate (ABR) decisions in live streaming.
//
// Question it explores: when live video is encoded with capped VBR, a stream's real
// bitrate can sit far below or above its nominal ("on the label") bitrate for long
// stretches. Does an ABR controller that looks at the actual sizes of the next few
// segments beat one that trusts the nominal bitrate?
//
// Everything here is a simplified model. The ladder, quality scores, scenes and network
// traces are illustrative, not Netflix data. See README for the assumptions.

export const SEG = 2; // seconds of video per segment
export const LIVE_LATENCY_SEGS = 4; // player starts this many segments behind the live edge
export const STARTUP_SEGS = 2; // segments buffered before playback starts
export const RTT = 0.05; // seconds of request overhead per segment
export const VBR_CAP = 1.6; // capped VBR: a segment never exceeds 1.6x its nominal bitrate
export const VBR_FLOOR = 0.12;

// Nominal bitrates (kbps) and an illustrative perceptual quality score per rung.
// With quality-targeted VBR, quality tracks the rung rather than the scene.
export const LADDER = [
  { kbps: 400, name: '400 kbps', q: 38 },
  { kbps: 900, name: '900 kbps', q: 55 },
  { kbps: 1800, name: '1.8 Mbps', q: 70 },
  { kbps: 3200, name: '3.2 Mbps', q: 81 },
  { kbps: 5200, name: '5.2 Mbps', q: 89 },
  { kbps: 8000, name: '8 Mbps', q: 94 },
];

// ---------- deterministic randomness ----------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------- content: how hard each segment is to compress ----------
// complexity 1.0 means "needs about the nominal bitrate"; 0.2 is a static card; 1.5 is confetti.
export const SCENARIOS = {
  fight: {
    label: 'Fight night',
    scenes: [
      { name: 'Waiting room', secs: 50, c: 0.18, vol: 0.05 },
      { name: 'Walkouts', secs: 40, c: 0.75, vol: 0.15 },
      { name: 'Round 1', secs: 60, c: 1.25, vol: 0.18 },
      { name: 'Corner break', secs: 20, c: 0.55, vol: 0.1 },
      { name: 'Round 2', secs: 60, c: 1.3, vol: 0.2 },
      { name: 'Confetti', secs: 30, c: 1.55, vol: 0.12 },
    ],
  },
  studio: {
    label: 'Studio talk show',
    scenes: [
      { name: 'Cold open', secs: 30, c: 0.9, vol: 0.15 },
      { name: 'Desk interview', secs: 90, c: 0.45, vol: 0.08 },
      { name: 'Musical guest', secs: 60, c: 1.2, vol: 0.2 },
      { name: 'Desk interview', secs: 80, c: 0.45, vol: 0.08 },
    ],
  },
  match: {
    label: 'Live match',
    scenes: [
      { name: 'Pregame panel', secs: 40, c: 0.5, vol: 0.1 },
      { name: 'First half', secs: 100, c: 1.1, vol: 0.25 },
      { name: 'Halftime card', secs: 30, c: 0.2, vol: 0.05 },
      { name: 'Second half', secs: 100, c: 1.15, vol: 0.25 },
    ],
  },
};

export function makeContent(scenarioKey, seed) {
  const r = rng(seed * 7 + 1);
  const scenario = SCENARIOS[scenarioKey];
  const c = [];
  const scenes = [];
  for (const s of scenario.scenes) {
    const start = c.length;
    const n = Math.round(s.secs / SEG);
    let drift = 0;
    for (let i = 0; i < n; i++) {
      drift = 0.7 * drift + s.vol * gauss(r); // correlated wobble within a scene
      c.push(clamp(s.c * (1 + drift), VBR_FLOOR, 2.5));
    }
    scenes.push({ name: s.name, start, end: c.length });
  }
  return { complexity: c, scenes, label: scenario.label };
}

// Segment sizes in bits: sizes[i][rung].
// CBR stays near nominal. Capped VBR follows scene complexity; higher rungs swing more
// because low rungs are already starved of bits on hard scenes.
export function makeSizes(content, encoding, seed) {
  const r = rng(seed * 13 + 5);
  const R = LADDER.length;
  return content.complexity.map((cx) => {
    const noise = gauss(r);
    return LADDER.map((rung, k) => {
      let f;
      if (encoding === 'cbr') {
        f = clamp(1 + 0.04 * noise, 0.9, 1.1);
      } else {
        const swing = 0.55 + 0.45 * (k / (R - 1));
        f = clamp(1 + (cx * (1 + 0.08 * noise) - 1) * swing, VBR_FLOOR, VBR_CAP);
      }
      return rung.kbps * 1000 * f * SEG;
    });
  });
}

// ---------- network: available throughput per second, kbps ----------
export const NETWORKS = {
  wifi: { label: 'Home Wi-Fi, steady', short: 'steady home Wi-Fi' },
  evening: { label: 'Busy evening Wi-Fi', short: 'busy evening Wi-Fi' },
  lte: { label: 'Phone on LTE', short: 'phone on LTE' },
};

export function makeNetwork(key, seconds, seed) {
  const r = rng(seed * 31 + 11);
  const bw = [];
  let walk = 0;
  let dropLeft = 0;
  for (let s = 0; s < seconds; s++) {
    let v;
    if (key === 'wifi') {
      v = 7000 * (1 + 0.07 * gauss(r));
    } else if (key === 'evening') {
      walk = 0.85 * walk + 0.15 * gauss(r);
      v = 5600 + 1800 * Math.sin((2 * Math.PI * s) / 75 + seed) + 900 * walk;
    } else {
      walk = clamp(walk + 0.12 * gauss(r), -1, 1);
      v = 4800 + 3000 * walk;
      if (dropLeft === 0 && r() < 0.015) dropLeft = 4 + Math.floor(r() * 6);
      if (dropLeft > 0) {
        v = 700 + 300 * r();
        dropLeft--;
      }
    }
    bw.push(clamp(v, 300, 20000));
  }
  return bw;
}

// Seconds to download `bits` starting at wall time t0 over a per-second bandwidth trace.
export function downloadTime(bw, t0, bits) {
  let t = t0;
  let left = bits;
  while (left > 0) {
    const s = Math.floor(t);
    const rate = bw[Math.min(s, bw.length - 1)] * 1000;
    const capacity = rate * (s + 1 - t);
    if (capacity >= left) {
      t += left / rate;
      left = 0;
    } else {
      left -= capacity;
      t = s + 1;
    }
  }
  return t - t0 + RTT;
}

// ---------- ABR controllers ----------
// Both controllers run the SAME decision rule, so the comparison isolates one variable:
// what the controller believes the next segments will cost.
//
// Rule: for each rung from the top down, play the next LOOKAHEAD segments forward in time
// at 90% of estimated throughput. Pick the highest rung that never lets the buffer fall
// below RESERVE seconds. Step up at most one rung per segment (steps down are immediate),
// which keeps the picture from flickering between rungs. Stepping up also has to clear
// UP_MARGIN extra seconds of reserve, so the player doesn't climb to a rung it will drop
// from two segments later.
export const LOOKAHEAD = 3;
export const RESERVE = 2.5; // seconds
export const MARGIN = 0.9;
export const UP_MARGIN = 2; // seconds

function plan({ est, buffer, i, nSeg, prev, costOf }) {
  const rate = MARGIN * est * 1000; // bits per second
  const top = prev < 0 ? LADDER.length - 1 : Math.min(LADDER.length - 1, prev + 1);
  for (let k = top; k > 0; k--) {
    const reserve = k > prev && prev >= 0 ? RESERVE + UP_MARGIN : RESERVE;
    let b = buffer;
    let ok = true;
    for (let j = i; j < Math.min(i + LOOKAHEAD, nSeg); j++) {
      b -= costOf(j, k) / rate + RTT;
      if (b < reserve) {
        ok = false;
        break;
      }
      b += SEG;
    }
    if (ok) return k;
  }
  return 0;
}

// Baseline: every segment is assumed to cost exactly its nominal bitrate (what the label says).
export function nominalController(state) {
  return plan({ ...state, costOf: (j, k) => LADDER[k].kbps * 1000 * SEG });
}

// Size-aware: uses the real size of each upcoming segment the server has already published.
// For segments past the live edge (not encoded yet), assume the most recent known ratio of
// actual-to-nominal size, but never less than nominal, so the guess errs on the safe side.
export function sizeAwareController(state) {
  const { knownBits, i, nSeg } = state;
  return plan({
    ...state,
    costOf: (j, k) => {
      const nominal = LADDER[k].kbps * 1000 * SEG;
      const known = knownBits(j, k);
      if (known != null) return known;
      for (let back = Math.min(j, nSeg) - 1; back >= i; back--) {
        const seen = knownBits(back, k);
        if (seen != null) return nominal * Math.max(seen / nominal, 1);
      }
      return nominal;
    },
  });
}

// Reference point from outside this project: a buffer-based player, BBA-0 from Huang et al.,
// "A Buffer-Based Approach to Rate Adaptation" (SIGCOMM 2014, Stanford and Netflix).
// It ignores throughput entirely and maps buffer level to bitrate:
//   buffer <= RESERVOIR                -> lowest rung
//   buffer >= RESERVOIR + CUSHION      -> highest rung
//   in between                         -> a target rate on a straight line from lowest to highest
// It moves only when the target crosses the next rung up or down (hysteresis), as in BBA-0.
// The paper's buffers were minutes long; live keeps at most LIVE_LATENCY_SEGS * SEG = 8 s,
// so the thresholds are set from that cap: the reservoir is one segment, and the top rung is
// reached half a segment before the cap. They were chosen from the cap, not tuned on results.
export const BBA_RESERVOIR = SEG; // 2 s
export const BBA_CUSHION = LIVE_LATENCY_SEGS * SEG - SEG / 2 - BBA_RESERVOIR; // 5 s, so the top rung is reached at 7 s

export function bufferBasedController({ buffer, prev }) {
  const R = LADDER.map((r) => r.kbps);
  const last = R.length - 1;
  if (buffer <= BBA_RESERVOIR) return 0;
  if (buffer >= BBA_RESERVOIR + BBA_CUSHION) return last;
  const target = R.at(0) + ((buffer - BBA_RESERVOIR) / BBA_CUSHION) * (R.at(-1) - R.at(0));
  const cur = prev < 0 ? 0 : prev;
  const up = Math.min(cur + 1, last);
  const down = Math.max(cur - 1, 0);
  if (target >= R.at(up) && up !== cur) {
    let k = cur; // highest rung strictly below the target
    while (k + 1 <= last && R.at(k + 1) < target) k++;
    return k;
  }
  if (target <= R.at(down) && down !== cur) {
    let k = cur; // lowest rung strictly above the target
    while (k - 1 >= 0 && R.at(k - 1) > target) k--;
    return k;
  }
  return cur;
}

export const CONTROLLERS = {
  nominal: { label: 'Nominal bitrate', fn: nominalController },
  sizeAware: { label: 'Segment-size aware', fn: sizeAwareController },
  bufferBased: { label: 'Buffer-based (BBA-0)', fn: bufferBasedController },
};

// ---------- the player ----------
export function simulate({ sizes, bw, controller }) {
  const nSeg = sizes.length;
  const avail = (i) => Math.max(0, i - LIVE_LATENCY_SEGS + 1) * SEG; // live edge
  let now = 0;
  let buffer = 0;
  let playing = false;
  let stalled = false;
  let startup = null;
  let rebufferS = 0;
  let rebuffers = 0;
  let bits = 0;
  let switches = 0;
  let qSum = 0;
  let prev = -1;
  const samples = [];
  const segs = [];

  const drain = (dt) => {
    if (!playing) return 0;
    if (buffer >= dt) {
      buffer -= dt;
      return 0;
    }
    const stallTime = dt - buffer;
    buffer = 0;
    if (!stalled) rebuffers++;
    stalled = true;
    rebufferS += stallTime;
    return stallTime;
  };

  for (let i = 0; i < nSeg; i++) {
    let stallHere = 0;
    if (avail(i) > now) {
      stallHere += drain(avail(i) - now);
      now = avail(i);
    }
    // Harmonic mean of the last 5 measured throughputs: one fast download can't inflate it.
    const est = samples.length ? samples.length / samples.reduce((a, x) => a + 1 / x, 0) : 1500;
    const knownBits = (j, k) => (j < nSeg && avail(j) <= now ? sizes[j][k] : null);
    const k = controller({ est, buffer, i, knownBits, nSeg, prev });
    const segBits = sizes[i][k];
    const dt = downloadTime(bw, now, segBits);
    stallHere += drain(dt);
    now += dt;
    buffer += SEG;
    if (stalled) stalled = false;
    if (!playing && buffer >= STARTUP_SEGS * SEG) {
      playing = true;
      startup = now;
    }
    samples.push(segBits / (dt - RTT) / 1000);
    if (samples.length > 5) samples.shift();
    bits += segBits;
    if (prev !== -1 && k !== prev) switches++;
    prev = k;
    qSum += LADDER[k].q;
    segs.push({ i, rung: k, kbps: segBits / SEG / 1000, buffer, stall: stallHere, at: now });
  }
  return {
    segs,
    rebufferS,
    rebuffers,
    startup,
    switches,
    quality: qSum / nSeg,
    megabytes: bits / 8 / 1e6,
  };
}

export function runScenario({ scenario, network, encoding, seed }) {
  const content = makeContent(scenario, seed);
  const sizes = makeSizes(content, encoding, seed);
  const bw = makeNetwork(network, content.complexity.length * SEG * 4 + 120, seed);
  const results = {};
  for (const [key, c] of Object.entries(CONTROLLERS)) {
    results[key] = simulate({ sizes, bw, controller: c.fn });
  }
  return { content, sizes, bw, results };
}

// Run many seeds so a single lucky trace can't decide the comparison.
export function runBatch({ scenario, network, encoding, seeds = 50, firstSeed = 1 }) {
  const rows = Object.fromEntries(Object.keys(CONTROLLERS).map((k) => [k, []]));
  let sizeAwareWinsOrTies = 0;
  for (let s = firstSeed; s < firstSeed + seeds; s++) {
    const { results } = runScenario({ scenario, network, encoding, seed: s });
    for (const k of Object.keys(rows)) rows[k].push(results[k]);
    if (results.sizeAware.rebufferS <= results.nominal.rebufferS + 1e-9) sizeAwareWinsOrTies++;
  }
  const mean = (arr, f) => arr.reduce((a, x) => a + f(x), 0) / arr.length;
  const summary = (arr) => ({
    rebufferS: mean(arr, (x) => x.rebufferS),
    rebuffers: mean(arr, (x) => x.rebuffers),
    quality: mean(arr, (x) => x.quality),
    megabytes: mean(arr, (x) => x.megabytes),
    switches: mean(arr, (x) => x.switches),
  });
  return {
    seeds,
    ...Object.fromEntries(Object.entries(rows).map(([k, arr]) => [k, summary(arr)])),
    sizeAwareNoWorseShare: sizeAwareWinsOrTies / seeds,
  };
}
