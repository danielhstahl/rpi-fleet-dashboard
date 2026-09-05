/**
 * One-shot remote health probe. A single sh script (one exec round trip)
 * emits a pipe-delimited line:
 *   uptime|load1|cores|memPct|diskPct|cpuPct|tempC|ip
 */
export const HEALTH_CMD = [
  `u=$(awk '{print int($1)}' /proc/uptime)`,
  `l=$(cut -d' ' -f1 /proc/loadavg)`,
  `c=$(nproc)`,
  `mt=$(awk '/MemTotal/ {print $2}' /proc/meminfo)`,
  `ma=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)`,
  `m=$(awk -v t="$mt" -v a="$ma" 'BEGIN { if (t > 0) printf "%.1f", (t - a) * 100 / t; else printf "0" }')`,
  `d=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')`,
  `p=$(awk '{ u = $2 + $4; t = $1 + $2 + $3 + $4 + $5 + $6 + $7; if (t > 0) printf "%.1f", u * 100 / t; else printf "0" }' /proc/stat)`,
  `t=""`,
  `for z in /sys/class/thermal/thermal_zone*/temp; do [ -r "$z" ] && { t=$(awk '{ printf "%.0f", $1 / 1000 }' "$z"); break; }; done`,
  `i=$(hostname -I 2>/dev/null | awk '{print $1}')`,
  `printf '%s|%s|%s|%s|%s|%s|%s|%s' "$u" "$l" "$c" "$m" "$d" "$p" "$t" "$i"`,
].join('\n');

/** @param {string} stdout pipe-delimited probe line */
export function parseHealth(stdout) {
  const parts = stdout.trim().split('|');
  if (parts.length < 8) throw new Error(`bad health probe output: ${stdout.trim().slice(0, 120)}`);
  const num = (s) => (s === '' || s == null ? null : Number(s));
  return {
    uptimeSec: num(parts[0]) ?? 0,
    load1: num(parts[1]) ?? 0,
    cores: num(parts[2]) || 1,
    memPct: num(parts[3]) ?? 0,
    diskPct: num(parts[4]) ?? 0,
    cpuPct: num(parts[5]) ?? 0,
    tempC: parts[6] === '' ? null : num(parts[6]),
    ip: parts[7] || null,
  };
}

export default HEALTH_CMD;
