import type { AttentionItem, FleetSnapshot, SnapshotPi } from '../types';

interface AttentionRow extends AttentionItem {
  pi: SnapshotPi;
}

interface AttentionPanelProps {
  fleet: FleetSnapshot | null;
  onSelect: (id: string) => void;
  piIndex: Record<string, SnapshotPi>;
}

/**
 * The attention panel: the core of the product.
 * Every actionable problem across the fleet, worst first.
 */
export default function AttentionPanel({ fleet, onSelect, piIndex }: AttentionPanelProps) {
  if (!fleet) return null;
  const items: AttentionRow[] = [];
  for (const pi of [...fleet.pis].sort((a, b) => b.score - a.score)) {
    for (const a of pi.attention) {
      items.push({ pi, ...a });
    }
  }
  if (items.length === 0) {
    return (
      <div className="attention-panel ok">
        <span className="att-title">
          <span className="dot ok" /> All quiet
        </span>
        <span className="att-detail">No attention items across {fleet.pis.length} Pi(s).</span>
      </div>
    );
  }
  const worst = items.some((i) => i.severity === 'critical') ? 'critical' : 'warning';
  return (
    <div className="attention-panel">
      <div className="att-title">
        <span className={`dot ${worst}`} />
        Needs work — {items.filter((i) => i.severity === 'critical').length} critical · {items.filter((i) => i.severity === 'warning').length} warning
      </div>
      <div className="att-items">
        {items.slice(0, 12).map((it, i) => (
          <button key={i} className={`att-item ${it.severity}`} onClick={() => onSelect(it.pi.id)}>
            <span className={`dot ${it.severity}`} />
            <span className="att-pi">{piIndex[it.pi.id]?.name ?? it.pi.id}</span>
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
