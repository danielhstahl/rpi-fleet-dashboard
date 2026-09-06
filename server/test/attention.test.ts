import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAttention, scoreItems, WEIGHTS } from '../src/state/attention.js';
import type { AttentionInput } from '../src/state/attention.js';
import type { Metrics } from '../src/types.js';

const base = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  online: true,
  probeFailures: 0,
  lastProbeError: null,
  metrics: null,
  pkgs: { total: 0, security: 0 },
  journal: { oomCount: 0, errorCount: 0 },
  ...over,
});

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  at: Date.now(),
  uptimeSec: 1000,
  load1: 0.5,
  cores: 4,
  memPct: 40,
  diskPct: 50,
  cpuPct: 10,
  tempC: 50,
  ip: '10.0.0.2',
  ...over,
});

test('healthy Pi produces no attention items', () => {
  const items = evaluateAttention(base({ metrics: metrics() }));
  assert.equal(items.length, 0);
});

test('disk: >=95 critical, >=85 warning', () => {
  assert.ok(evaluateAttention(base({ metrics: metrics({ diskPct: 96 }) })).some((i) => i.rule === 'disk' && i.severity === 'critical'));
  assert.ok(evaluateAttention(base({ metrics: metrics({ diskPct: 88 }) })).some((i) => i.rule === 'disk' && i.severity === 'warning'));
  assert.ok(!evaluateAttention(base({ metrics: metrics({ diskPct: 80 }) })).some((i) => i.rule === 'disk'));
});

test('temperature: >=85 critical (throttling), >=75 warning', () => {
  assert.ok(evaluateAttention(base({ metrics: metrics({ tempC: 86 }) })).some((i) => i.rule === 'temp' && i.severity === 'critical'));
  assert.ok(evaluateAttention(base({ metrics: metrics({ tempC: 76 }) })).some((i) => i.rule === 'temp' && i.severity === 'warning'));
  assert.ok(!evaluateAttention(base({ metrics: metrics({ tempC: null }) })).some((i) => i.rule === 'temp'));
});

test('memory >=95 warning', () => {
  assert.ok(evaluateAttention(base({ metrics: metrics({ memPct: 96 }) })).some((i) => i.rule === 'memory'));
});

test('load per-core: >=6 critical, >=3 warning', () => {
  assert.ok(evaluateAttention(base({ metrics: metrics({ load1: 12, cores: 2 }) })).some((i) => i.rule === 'load' && i.severity === 'critical'));
  assert.ok(evaluateAttention(base({ metrics: metrics({ load1: 8, cores: 2 }) })).some((i) => i.rule === 'load' && i.severity === 'warning'));
});

test('unreachable: 3+ failures critical, 1-2 warning', () => {
  const crit = evaluateAttention(base({ online: false, probeFailures: 3, lastProbeError: 'ECONNREFUSED' }));
  assert.ok(crit.some((i) => i.rule === 'unreachable' && i.severity === 'critical'));
  const warn = evaluateAttention(base({ online: true, probeFailures: 1, lastProbeError: 'timeout' }));
  assert.ok(warn.some((i) => i.rule === 'unstable' && i.severity === 'warning'));
});

test('stale telemetry warns after 5 min', () => {
  const stale = base({ metrics: metrics({ at: Date.now() - 6 * 60 * 1000 }) });
  assert.ok(evaluateAttention(stale).some((i) => i.rule === 'stale'));
});

test('packages: security updates warning, plain updates info', () => {
  assert.ok(evaluateAttention(base({ pkgs: { total: 12, security: 8 } })).some((i) => i.rule === 'security-updates' && i.severity === 'warning'));
  assert.ok(evaluateAttention(base({ pkgs: { total: 3, security: 0 } })).some((i) => i.rule === 'updates' && i.severity === 'info'));
});

test('journal: OOM kills and error flood warn', () => {
  assert.ok(evaluateAttention(base({ journal: { oomCount: 2 } })).some((i) => i.rule === 'oom'));
  assert.ok(evaluateAttention(base({ journal: { errorCount: 25 } })).some((i) => i.rule === 'journal-errors'));
  assert.ok(!evaluateAttention(base({ journal: { errorCount: 5 } })).some((i) => i.rule === 'journal-errors'));
});

test('score weights: critical 100, warning 25, info 1', () => {
  assert.equal(WEIGHTS.critical, 100);
  assert.equal(WEIGHTS.warning, 25);
  assert.equal(WEIGHTS.info, 1);
  assert.equal(scoreItems([{ severity: 'critical' }, { severity: 'warning' }, { severity: 'info' }]), 126);
  assert.equal(scoreItems([]), 0);
});

test('items sorted worst-first', () => {
  const items = evaluateAttention(base({
    online: false,
    probeFailures: 5,
    metrics: metrics({ diskPct: 97 }),
    pkgs: { total: 2, security: 0 },
  }));
  const sev = items.map((i) => i.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => (a > b ? 1 : -1)));
  assert.equal(items[0]!.severity, 'critical');
});
