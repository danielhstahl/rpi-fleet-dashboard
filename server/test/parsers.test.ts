import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJournalLine, line } from '../src/probes/journal.js';
import { parseHealth } from '../src/probes/health.js';
import { parseNet } from '../src/probes/network.js';
import { parsePkgs } from '../src/probes/packages.js';

test('parseJournalLine: OOM detection', () => {
  const l = parseJournalLine('2026-09-05T18:00:00.123456+0000 pi-1 kernel: oom-killer: Killed process 1834 (chromium) total-vm:2048000kB');
  assert.ok(l);
  assert.equal(l.level, 'oom');
  assert.equal(l.unit, 'kernel');
  assert.ok(l.message.includes('Killed process'));
  assert.ok(l.at > 0);
});

test('parseJournalLine: error and info levels', () => {
  const err = parseJournalLine('2026-09-05T18:00:01+0000 pi-1 systemd[1]: getty@tty1.service: Failed with result exit-code.');
  assert.ok(err);
  assert.equal(err.level, 'error');
  assert.equal(err.unit, 'systemd');
  const info = parseJournalLine('2026-09-05T18:00:02+0000 pi-1 CRON[912]: (root) CMD (true)');
  assert.ok(info);
  assert.equal(info.level, 'info');
});

test('parseJournalLine: garbage returns null', () => {
  assert.equal(parseJournalLine(''), null);
  assert.equal(parseJournalLine('random text'), null);
});

test('line() round-trips through parseJournalLine', () => {
  const raw = line('2026-09-05T18:00:00+0000', 'pi-x', 'kernel', 'something happened');
  const parsed = parseJournalLine(raw);
  assert.ok(parsed);
  assert.equal(parsed.unit, 'kernel');
  assert.equal(parsed.message, 'something happened');
});

test('parseHealth parses pipe-delimited probe output', () => {
  const h = parseHealth('86400|1.23|4|45.5|62|12.5|55|10.0.0.5');
  assert.deepEqual(h, { uptimeSec: 86400, load1: 1.23, cores: 4, memPct: 45.5, diskPct: 62, cpuPct: 12.5, tempC: 55, ip: '10.0.0.5' });
});

test('parseHealth handles missing temp (empty field)', () => {
  const h = parseHealth('100|0.5|2|30|50|10||10.0.0.5');
  assert.equal(h.tempC, null);
});

test('parseHealth rejects malformed output', () => {
  assert.throws(() => parseHealth('nope'));
});

test('parseNet parses iface counters', () => {
  const n = parseNet('eth0 1000 500\nwlan0 2000 100\n');
  assert.deepEqual(n, { eth0: { rx: 1000, tx: 500 }, wlan0: { rx: 2000, tx: 100 } });
});

test('parsePkgs parses total|security', () => {
  assert.deepEqual(parsePkgs('12|8'), { total: 12, security: 8 });
  assert.deepEqual(parsePkgs('0|0'), { total: 0, security: 0 });
});
