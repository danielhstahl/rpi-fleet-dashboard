import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Fleet } from '../src/state/fleet.js';
import { openFleetStore } from '../src/state/store.js';
import type { FleetStore, FleetStorageCaps } from '../src/state/store.js';

const CAPS: FleetStorageCaps = { historyPoints: 10, netHistoryPoints: 8, journalLines: 20 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(): { store: FleetStore; fleet: Fleet } {
  const store = openFleetStore(':memory:', CAPS);
  const fleet = new Fleet({ ...CAPS, journalWindowMs: 3_600_000, storage: store });
  return { store, fleet };
}

const metrics = (over: Partial<{ cpuPct: number; tempC: number | null }> = {}) => ({
  uptimeSec: 100,
  load1: 0.5,
  cores: 4,
  memPct: 40,
  diskPct: 50,
  cpuPct: 20,
  tempC: 55,
  ...over,
});

test('round-trip: membership, telemetry, journal, pkgs restore', async () => {
  const { store, fleet } = setup();
  fleet.addPi({
    id: 'p', name: 'pi-p', ip: '1.2.3.4', user: 'pi', sshHost: 'alias', sshPort: 2222, source: 'manual',
  });
  const t = Date.now();
  fleet.updateMetrics('p', { ...metrics(), at: t });
  fleet.updateMetrics('p', { ...metrics({ tempC: null }), at: t + 1000 });
  fleet.updateNetwork('p', { wlan0: { rx: 1000, tx: 100 } }); // baseline only
  await sleep(5);
  fleet.updateNetwork('p', { wlan0: { rx: 6000, tx: 1500 } }); // → one sample
  fleet.pushJournalLine('p', { at: t + 2, level: 'oom', unit: 'kernel', message: 'oom-killer: Killed 1 (x)' });
  fleet.pushJournalLine('p', { at: t + 3, level: 'info', unit: 'sys', message: 'boot ok' });
  fleet.setPackages('p', { total: 3, security: 1, list: ['a:security 1 amd64'] });

  const data = store.loadAll();
  assert.equal(data.pis.length, 1);
  assert.deepEqual(
    {
      ip: data.pis[0]!.ip,
      user: data.pis[0]!.user,
      sshHost: data.pis[0]!.sshHost,
      sshPort: data.pis[0]!.sshPort,
      source: data.pis[0]!.source,
    },
    { ip: '1.2.3.4', user: 'pi', sshHost: 'alias', sshPort: 2222, source: 'manual' },
  );
  assert.equal(data.hist['p']!.cpu!.length, 2);
  assert.equal(data.hist['p']!.temp![0]!.value, 55);
  assert.equal(data.hist['p']!.temp![1]!.value, null, 'null temp survives the round trip');
  assert.equal(data.net['p']!.wlan0!.length, 1);
  assert.equal(data.journal['p']!.length, 2);
  assert.equal(data.journal['p']![0]!.level, 'oom');
  assert.equal(data.pkgs['p']!.security, 1);
  assert.deepEqual(data.pkgs['p']!.list, ['a:security 1 amd64']);

  // "Restart": new in-memory fleet over the same store.
  const fleet2 = new Fleet({ ...CAPS, journalWindowMs: 3_600_000, storage: store });
  const n = fleet2.restore(data);
  assert.equal(n, 1);

  const p2 = fleet2.get('p')!;
  assert.equal(p2.online, false, 'online state is re-established by probes, not persisted');
  assert.equal(p2.probeFailures, 0);
  assert.equal(p2.sshHost, 'alias');
  assert.equal(p2.sshPort, 2222);
  assert.equal(p2.hist.cpu.length, 2);
  assert.equal(p2.hist.temp.series()[1]![1], null);
  assert.equal(p2.netHistory.wlan0!.length, 1);
  assert.ok(p2.netHistory.wlan0!.last()!.value.rxBps > 0, 'restored net sample has a rate');
  assert.equal(p2.journal.lines.length, 2);
  assert.equal(p2.journal.oomCount, 1);
  assert.equal(p2.journal.lastOom, 'oom-killer: Killed 1 (x)');
  assert.equal(p2.pkgs.security, 1);
  assert.ok(
    p2.attention.some((a) => a.rule === 'security-updates'),
    'attention recomputed from restored package state',
  );

  // Journal keeps appending after restore, in order.
  fleet2.pushJournalLine('p', { at: t + 4, level: 'info', unit: 'sys', message: 'after restart' });
  const data2 = store.loadAll();
  assert.equal(data2.journal['p']!.length, 3);
  assert.equal(data2.journal['p']![2]!.message, 'after restart');
});

test('hist series prune to capacity, newest kept', () => {
  const { store, fleet } = setup();
  fleet.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  const t = Date.now();
  for (let i = 0; i < 25; i++) {
    fleet.updateMetrics('p', { ...metrics(), at: t + i * 1000 });
  }
  const data = store.loadAll();
  for (const s of ['cpu', 'mem', 'disk', 'temp', 'load'] as const) {
    assert.equal(data.hist['p']![s]!.length, CAPS.historyPoints, `${s} pruned to cap`);
  }
  const cpu = data.hist['p']!.cpu!;
  assert.equal(cpu[0]!.at, t + 15000, 'oldest kept is the 16th of 25');
  assert.equal(cpu[9]!.at, t + 24000, 'newest kept is the last');
});

test('journal prunes to capacity, keeps newest, preserves order', () => {
  const { store, fleet } = setup();
  fleet.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  const t = Date.now();
  for (let i = 0; i < 30; i++) {
    fleet.pushJournalLine('p', { at: t + i * 1000, level: 'info', unit: 'u', message: `line ${i}` });
  }
  const data = store.loadAll();
  const lines = data.journal['p']!;
  assert.equal(lines.length, CAPS.journalLines);
  assert.equal(lines[0]!.message, 'line 10', 'newest window kept');
  assert.equal(lines[19]!.message, 'line 29');
});

test('net history prunes to capacity, newest kept', () => {
  const store = openFleetStore(':memory:', CAPS);
  for (let i = 0; i < 15; i++) {
    store.appendNet('p', 'eth0', { at: i * 1000, rxBps: i, txBps: i * 2 });
  }
  const data = store.loadAll();
  const samples = data.net['p']!.eth0!;
  assert.equal(samples.length, CAPS.netHistoryPoints);
  assert.equal(samples[0]!.rxBps, 7, 'newest window kept');
  assert.equal(samples[7]!.txBps, 28);
});

test('removal persists (pi + its rows disappear)', () => {
  const { store, fleet } = setup();
  fleet.addPi({ id: 'gone', name: 'gone', ip: '1.1.1.2' });
  fleet.addPi({ id: 'stays', name: 'stays', ip: '1.1.1.3' });
  fleet.pushJournalLine('gone', { at: Date.now(), level: 'info', unit: 'u', message: 'x' });
  fleet.removePi('gone');
  const data = store.loadAll();
  assert.ok(!data.pis.some((p) => p.id === 'gone'));
  assert.ok(data.pis.some((p) => p.id === 'stays'));
  assert.ok(data.journal['gone'] === undefined, 'journal rows of removed Pi are dropped');
});

test('file-backed store survives close + reopen (restart simulation)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fleet-persist-'));
  const file = path.join(dir, 'fleet.db');
  try {
    const s1 = openFleetStore(file, CAPS);
    s1.upsertPi({
      id: 'p', name: 'p', ip: '9.9.9.9', user: null, sshHost: null, sshPort: 22, source: 'mdns', addedAt: 123,
    });
    s1.appendScalar('p', 'cpu', 1000, 42);
    s1.appendJournal('p', { at: 1000, level: 'warn', unit: 'u', message: 'm' });
    s1.setPkgs('p', { total: 1, security: 0, list: ['b 1'], at: 1000, checked: true });
    s1.close();

    const s2 = openFleetStore(file, CAPS);
    const data = s2.loadAll();
    assert.equal(data.pis.length, 1);
    assert.equal(data.pis[0]!.ip, '9.9.9.9');
    assert.equal(data.pis[0]!.source, 'mdns');
    assert.equal(data.hist['p']!.cpu![0]!.value, 42);
    assert.equal(data.journal['p']![0]!.message, 'm');
    assert.equal(data.pkgs['p']!.total, 1);
    s2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore is idempotent for already-present Pis', () => {
  const { store, fleet } = setup();
  fleet.addPi({ id: 'p', name: 'p', ip: '1.1.1.1' });
  const data = store.loadAll();
  const n = fleet.restore(data);
  assert.equal(n, 0, 'Pi already present is not restored twice');
  assert.equal(fleet.list().length, 1);
});
