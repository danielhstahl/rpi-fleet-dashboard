import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalLevel, JournalLine, SnapshotPi } from '../types';

const LEVELS: Record<JournalLevel, number> = { oom: 3, error: 2, warn: 1, info: 0 };

type Filter = 'all' | 'warn' | 'error';

interface JournalTabProps {
  pi: SnapshotPi;
  lines: JournalLine[];
}

/**
 * Live journal tail. History is fetched on open; live lines arrive over ws.
 */
export default function JournalTab({ pi, lines }: JournalTabProps) {
  const [history, setHistory] = useState<JournalLine[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [follow, setFollow] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/pis/${pi.id}/journal?limit=200`)
      .then(async (r) => {
        if (!r.ok) return null;
        // The server returns a bare array (JSON body = JournalLine[]).
        const d: unknown = await r.json();
        return Array.isArray(d) ? (d as JournalLine[]) : null;
      })
      .then((d) => {
        if (live && d) setHistory(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pi.id]);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...history, ...lines].filter((l) => {
      const k = `${l.at}|${l.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    merged.sort((a, b) => a.at - b.at);
    const minLevel = filter === 'all' ? 0 : filter === 'error' ? 2 : 1;
    return merged.filter((l) => LEVELS[l.level] >= minLevel).slice(-400);
  }, [history, lines, filter]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [all.length, follow]);

  return (
    <div className="tab-body journal-tab">
      <div className="journal-controls">
        {(['all', 'warn', 'error'] as const).map((f) => (
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
