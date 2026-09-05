/**
 * The attention panel: the core of the product.
 * Every actionable problem across the fleet, worst first.
 */
import { fmtAgo } from '../lib/format.js';

export default function AttentionPanel({ fleet, onSelect, piIndex }) {
  if (!fleet) return null;
  const items = [];
  for (const pi of [...fleet.pis].sort((a, b) => b.score - a.score)) {
    for (const a of pi.attention) {
      items.push({ pi, ...a, since: a.since });
    }
  }
  if (items.length === 0) {
    return (
      <div className="attention ok">
        <span className="att-title">✓ All quiet</span>
        <span className="att-detail">No attention items across {fleet.pis.length} Pi(s).</span>
      </div>
    );
  }
  return (
    <div className="attention">
      <div className="att-title">
        ⚠ Needs work — {items.filter((i) => i.severity === 'critical').length} critical · {items.filter((i) => i.severity === 'warning').length} warning
      </div>
      <div className="att-items">
        {items.slice(0, 12).map((it, i) => (
          <button key={i} className={`att-item ${it.severity}`} onClick={() => onSelect(it.pi.id)}>
            <span className={`dot ${it.severity}`} />
            <span className="att-pi">{piIndex?.[it.pi.id]?.name || it.pi.id}</span>
            <span className="att-text">
              {it.title}
              {it.detail ? <em> — {it.detail}</em> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
