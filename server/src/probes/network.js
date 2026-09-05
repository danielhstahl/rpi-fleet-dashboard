/**
 * Network traffic: raw byte counters from /sys/class/net, sampled on the
 * server side (deltas computed by the fleet store).
 * Emits lines: `iface rx_bytes tx_bytes`
 */
export const NET_CMD = [
  `for i in /sys/class/net/*; do`,
  `  n=\${i##*/}`,
  `  [ "$n" = "lo" ] && continue`,
  `  r=$(cat $i/statistics/rx_bytes 2>/dev/null) || continue`,
  `  t=$(cat $i/statistics/tx_bytes 2>/dev/null) || continue`,
  `  printf '%s %s %s\\n' "$n" "$r" "$t"`,
  `done`,
].join('\n');

/** @param {string} stdout @returns {Record<string,{rx:number,tx:number}>} */
export function parseNet(stdout) {
  const out = {};
  for (const l of stdout.trim().split('\n')) {
    const [iface, rx, tx] = l.split(/\s+/);
    if (!iface || rx == null) continue;
    out[iface] = { rx: Number(rx) || 0, tx: Number(tx) || 0 };
  }
  return out;
}

export default NET_CMD;
