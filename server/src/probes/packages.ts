// APT state: how many packages are upgradable and how many of those are
// security updates. Slow probe — cached for several minutes.
//
// The script emits "total|security" on the first line, then up to a dozen
// "name version" lines for the UI.

import type { SshTarget } from './ssh.js';
import { runOnce } from './ssh.js';
import type { Fleet } from '../state/fleet.js';

export const PKG_SCRIPT = `
set -u
OUT=$(apt list --upgradable 2>/dev/null | grep -v '^Listing' || true)
TOTAL=$(printf '%s\\n' "$OUT" | grep -c 'upgradable' || true)
SEC=$(printf '%s\\n' "$OUT" | grep -ci 'security' || true)
echo "$TOTAL|$SEC"
printf '%s\\n' "$OUT" | head -12 | cut -d' ' -f1-2
`;

/** Parse "total|security" (first line of the probe output). */
export function parsePkgs(raw: string): { total: number; security: number } {
  const first = (raw.trim().split('\n')[0]) ?? '';
  const [t, s] = first.split('|');
  return {
    total: Number(t ?? 0) || 0,
    security: Number(s ?? 0) || 0,
  };
}

export async function probePackages(t: SshTarget, fleet: Fleet, piId: string): Promise<void> {
  const raw = await runOnce(t, PKG_SCRIPT, 45_000);
  const lines = raw.trim().split('\n');
  const { total, security } = parsePkgs(raw);
  const list = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^\d+\|?\d*$/.test(l));
  fleet.setPackages(piId, { total, security, list });
}
