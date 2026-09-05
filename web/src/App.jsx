import { useMemo, useState } from 'react';
import { useFleet } from './lib/fleet.js';
import AttentionPanel from './components/AttentionPanel.jsx';
import FleetGrid from './components/FleetGrid.jsx';
import PiDetail from './components/PiDetail.jsx';

export default function App() {
  const { fleet, connected, journal, upgrades, subscribeJournal, unsubscribeJournal, clearUpgrade } = useFleet();
  const [selected, setSelected] = useState(null);

  // History for card sparklines: fetched once per Pi on selection + light poll
  const [hist, setHist] = useState({});
  const piIndex = useMemo(() => {
    const ix = {};
    (fleet?.pis || []).forEach((p) => (ix[p.id] = p));
    return ix;
  }, [fleet]);

  // Keep card sparklines fresh via a slow poll of the selected Pi only;
  // card-level sparklines are good enough from the snapshot cadence.
  // (Full history is loaded in PiDetail when a Pi is opened.)

  const selectedPi = selected ? piIndex[selected] : null;
  const counts = useMemo(() => {
    const pis = fleet?.pis || [];
    return {
      total: pis.length,
      offline: pis.filter((p) => !p.online).length,
      attention: pis.filter((p) => p.score > 0).length,
    };
  }, [fleet]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">⌬</span> pi-fleet
          <span className="muted">local Raspberry Pi fleet manager</span>
        </div>
        <div className="fleet-summary">
          <span className="pill">{counts.total} Pi{counts.total === 1 ? '' : 's'}</span>
          {counts.offline > 0 && <span className="pill bad">{counts.offline} offline</span>}
          {counts.attention > 0 ? <span className="pill warn">{counts.attention} need attention</span> : <span className="pill good">all healthy</span>}
          <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? '● live' : '○ reconnecting'}</span>
        </div>
      </header>

      <AttentionPanel fleet={fleet} onSelect={setSelected} piIndex={piIndex} />

      <main>
        <FleetGrid fleet={fleet} hist={hist} selected={selected} onSelect={setSelected} />
      </main>

      {selectedPi && (
        <PiDetail
          pi={selectedPi}
          journalLines={journal}
          upgrades={upgrades}
          subscribeJournal={subscribeJournal}
          unsubscribeJournal={unsubscribeJournal}
          clearUpgrade={clearUpgrade}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
