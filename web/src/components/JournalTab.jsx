import { useEffect, useMemo, useRef, useState } from 'react';

const LEVELS = { oom: 3, error: 2, warn: 1, info: 0 };

/**
 * Live journal tail. History is fetched on open; live lines arrive over ws.
 */
export default function JournalTab({ pi, lines }) {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState(true);
  const boxRef = useRef(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/pis/${pi.id}/journal?limit=200`)
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((d) => live && setHistory(d.lines || []))
      .catch(() => {});
    return () => { live = false; };
  }, [pi.id]);

  const all = useMemo(() => {
    const seen = new Set();
    const merged = [...history, ...lines].filter((l) => {
      const k = `${l.at}|${l.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    merged.sort((a, b) => a.at - b.at);
    return filter === 'all' ? merged.slice(-400) : merged.filter((l) => LEVELS[l.level] >= (filter === 'error' ? 2 : 1)).slice(-400);
  }, [history, lines, filter]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [all.length, follow]);

  return (
    <div className="tab-body journal-tab">
      <div className="journal-controls">
        {['all', 'warn', 'error'].map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <button className={follow ? 'on' : ''} onClick={() => setFollow(!follow)}>
          {follow ? '⏵ follow' : '⏸ paused'}
        </button>
        <span className="muted">{all.length} lines</span>
      </div>
      <div className="journal-box" ref={boxRef}>
        {all.map((l, i) => (
          <div key={i} className={`jline ${l.level}`}>
            <span className="jts">{new Date(l.at).toLocaleTimeString()}</span>
            <span className="junit">{l.unit}</span>
            <span className="jmsg">{l.message}</span>
          </div>
        ))}
        {all.length === 0 && <div className="muted">No log lines (yet).</div>}
      </div>
    </div>
  );
}
