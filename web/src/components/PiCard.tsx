import Sparkline from './Sparkline';
import { fmtBytes, loadFmt, pct, statusOf, tempC } from '../lib/format';
import type { SnapshotPi } from '../types';

interface PiCardProps {
  pi: SnapshotPi;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One Pi card in the fleet grid. */
export default function PiCard({ pi, selected, onSelect }: PiCardProps) {
  const status = statusOf(pi);
  const m = pi.metrics;
  const topNet = Object.entries(pi.net).sort((a, b) => b[1].rxBps - a[1].rxBps)[0];
  const attn = pi.attention;

  return (
    <button className={`pi-card ${status} ${selected ? 'selected' : ''}`} onClick={() => onSelect(pi.id)}>
      <div className="pi-card-head">
        <span className={`dot ${status}`} />
        <span className="pi-name">{pi.name}</span>
        <span className="pi-ip">{pi.ip}</span>
        <span className="pi-src">{pi.source}</span>
      </div>
      <div className="pi-metrics">
        <div className="pm">
          <label>cpu</label>
          <Sparkline points={pi.spark?.cpu} max={100} color="var(--blue)" />
          <b>{pct(m?.cpuPct)}</b>
        </div>
        <div className="pm">
          <label>mem</label>
          <Sparkline points={pi.spark?.mem} max={100} color="var(--purple)" />
          <b>{pct(m?.memPct)}</b>
        </div>
        <div className="pm">
          <label>disk</label>
          <Sparkline points={pi.spark?.disk} max={100} color={(m?.diskPct ?? 0) >= 85 ? 'var(--warn)' : 'var(--teal)'} />
          <b>{pct(m?.diskPct)}</b>
        </div>
        <div className="pm">
          <label>temp</label>
          <Sparkline points={pi.spark?.temp} color={(m?.tempC ?? 0) >= 75 ? 'var(--crit)' : 'var(--ok)'} />
          <b>{tempC(m?.tempC)}</b>
        </div>
      </div>
      <div className="pi-foot">
        <span className="load">load {loadFmt(m?.load1)} / {m?.cores ?? '?'}c</span>
        {topNet && (
          <span className="net">
            ↓{fmtBytes(topNet[1].rxBps)} ↑{fmtBytes(topNet[1].txBps)}
          </span>
        )}
        {pi.pkgs.security > 0 && <span className="badge sec">{pi.pkgs.security} sec</span>}
        {pi.pkgs.total > 0 && pi.pkgs.security === 0 && <span className="badge upd">{pi.pkgs.total} upd</span>}
        {attn.length > 0 && (
          <span className={`badge attn ${attn[0]?.severity}`}>
            <span className="bdot" />
            {attn.length}
          </span>
        )}
      </div>
    </button>
  );
}
