// Network traffic: sample /sys/class/net byte counters over SSH; the fleet
// derives per-interface bps from consecutive samples.

import type { SshOpts } from './ssh.js';
import { execOnce } from './ssh.js';
import type { Fleet } from '../state/fleet.js';

const NET_SCRIPT = `
for d in /sys/class/net/*/statistics; do
  i=$(basename $(dirname $d))
  case $i in lo) continue;; esac
  rx=$(cat $d/rx_bytes 2>/dev/null || echo 0)
  tx=$(cat $d/tx_bytes 2>/dev/null || echo 0)
  echo "$i $rx $tx"
done
`;

/** Parse "iface rx tx" lines into raw counters. */
export function parseNet(raw: string): Record<string, { rx: number; tx: number }> {
  const out: Record<string, { rx: number; tx: number }> = {};
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;
    const [iface, rx, tx] = line.split(' ');
    if (iface && rx !== undefined && tx !== undefined) {
      out[iface] = { rx: Number(rx) || 0, tx: Number(tx) || 0 };
    }
  }
  return out;
}

export async function sampleNetwork(opts: SshOpts, fleet: Fleet, piId: string): Promise<void> {
  const raw = await execOnce(opts, NET_SCRIPT, 8000);
  fleet.updateNetwork(piId, parseNet(raw));
}
