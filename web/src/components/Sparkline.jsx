/** Minimal SVG sparkline — no chart library needed. */
export default function Sparkline({ points, width = 120, height = 28, color = 'var(--accent)', max, unit = '' }) {
  const vals = (points || []).map((p) => p[1]).filter((v) => v != null && !Number.isNaN(v));
  if (vals.length < 2) {
    return (
      <span className="spark-empty" style={{ width, height }}>
        {vals.length === 1 ? `${vals[0]}${unit}` : '…'}
      </span>
    );
  }
  const lo = 0;
  const hi = max ?? (Math.max(...vals) * 1.15 || 1);
  const n = vals.length;
  const pts = vals
    .map((v, i) => {
      const x = (i / (n - 1)) * width;
      const y = height - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
