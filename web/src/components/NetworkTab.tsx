import Sparkline from './Sparkline';
import { fmtBytes } from '../lib/format';
import type { HistPoint, NetSample, SnapshotPi } from '../types';

interface NetworkTabProps {
  pi: SnapshotPi;
  netHistory: Record<string, HistPoint<NetSample>[]>;
}

/** Per-interface traffic with sparklines. */
export default function NetworkTab({ pi, netHistory }: NetworkTabProps) {
  const ifaces = Object.keys(pi.net).sort();
  if (ifaces.length === 0) {
    return (
      <div className="tab-body">
        <div className="muted">No network interfaces reported yet.</div>
      </div>
    );
  }
  return (
    <div className="tab-body net-tab">
      {ifaces.map((iface) => {
        const cur = pi.net[iface];
        const hist = netHistory[iface] ?? [];
        return (
          <div key={iface} className="net-iface">
            <h3>{iface}</h3>
            <div className="net-row">
              <label>↓ receive</label>
              <Sparkline
                points={hist.map(([at, v]): HistPoint => [at, v.rxBps])}
                width={420}
                height={36}
                color="var(--ok)"
              />
              <b>{fmtBytes(cur?.rxBps)}</b>
            </div>
            <div className="net-row">
              <label>↑ transmit</label>
              <Sparkline
                points={hist.map(([at, v]): HistPoint => [at, v.txBps])}
                width={420}
                height={36}
                color="var(--blue)"
              />
              <b>{fmtBytes(cur?.txBps)}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
