import test from 'node:test';
import assert from 'node:assert/strict';
import { Fleet } from '../src/state/fleet.js';
import { Ring } from '../src/state/ring.js';

test('Ring caps at capacity and keeps newest', () => {
  const r = new Ring(3);
  r.push(1, 1);
  r.push(2, 2);
  r.push(3, 3);
  r.push(4, 4);
  assert.equal(r.length, 3);
  assert.deepEqual(r.series(), [[2, 2], [3, 3], [4, 4]]);
  assert.equal(r.last().value, 4);
});

test('addPi is idempotent per id', () => {
  const f = new Fleet({ historyPoints: 10, netHistoryPoints: 10, journalLines: 10 });
  const a = f.addPi({ id: 'x', name: 'x', ip: '1.1.1.1' });
  const b = f.addPi({ id: 'x', name: 'x', ip: '1.1.1.1' });
  assert.equal(a, b);
  assert.equal(f.list().length, 1);
});

test('probing results: 3 failures flip online to false', () => {
  const f = new Fleet();
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  f.setProbingResult('p', true);
  f.setProbingResult('p', false, 'e1');
  f.setProbingResult('p', false, 'e2');
  assert.equal(f.get('p').online, true); // only 2 failures
  f.setProbingResult('p', false, 'e3');
  assert.equal(f.get('p').online, false);
  assert.ok(f.get('p').attention.some((a) => a.rule === 'unreachable' && a.severity === 'critical'));
  f.setProbingResult('p', true);
  assert.equal(f.get('p').online, true);
  assert.equal(f.get('p').probeFailures, 0);
});

test('updateMetrics stores latest and fills history', () => {
  const f = new Fleet({ historyPoints: 5 });
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  for (let i = 0; i < 7; i++) f.updateMetrics('p', { cpuPct: i, memPct: i, diskPct: i, tempC: i, load1: i, cores: 4, uptimeSec: i });
  assert.equal(f.get('p').hist.cpu.length, 5);
  assert.equal(f.get('p').metrics.cpuPct, 6);
  const snap = f.snapshot();
  assert.equal(snap.pis[0].spark.cpu.length, 5);
});

test('updateNetwork computes bps from counter deltas', () => {
  const f = new Fleet();
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  const pi = f.get('p');
  // Seed a previous sample 5s in the past
  pi._netPrev = { eth0: { rx: 0, tx: 0, at: Date.now() - 5000 } };
  f.updateNetwork('p', { eth0: { rx: 5_000_000, tx: 1_000_000 } });
  assert.ok(Math.abs(pi.net.eth0.rxBps - 1_000_000) < 10_000); // 1 MB/s
  assert.ok(Math.abs(pi.net.eth0.txBps - 200_000) < 10_000); // 200 KB/s
  assert.ok(pi.netHistory.eth0.length >= 1);
});

test('journal: OOM/error counts and window pruning', () => {
  const f = new Fleet({ journalLines: 100, journalWindowMs: 10_000 });
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  const t0 = Date.now();
  f.pushJournalLine('p', { at: t0, level: 'oom', unit: 'kernel', message: 'oom-killer: Killed process 1 (x)' });
  f.pushJournalLine('p', { at: t0 + 1000, level: 'error', unit: 'sshd', message: 'Failed password' });
  f.pushJournalLine('p', { at: t0 + 2000, level: 'info', unit: 'CRON', message: 'ok' });
  const j = f.get('p').journal;
  assert.equal(j.oomCount, 1);
  assert.equal(j.errorCount, 1);
  assert.ok(f.get('p').attention.some((a) => a.rule === 'oom'));

  // A line 12s after t0 pushes the window past both old lines
  f.pushJournalLine('p', { at: t0 + 12_000, level: 'info', unit: 'sys', message: 'later' });
  const j2 = f.get('p').journal;
  assert.equal(j2.oomCount, 0);
  assert.equal(j2.errorCount, 0);
});

test('packages + upgrading drive attention', () => {
  const f = new Fleet();
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  f.setPackages('p', { total: 10, security: 4, list: ['a/security 1 amd64'] });
  assert.ok(f.get('p').attention.some((a) => a.rule === 'security-updates'));
  f.setUpgrading('p', true);
  assert.ok(f.get('p').attention.some((a) => a.rule === 'upgrading'));
  f.setPackages('p', { total: 0, security: 0, list: [] });
  assert.ok(!f.get('p').attention.some((a) => a.rule === 'security-updates'));
});

test('sorted() ranks worst-first', () => {
  const f = new Fleet();
  f.addPi({ id: 'good', name: 'good', ip: '1.1.1.1' });
  f.addPi({ id: 'bad', name: 'bad', ip: '1.1.1.2' });
  f.setProbingResult('bad', false, 'e');
  f.setProbingResult('bad', false, 'e');
  f.setProbingResult('bad', false, 'e');
  const sorted = f.sorted();
  assert.equal(sorted[0].id, 'bad');
  assert.ok(sorted[0].score > sorted[1].score);
});

test('detail includes history and snapshot excludes it', () => {
  const f = new Fleet({ historyPoints: 5 });
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  f.updateMetrics('p', { cpuPct: 1, memPct: 2, diskPct: 3, tempC: 4, load1: 0.1, cores: 2, uptimeSec: 9 });
  const d = f.detail('p');
  assert.ok(Array.isArray(d.hist.cpu));
  assert.equal(f.detail('nope'), null);
  assert.ok(!('hist' in f.snapshot().pis[0]));
});

test('removePi works', () => {
  const f = new Fleet();
  f.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  assert.equal(f.removePi('p'), true);
  assert.equal(f.removePi('p'), false);
  assert.equal(f.list().length, 0);
});
