import { useEffect, useState } from 'react';

/**
 * Pi detail pane: fetches full state (incl. history) and renders tabs.
 * History refetches while open so charts keep moving.
 */
import OverviewTab from './OverviewTab.jsx';
import JournalTab from './JournalTab.jsx';
import PackagesTab from './PackagesTab.jsx';
import NetworkTab from './NetworkTab.jsx';

export default function PiDetail({ pi, journalLines, upgrades, subscribeJournal, unsubscribeJournal, clearUpgrade, onClose }) {
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/pis/${pi.id}`);
        if (r.ok && live) setDetail(await r.json());
      } catch { /* server hiccup; retry on next tick */ }
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pi.id]);

  // Journal subscription lifecycle
  useEffect(() => {
    if (tab === 'journal') subscribeJournal(pi.id);
    else unsubscribeJournal(pi.id);
    return () => unsubscribeJournal(pi.id);
  }, [tab, pi.id, subscribeJournal, unsubscribeJournal]);

  const h = detail?.hist || {};
  const hist = { cpu: h.cpu, mem: h.mem, disk: h.disk, temp: h.temp, load: h.load };
  const netHistory = detail?.netHistory || {};

  return (
    <div className="detail">
      <div className="detail-head">
        <h2>
          {detail?.name || pi.name} <span className="pi-ip">{pi.ip}</span>
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
      {tab === 'journal' && <JournalTab pi={pi} lines={journalLines[pi.id] || []} />}
      {tab === 'packages' && <PackagesTab pi={pi} detail={detail} upgrades={upgrades[pi.id]} clearUpgrade={clearUpgrade} />}
      {tab === 'network' && <NetworkTab pi={pi} netHistory={netHistory} />}
    </div>
  );
}
