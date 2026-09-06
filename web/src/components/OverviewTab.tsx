import type { ReactNode } from 'react';
import Sparkline, { type SparkPoint } from './Sparkline';
import { fmtUptime, loadFmt, pct, tempC } from '../lib/format';
import type { HistPoint, SnapshotPi } from '../types';

interface MetricProps {
  label: string;
  value: ReactNode;
  points?: SparkPoint[] | null;
  max?: number;
  color?: string;
}

function Metric({ label, value, points, max, color }: MetricProps) {
  return (
    <div className="metric">
      <label>{label}</label>
      <Sparkline points={points} max={max} color={color} width={150} height={34} />
      <b>{value}</b>
    </div>
  );
}

interface OverviewTabProps {
  pi: SnapshotPi;
  hist: {
    cpu: HistPoint[];
    mem: HistPoint[];
    disk: HistPoint[];
    temp: HistPoint<number | null>[];
    load: HistPoint[];
  };
}

export default function OverviewTab({ pi, hist }: OverviewTabProps) {
  const m = pi.metrics;
  return (
    <div className="tab-body">
      <div className="metrics-grid">
        <Metric label="CPU" value={pct(m?.cpuPct)} points={hist.cpu} max={100} color="var(--blue)" />
        <Metric label="Memory" value={pct(m?.memPct)} points={hist.mem} max={100} color="var(--purple)" />
        <Metric
          label="Root disk"
          value={pct(m?.diskPct)}
          points={hist.disk}
          max={100}
          color={(m?.diskPct ?? 0) >= 85 ? 'var(--warn)' : 'var(--teal)'}
        />
        <Metric
          label="Temperature"
          value={tempC(m?.tempC)}
          points={hist.temp}
          color={(m?.tempC ?? 0) >= 75 ? 'var(--crit)' : 'var(--ok)'}
        />
        <div className="metric">
          <label>Load</label>
          <Sparkline points={hist.load} color="var(--accent)" width={150} height={34} />
          <b>
            {loadFmt(m?.load1)} <small>/{m?.cores ?? '?'} cores</small>
          </b>
        </div>
        <div className="metric">
          <label>Uptime</label>
          <div className="big">{fmtUptime(m?.uptimeSec)}</div>
        </div>
      </div>
      {pi.attention.length > 0 && (
        <div className="pi-attention">
          <h3>Attention for this Pi</h3>
          {pi.attention.map((a, i) => (
            <div key={i} className={`att-item ${a.severity}`}>
              <span className={`dot ${a.severity}`} />
              <span className="att-text">
                {a.title}
                {a.detail ? <em> — {a.detail}</em> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {!pi.online && (
        <div className="banner offline">
          ● Offline — {pi.probeFailures} consecutive failed probes ({pi.probeFailures >= 3 ? 'unreachable' : 'intermittent'})
        </div>
      )}
    </div>
  );
}
