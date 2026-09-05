import Sparkline from './Sparkline.jsx';
import { fmtBytes } from '../lib/format.js';

/** Per-interface traffic with 30-minute sparklines. */
export default function NetworkTab({ pi, netHistory }) {
  const ifaces = Object.keys(pi.net || {}).sort();
  if (ifaces.length === 0) {
    return <div className="tab-body"><div className="muted">No network interfaces reported yet.</div></div>;
  }
  return (
    <div className="tab-body net-tab">
      {ifaces.map((iface) => {
        const cur = pi.net[iface];
        const hist = netHistory[iface] || [];
        return (
          <div key={iface} className="net-iface">
            <h3>{iface}</h3>
            <div className="net-row">
              <label>↓ receive</label>
              <Sparkline points={hist.map(([at, v]) => [at, v.rx])} width={420} height={36} color="var(--ok)" />
              <b>{fmtBytes(cur?.rxBps)}</b>
            </div>
            <div className="net-row">
              <label>↑ transmit</label>
              <Sparkline points={hist.map(([at, v]) => [at, v.tx])} width={420} height={36} color="var(--blue)" />
              <b>{fmtBytes(cur?.txBps)}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
