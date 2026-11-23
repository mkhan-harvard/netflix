import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadTime, RTT, makeContent, makeSizes, simulate, runScenario, runBatch,
  nominalController, bufferBasedController, BBA_RESERVOIR, BBA_CUSHION, LADDER, SEG, VBR_CAP,
} from '../assets/sim.js';

test('download time on a constant link is size / rate plus request overhead', () => {
  const bw = new Array(100).fill(4000); // 4 Mbps
  const t = downloadTime(bw, 0.5, 8_000_000); // 8 Mbit
  assert.ok(Math.abs(t - (2 + RTT)) < 1e-9);
});

test('download time integrates across a bandwidth change', () => {
  const bw = [1000, 3000, 3000]; // kbps per second
  // starting at t=0: 1 Mbit in the first second, remaining 2 Mbit takes 2/3 s
  const t = downloadTime(bw, 0, 3_000_000);
  assert.ok(Math.abs(t - (1 + 2 / 3 + RTT)) < 1e-9);
});

test('capped VBR never exceeds the cap', () => {
  const content = makeContent('fight', 3);
  const sizes = makeSizes(content, 'vbr', 3);
  for (const row of sizes) {
    row.forEach((bits, k) => assert.ok(bits <= LADDER[k].kbps * 1000 * SEG * VBR_CAP + 1));
  }
});

test('the player plays every segment and the buffer never goes negative', () => {
  const { results, content } = runScenario({ scenario: 'match', network: 'lte', encoding: 'vbr', seed: 9 });
  for (const r of Object.values(results)) {
    assert.equal(r.segs.length, content.complexity.length);
    assert.ok(r.segs.every((s) => s.buffer >= 0));
    assert.ok(r.rebufferS >= 0);
  }
});

test('with CBR the two controllers behave almost the same (labels match reality)', () => {
  const b = runBatch({ scenario: 'fight', network: 'evening', encoding: 'cbr', seeds: 20 });
  assert.ok(Math.abs(b.nominal.quality - b.sizeAware.quality) < 0.5);
  assert.ok(Math.abs(b.nominal.megabytes - b.sizeAware.megabytes) / b.nominal.megabytes < 0.03);
});

test('with VBR on a volatile network, size awareness reduces rebuffering on average', () => {
  const b = runBatch({ scenario: 'fight', network: 'lte', encoding: 'vbr', seeds: 40 });
  assert.ok(b.sizeAware.rebufferS < b.nominal.rebufferS);
});

test('a starved link falls to the bottom rung', () => {
  const content = makeContent('studio', 1);
  const sizes = makeSizes(content, 'cbr', 1);
  const bw = new Array(5000).fill(350);
  const r = simulate({ sizes, bw, controller: nominalController });
  assert.equal(r.segs.at(-1).rung, 0);
});

test('buffer-based player: empty buffer takes the lowest rung, a full one the highest', () => {
  assert.equal(bufferBasedController({ buffer: 0, prev: -1 }), 0);
  assert.equal(bufferBasedController({ buffer: BBA_RESERVOIR, prev: 3 }), 0);
  assert.equal(bufferBasedController({ buffer: BBA_RESERVOIR + BBA_CUSHION, prev: 0 }), LADDER.length - 1);
});

test('buffer-based player holds its rung until the target crosses a neighbouring rung', () => {
  // Find a buffer level whose target rate sits between rungs 2 and 3: the player on rung 2 stays.
  const R = LADDER.map((r) => r.kbps);
  const target = (R[2] + R[3]) / 2;
  const buffer = BBA_RESERVOIR + ((target - R[0]) / (R.at(-1) - R[0])) * BBA_CUSHION;
  assert.equal(bufferBasedController({ buffer, prev: 2 }), 2);
  // From rung 0 the same target is above rung 1, so it steps up to the highest rung below the target.
  assert.equal(bufferBasedController({ buffer, prev: 0 }), 2);
  // From rung 5 the target is below rung 4, so it steps down to the lowest rung above the target.
  assert.equal(bufferBasedController({ buffer, prev: 5 }), 3);
});

test('the batch runner reports every player', () => {
  const b = runBatch({ scenario: 'studio', network: 'wifi', encoding: 'vbr', seeds: 3 });
  for (const k of ['nominal', 'sizeAware', 'bufferBased']) assert.ok(Number.isFinite(b[k].quality));
});
