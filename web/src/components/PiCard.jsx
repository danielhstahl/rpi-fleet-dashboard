import Sparkline from './Sparkline.jsx';
import { fmtBytes, statusOf } from '../lib/format.js';

/** One Pi card in the fleet grid. */
export default function PiCard({ pi, selected, onSelect }) {
  const status = statusOf(pi);
  const m = pi.metrics || {};
  const h = pi.spark || {};
  const topNet = Object.entries(pi.net || {}).sort((a, b) => b[1].rxBps - a[1].rxBps)[0];
  const attn = pi.attention || [];

  return (
    <button className={`pi-card ${status} ${selected ? 'selected' : ''}`} onClick={() => onSelect(pi.id)}>
      <div className="pi-card-head">
        <span className={`dot ${status}`} />
        <span className="pi-name">{pi.name}</span>
        <span className="pi-ip">{pi.ip}</span>
        <span className="pi-src">{pi.source}</span>
      </div>
      {pi.upgrading && <div className="banner upgrading">▲ package upgrade running…</div>}
      <div className="pi-metrics">
        <div className="pm">
          <label>cpu</label>
          <Sparkline points={hist?.cpu} max={100} color="var(--blue)" />
          <b>{m.cpuPct != null ? `${m.cpuPct}%` : '—'}</b>
        </div>
        <div className="pm">
          <label>mem</label>
          <Sparkline points={hist?.mem} max={100} color="var(--purple)" />
          <b>{m.memPct != null ? `${m.memPct}%` : '—'}</b>
        </div>
        <div className="pm">
          <label>disk</label>
          <Sparkline points={hist?.disk} max={100} color={m.diskPct >= 85 ? 'var(--warn)' : 'var(--teal)'} />
          <b>{m.diskPct != null ? `${m.diskPct}%` : '—'}</b>
        </div>
        <div className="pm">
          <label>temp</label>
          <Sparkline points={hist?.temp} color={m.tempC >= 75 ? 'var(--crit)' : 'var(--ok)'} />
          <b>{m.tempC != null ? `${m.tempC}°C` : '—'}</b>
        </div>
      </div>
      <div className="pi-foot">
        <span className="load">load {m.load1 ?? '—'} / {m.cores ?? '?'}c</span>
        {topNet && (
          <span className="net">
            ↓{fmtBytes(topNet[1].rxBps)} ↑{fmtBytes(topNet[1].txBps)}
          </span>
        )}
        {pi.pkgs?.security > 0 && <span className="badge sec">{pi.pkgs.security} sec</span>}
        {pi.pkgs?.total > 0 && pi.pkgs.security === 0 && <span className="badge upd">{pi.pkgs.total} upd</span>}
        {attn.length > 0 && (
          <span className={`badge attn ${attn[0].severity}`}>{attn.length}⚠</span>
        )}
      </div>
    </button>
  );
}
