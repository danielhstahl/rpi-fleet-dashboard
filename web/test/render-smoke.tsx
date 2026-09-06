/**
 * Render smoke test: renders every component with fixture data via
 * renderToString. No browser needed; catches render-path crashes
 * (undefined identifiers, bad prop shapes) that type-checking alone
 * can't fully guarantee. Run: npm test (in web/).
 */
import { strict as assert } from 'node:assert';
import { renderToString } from 'react-dom/server';
import App from '../src/App';
import AttentionPanel from '../src/components/AttentionPanel';
import FleetGrid from '../src/components/FleetGrid';
import PiCard from '../src/components/PiCard';
import PiDetail from '../src/components/PiDetail';
import OverviewTab from '../src/components/OverviewTab';
import JournalTab from '../src/components/JournalTab';
import PackagesTab from '../src/components/PackagesTab';
import NetworkTab from '../src/components/NetworkTab';
import type { FleetSnapshot, SnapshotPi } from '../src/types';

function fixturePi(over: Partial<SnapshotPi> = {}): SnapshotPi {
  return {
    id: 'mock-bravo',
    name: 'pi-bravo',
    ip: '10.0.0.12',
    source: 'mock',
    online: true,
    score: 50,
    upgrading: false,
    probeFailures: 0,
    attention: [
      { severity: 'warning', rule: 'disk', title: 'Disk filling up', detail: 'root filesystem at 91%', since: Date.now() - 60000 },
      { severity: 'warning', rule: 'temp', title: 'Running hot', detail: 'SoC at 78 °C', since: Date.now() - 60000 },
    ],
    // Deliberately floaty values — the UI must truncate them (no 91.05000000000001%).
    metrics: {
      at: Date.now(),
      uptimeSec: 86_400,
      load1: 0.543219,
      cores: 4,
      memPct: 45.6789,
      diskPct: 91.05000000000001,
      cpuPct: 15.4321,
      tempC: 78.9,
      ip: '10.0.0.12',
    },
    net: { wlan0: { at: Date.now(), rxBps: 250_000, txBps: 40_000 } },
    pkgs: { total: 5, security: 0, checked: true },
    spark: {
      cpu: [10, 12, 15, 14, 16, 15],
      mem: [40, 42, 45, 44, 45, 46],
      disk: [90, 90, 91, 91, 91, 91],
      temp: [70, 72, 75, 77, 78, null],
      load: [0.3, 0.4, 0.5, 0.4, 0.5, 0.6],
    },
    ...over,
  };
}

const fleet: FleetSnapshot = {
  at: Date.now(),
  pis: [
    fixturePi(),
    fixturePi({
      id: 'mock-charlie',
      name: 'pi-charlie',
      ip: '10.0.0.13',
      online: false,
      score: 100,
      probeFailures: 4,
      attention: [
        { severity: 'critical', rule: 'unreachable', title: 'Unreachable', detail: 'No SSH response after 4 attempts: ECONNREFUSED' },
      ],
      metrics: null,
      net: {},
      pkgs: { total: 0, security: 0, checked: false },
      spark: { cpu: [], mem: [], disk: [], temp: [], load: [] },
    }),
  ],
};

const piIndex = Object.fromEntries(fleet.pis.map((p) => [p.id, p]));
const noop = (): void => {};

// --- render every component path -----------------------------------------
const app = renderToString(<App />);
assert.ok(app.includes('pi-fleet'), 'App shell renders');

const grid = renderToString(<FleetGrid fleet={fleet} selected={null} onSelect={noop} />);
assert.ok(grid.includes('pi-bravo'), 'FleetGrid renders Pi cards');
assert.ok(grid.includes('pi-charlie'), 'FleetGrid renders offline Pi');

const card = renderToString(
  <PiCard pi={fleet.pis[0]!} selected={false} onSelect={noop} />,
);
assert.ok(card.includes('91%'), 'PiCard truncates disk metric');
assert.ok(card.includes('78°C'), 'PiCard truncates temp metric');
assert.ok(card.includes('0.54'), 'PiCard truncates load');
assert.ok(!card.includes('91.05000000000001'), 'no raw float percentages leak into the UI');
assert.ok(card.includes('MB/s') || card.includes('KB/s'), 'PiCard renders net rate');

