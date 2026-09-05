import test from 'node:test';
import assert from 'node:assert/strict';
import { Fleet } from '../src/state/fleet.js';
import { startMockFleet, defs } from '../src/discovery/mock.js';

const fastConfig = {
  probeIntervalMs: 60,
  netIntervalMs: 20,
  pkgIntervalMs: 100000,
  journalIntervalMs: 30,
  upgradeDelayMs: 2,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('mock fleet: seeded problems surface as attention', async () => {
  const fleet = new Fleet(fastConfig);
  const probers = new Map();
  const mock = startMockFleet({ fleet, config: fastConfig, probers, broadcast: () => {} });
  try {
    await sleep(500);

    assert.equal(fleet.list().length, defs.length);

    // charlie is offline -> critical unreachable
    const charlie = fleet.get('mock-charlie');
    assert.equal(charlie.online, false);
    assert.ok(charlie.attention.some((a) => a.rule === 'unreachable' && a.severity === 'critical'),
      `expected unreachable critical, got ${JSON.stringify(charlie.attention)}`);

    // bravo is degraded -> disk + temp warnings
    const bravo = fleet.get('mock-bravo');
    assert.equal(bravo.online, true);
    assert.ok(bravo.attention.some((a) => a.rule === 'disk'),
      `expected disk attention, got ${JSON.stringify(bravo.attention)}`);
    assert.ok(bravo.attention.some((a) => a.rule === 'temp'));

    // delta has OOM kills -> oom attention; security updates -> warning
    const delta = fleet.get('mock-delta');
    assert.ok(delta.attention.some((a) => a.rule === 'oom'),
      `expected oom attention, got ${JSON.stringify(delta.attention)}`);
    assert.ok(delta.attention.some((a) => a.rule === 'security-updates'));

    // alpha is healthy -> no critical items
    const alpha = fleet.get('mock-alpha');
    assert.equal(alpha.online, true);
    assert.ok(!alpha.attention.some((a) => a.severity === 'critical'));

    // worst Pi first in sorted()
    const sorted = fleet.sorted();
    assert.equal(sorted[0].id, 'mock-charlie');

    // snapshot has the 4 pis with spark data
    const snap = fleet.snapshot();
    assert.equal(snap.pis.length, 4);
    assert.ok(Array.isArray(snap.pis.find((p) => p.id === 'mock-alpha').spark.cpu));
  } finally {
    mock.stop();
  }
});

test('mock prober: upgrade completes and clears packages', async () => {
  const fleet = new Fleet(fastConfig);
  const probers = new Map();
  const mock = startMockFleet({ fleet, config: fastConfig, probers, broadcast: () => {} });
  try {
    const delta = fleet.get('mock-delta');
    const lines = [];
    let done = null;
    await probers.get(delta.id).upgrade({
      onLine: (l) => lines.push(l),
      onDone: (ok) => (done = ok),
    });
    assert.equal(done, true);
    assert.ok(lines.length >= 5);
    assert.equal(fleet.get(delta.id).pkgs.total, 0);
    assert.equal(fleet.get(delta.id).pkgs.security, 0);
  } finally {
    mock.stop();
  }
});
