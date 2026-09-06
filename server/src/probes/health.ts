// One-shot health probe: a single sh script run over SSH emits one
// pipe-delimited line with every metric we need.

import type { SshTarget } from './ssh.js';
import { runOnce } from './ssh.js';
import type { Fleet } from '../state/fleet.js';
import type { MetricsInput } from '../types.js';

export const HEALTH_SCRIPT = `
set -u
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
LOAD=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
CORES=$(nproc 2>/dev/null || echo 1)
MEM=$(free -m 2>/dev/null | awk '/^Mem:/{print int($3/$2*100)}')
MEM=\${MEM:-0}
DISK=$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')
DISK=\${DISK:-0}
CPU=0
if [ -f /proc/stat ]; then
  a=$(head -1 /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8}')
  b=$(head -1 /proc/stat | awk '{print $5+$6}')
  sleep 0.5
  c=$(head -1 /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8}')
  d=$(head -1 /proc/stat | awk '{print $5+$6}')
  da=$((c-a)); db=$((d-b))
  if [ "$da" -gt 0 ]; then CPU=$(awk -v da=$da -v db=$db 'BEGIN{printf "%d", (da-db)*100/da}'); fi
fi
TEMP=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
if [ -n "\${TEMP:-}" ]; then TEMP=$(awk -v t=$TEMP 'BEGIN{printf "%d", t/1000}'); fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "$UPTIME|$LOAD|$CORES|$MEM|$DISK|$CPU|$TEMP|$IP"
`;

/** Parse "uptime|load|cores|mem|disk|cpu|temp|ip" (temp may be empty). */
export function parseHealth(raw: string): MetricsInput {
  const parts = raw.trim().split('|');
  if (parts.length !== 8) {
    throw new Error(`malformed health output: ${raw.slice(0, 80)}`);
  }
  const [uptime, load, cores, mem, disk, cpu, temp, ip] = parts;
  const num = (v: string | undefined, fallback = 0): number => {
    const n = Number(v ?? '');
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    uptimeSec: num(uptime),
    load1: num(load),
    cores: num(cores) || 1,
    memPct: num(mem),
    diskPct: num(disk),
    cpuPct: num(cpu),
    tempC: temp && temp.trim() !== '' ? num(temp) : null,
    ip: (ip ?? '').trim() || null,
  };
}

export async function runHealthScript(t: SshTarget, fleet: Fleet, piId: string): Promise<void> {
  const raw = await runOnce(t, HEALTH_SCRIPT, 10_000);
  const h = parseHealth(raw);
  fleet.updateMetrics(piId, { ...h, at: Date.now() });
}
