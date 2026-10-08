import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL, SMOKE, blockPlan, pairedDifferences, statistics, summarize } from './sampler.mjs';

test('default reference and explicitly nonqualifying smoke sizes are fixed', () => {
  assert.deepEqual([PROTOCOL.rounds, PROTOCOL.warmupBlocks, PROTOCOL.measuredBlocks], [3, 20, 100]);
  assert.deepEqual(SMOKE, { rounds: 1, warmupBlocks: 1, measuredBlocks: 2 });
  assert.deepEqual(PROTOCOL.browsers, ['chromium', 'firefox', 'webkit']);
});

test('raw ABBA and normalized ACCA are separate and alternate group precedence', () => {
  assert.deepEqual(blockPlan(0), [
    { comparison: 'raw', routes: ['on-raw', 'off-raw', 'off-raw', 'on-raw'] },
    { comparison: 'normalized', routes: ['on-raw', 'off-normalized', 'off-normalized', 'on-raw'] },
  ]);
  assert.deepEqual(blockPlan(1), [...blockPlan(0)].reverse());
  assert.throws(() => blockPlan(-1));
  assert.throws(() => blockPlan(101));
});

test('individual paired differences preserve negative samples and slow tails', () => {
  assert.deepEqual(pairedDifferences([101, 1, 10, 5]), [100, -5]);
  const groups = blockPlan(0).map(group => ({ comparison: group.comparison,
    operations: [101, 1, 10, 5].map((syncMs, index) => ({ route: group.routes[index], syncMs, settledMs: syncMs + (index === 0 ? 20 : 1) })) }));
  const summary = summarize([{ index: 0, groups, normalization: { ms: 3 } }]);
  assert.equal(summary.raw.syncMs.pairedOverheadMs.count, 2);
  assert.equal(summary.raw.syncMs.pairedOverheadMs.p95, 100);
  assert.equal(summary.raw.syncMs.blockMeanOverheadMs.p95, 47.5);
  assert.equal(summary.raw.syncMs.pairedOverheadMs.min, -5);
  assert.equal(summary.raw.settledMs.pairedOverheadMs.p95, 119);
  assert.equal(summary.normalized.syncMs.pairedOverheadMs.p95, 100);
  assert.equal(summary.normalized.settledMs.pairedOverheadMs.p95, 119);
  assert.ok(Object.isFrozen(summary.raw.syncMs));
});

test('nearest-rank percentiles do not discard outliers or mutate source samples', () => {
  const samples = Array.from({ length: 100 }, (_, index) => index + 1).reverse();
  assert.deepEqual(statistics(samples), { count: 100, min: 1, p50: 50, p95: 95, max: 100 });
  assert.equal(samples[0], 100);
});

for (const values of [[], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, NaN, 4], [1, -1, 3, 4], [1, 2, Infinity, 4], [1, 2, 60_001, 4]]) {
  test(`invalid ABBA evidence is rejected: ${JSON.stringify(values)}`, () => assert.throws(() => pairedDifferences(values)));
}

test('incomplete, nonfinite and excessively large reports cannot become summaries', () => {
  assert.throws(() => statistics([]));
  assert.throws(() => statistics([NaN]));
  assert.throws(() => statistics(Array(100_001).fill(1)));
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([{ groups: [], normalization: { ms: 1 } }]));
});

for (const mutation of ['group-order', 'route-order', 'missing-group', 'duplicate-group', 'endpoint-order', 'missing-sync', 'invalid-normalization']) {
  test(`refuses invalid protocol evidence: ${mutation}`, () => {
    const block = { index: 0, groups: blockPlan(0).map(group => ({ comparison: group.comparison,
      operations: group.routes.map(route => ({ route, syncMs: 1, settledMs: 2 })) })), normalization: { ms: 1 } };
    if (mutation === 'group-order') block.groups.reverse();
    if (mutation === 'route-order') block.groups[0].operations.reverse();
    if (mutation === 'route-order') block.groups[0].operations[0].route = 'off-normalized';
    if (mutation === 'missing-group') block.groups.pop();
    if (mutation === 'duplicate-group') block.groups[1] = structuredClone(block.groups[0]);
    if (mutation === 'endpoint-order') block.groups[0].operations[0].settledMs = 0;
    if (mutation === 'missing-sync') delete block.groups[0].operations[0].syncMs;
    if (mutation === 'invalid-normalization') block.normalization.ms = NaN;
    assert.throws(() => summarize([block]));
  });
}