const offlineCard = renderToString(
  <PiCard pi={fleet.pis[1]!} selected={false} onSelect={noop} />,
);
assert.ok(offlineCard.includes('pi-charlie'), 'offline card renders');

const att = renderToString(<AttentionPanel fleet={fleet} onSelect={noop} piIndex={piIndex} />);
assert.ok(att.includes('Needs work'), 'attention panel shows items');
assert.ok(att.includes('Unreachable'), 'attention panel shows critical item');

const quietAtt = renderToString(
  <AttentionPanel
    fleet={{ at: Date.now(), pis: [fixturePi({ attention: [], score: 0 })] }}
    onSelect={noop}
    piIndex={{}}
  />,
);
assert.ok(quietAtt.includes('All quiet'), 'attention panel quiet state');
assert.ok(quietAtt.includes('dot ok'), 'quiet state uses a green dot');
assert.ok(quietAtt.includes('attention-panel'), 'panel uses the scoped container class (not the bare "attention" status name, which would style the status dots)');
assert.ok(!att.includes('⚠') && !quietAtt.includes('⚠'), 'no oversized warning glyphs');

const detail = renderToString(
  <PiDetail
    pi={fleet.pis[0]!}
    journalLines={{ 'mock-bravo': [{ at: Date.now(), level: 'info', unit: 'mockd', message: 'heartbeat ok' }] }}
    upgrades={{}}
    subscribeJournal={noop}
    unsubscribeJournal={noop}
    clearUpgrade={noop}
    onClose={noop}
  />,
);
assert.ok(detail.includes('pi-bravo'), 'detail pane renders');

const hist = {
  cpu: [0, 1, 2].map((i): [number, number] => [Date.now() - i * 1000, 10 + i]),
  mem: [],
  disk: [],
  temp: [[Date.now(), null]] as Array<[number, number | null]>,
  load: [],
};
const overview = renderToString(<OverviewTab pi={fleet.pis[0]!} hist={hist} />);
assert.ok(overview.includes('Root disk'), 'overview tab renders');

const journal = renderToString(
  <JournalTab
    pi={fleet.pis[0]!}
    lines={[
      { at: Date.now(), level: 'oom', unit: 'kernel', message: 'oom-killer: Killed process 1 (x)' },
      { at: Date.now(), level: 'error', unit: 'sshd', message: 'Failed password for root' },
    ]}
  />,
);
assert.ok(journal.includes('oom-killer'), 'journal tab renders lines');
assert.ok(journal.includes('Failed password'), 'journal tab renders error line');
// React SSR inserts a comment node between adjacent text segments: "2<!-- --> lines"
assert.ok(journal.includes('2<!-- --> lines'), 'journal tab counts lines');

const pkgs = renderToString(
  <PackagesTab pi={fleet.pis[0]!} detail={null} upgrades={undefined} clearUpgrade={noop} />,
);
assert.ok(pkgs.includes('upgradable'), 'packages tab renders');
assert.ok(pkgs.includes('Upgrade packages (5)'), 'packages tab shows count');

const upgradingPkgs = renderToString(
  <PackagesTab
    pi={fixturePi({ upgrading: true })}
    detail={null}
    upgrades={{ lines: ['[1/10] sim'], done: null }}
    clearUpgrade={noop}
  />,
);
assert.ok(upgradingPkgs.includes('in progress'), 'packages tab shows upgrade progress');

const donePkgs = renderToString(
  <PackagesTab pi={fleet.pis[0]!} detail={null} upgrades={{ lines: ['done'], done: true }} clearUpgrade={noop} />,
);
assert.ok(donePkgs.includes('finished successfully'), 'packages tab shows completion');

const net = renderToString(
  <NetworkTab
    pi={fleet.pis[0]!}
    netHistory={{
      wlan0: [
        [Date.now() - 2000, { at: Date.now() - 2000, rxBps: 100_000, txBps: 10_000 }],
        [Date.now() - 1000, { at: Date.now() - 1000, rxBps: 250_000, txBps: 40_000 }],
      ],
    }}
  />,
);
assert.ok(net.includes('wlan0'), 'network tab renders interface');

console.log('render smoke: all component render paths OK');
