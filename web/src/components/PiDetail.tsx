import { useEffect, useState } from 'react';
import OverviewTab from './OverviewTab';
import JournalTab from './JournalTab';
import PackagesTab from './PackagesTab';
import NetworkTab from './NetworkTab';
import type { HistPoint, JournalLine, NetSample, PiDetailData, SnapshotPi, UpgradeState } from '../types';

type TabId = 'overview' | 'journal' | 'packages' | 'network';

interface PiDetailProps {
  pi: SnapshotPi;
  journalLines: Record<string, JournalLine[]>;
  upgrades: Record<string, UpgradeState>;
  subscribeJournal: (pi: string) => void;
  unsubscribeJournal: (pi: string) => void;
  clearUpgrade: (pi: string) => void;
  onClose: () => void;
}

/**
 * Pi detail pane: fetches full state (incl. history) and renders tabs.
 * History refetches while open so charts keep moving.
 */
export default function PiDetail({
  pi,
  journalLines,
  upgrades,
  subscribeJournal,
  unsubscribeJournal,
  clearUpgrade,
  onClose,
}: PiDetailProps) {
  const [detail, setDetail] = useState<PiDetailData | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const r = await fetch(`/api/pis/${pi.id}`);
        if (r.ok && live) setDetail((await r.json()) as PiDetailData);
      } catch {
        /* server hiccup; retry on next tick */
      }
    };
    load();
    const t = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [pi.id]);

  // Journal subscription lifecycle
  useEffect(() => {
    if (tab === 'journal') subscribeJournal(pi.id);
    else unsubscribeJournal(pi.id);
    return () => unsubscribeJournal(pi.id);
  }, [tab, pi.id, subscribeJournal, unsubscribeJournal]);

  const hist = {
    cpu: detail?.hist.cpu ?? [],
    mem: detail?.hist.mem ?? [],
    disk: detail?.hist.disk ?? [],
    temp: detail?.hist.temp ?? [],
    load: detail?.hist.load ?? [],
  };
  const netHistory: Record<string, HistPoint<NetSample>[]> = detail?.netHistory ?? {};

  return (
    <div className="detail">
      <div className="detail-head">
        <h2>
          {detail?.name ?? pi.name} <span className="pi-ip">{pi.ip}</span>
        </h2>
        <div className="tabs">
          <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'journal' ? 'on' : ''} onClick={() => setTab('journal')}>Journal</button>
          <button className={tab === 'packages' ? 'on' : ''} onClick={() => setTab('packages')}>Packages</button>
          <button className={tab === 'network' ? 'on' : ''} onClick={() => setTab('network')}>Network</button>
        </div>
        <button className="close" onClick={onClose}>✕</button>
      </div>
      {tab === 'overview' && <OverviewTab pi={pi} hist={hist} />}
      {tab === 'journal' && <JournalTab pi={pi} lines={journalLines[pi.id] ?? []} />}
      {tab === 'packages' && (
        <PackagesTab pi={pi} detail={detail} upgrades={upgrades[pi.id]} clearUpgrade={clearUpgrade} />
      )}
      {tab === 'network' && <NetworkTab pi={pi} netHistory={netHistory} />}
    </div>
  );
}

