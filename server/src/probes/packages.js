/**
 * apt package state + upgrades.
 */
export const PKG_CMD = [
  `L=$(apt list --upgradable 2>/dev/null)`,
  `u=$(printf '%s' "$L" | grep -c upgradable)`,
  `s=$(printf '%s' "$L" | grep -c security)`,
  `printf '%s|%s' "$u" "$s"`,
].join('\n');

/** @param {string} stdout "total|security" */
export function parsePkgs(stdout) {
  const [total, security] = stdout.trim().split('|').map((s) => Number(s) || 0);
  return { total, security };
}

/** List upgradable packages for display (best effort). */
export const PKG_LIST_CMD = `apt list --upgradable 2>/dev/null | sed -n 's/ \\[upgradable\\]//p' | head -n 200`;

/**
 * Full upgrade, streamed. Non-interactive; -o Dpkg::Use-Pty=false keeps
 * output line-oriented for progress display.
 */
export const UPGRADE_CMD =
  'export DEBIAN_FRONTEND=noninteractive; ' +
  'apt-get update -qq && ' +
  'apt-get -y -o Dpkg::Use-Pty=false full-upgrade';

export default { PKG_CMD, parsePkgs, PKG_LIST_CMD, UPGRADE_CMD };
