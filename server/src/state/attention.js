/**
 * Attention engine: turns raw Pi state into ranked "needs work" items.
 * This is the core of the product: the UI points at whatever needs work.
 *
 * Severity: critical > warning > info. Score = sum of weights; fleets and
 * Pi cards sort by score so the worst machine is always on top.
 */

export const SEVERITY = { critical: 0, warning: 1, info: 2 };
export const WEIGHTS = { critical: 100, warning: 25, info: 1 };

const STALE_MS = 5 * 60 * 1000;

/** @returns {Array<{severity, rule, title, detail}>} attention items (may be empty) */
export function evaluateAttention(pi, now = Date.now()) {
  const items = [];
  const m = pi.metrics || {};
  const pkgs = pi.pkgs || {};
  const journal = pi.journal || {};

  // Reachability
  const fails = pi.probeFailures || 0;
  if (!pi.online) {
    if (fails >= 3) {
      items.push({
        severity: 'critical',
        rule: 'unreachable',
        title: `Unreachable (${fails} failed probes)`,
        detail: `Last attempt: ${pi.ip || '?'} ssh:${pi.sshPort || 22} — ${pi.lastProbeError || 'no probe yet'}`,
      });
    } else if (fails > 0) {
      // Initial probing (fails === 0) is not a problem yet — stay quiet.
      items.push({
        severity: 'warning',
        rule: 'unreachable',
        title: `Not responding yet (${fails} failed probes)`,
        detail: `Last attempt: ${pi.ip || '?'} — ${pi.lastProbeError || 'probing'}`,
      });
    }
  } else if (fails > 0) {
    items.push({
      severity: 'warning',
      rule: 'unstable',
      title: `Flaky: ${fails} consecutive failed probe${fails === 1 ? '' : 's'}`,
      detail: `Last error: ${pi.lastProbeError || 'unknown'} — will go offline after 3.`,
    });
  } else if (m.at && now - m.at > STALE_MS) {
    items.push({
      severity: 'warning',
      rule: 'stale',
      title: `Stale telemetry (${Math.round((now - m.at) / 60000)} min)`,
      detail: 'Pi answered earlier but metrics have not updated.',
    });
  }

  // Disk
  if (m.diskPct != null) {
    if (m.diskPct >= 95) {
      items.push({
        severity: 'critical',
        rule: 'disk',
        title: `Root disk at ${m.diskPct}%`,
        detail: 'Root filesystem is nearly full — services may fail to start.',
      });
    } else if (m.diskPct >= 85) {
      items.push({
        severity: 'warning',
        rule: 'disk',
        title: `Root disk at ${m.diskPct}%`,
        detail: 'Approaching capacity; consider cleaning caches or journal files.',
      });
    }
  }

  // Memory
  if (m.memPct != null && m.memPct >= 95) {
    items.push({
      severity: 'warning',
      rule: 'memory',
      title: `Memory at ${m.memPct}%`,
      detail: 'Sustained high memory pressure risks OOM kills.',
    });
  }

  // Temperature
  if (m.tempC != null && m.tempC !== '') {
    const t = Number(m.tempC);
    if (t >= 85) {
      items.push({
        severity: 'critical',
        rule: 'temp',
        title: `Thermal: ${t}°C`,
        detail: 'At/above Raspberry Pi throttling threshold (80–85°C).',
      });
    } else if (t >= 75) {
      items.push({
        severity: 'warning',
        rule: 'temp',
        title: `Temperature ${t}°C`,
        detail: 'Running warm; check airflow and load.',
      });
    }
  }

  // Load
  if (m.load1 != null && m.cores) {
    const perCore = m.load1 / m.cores;
    if (perCore >= 6) {
      items.push({
        severity: 'critical',
        rule: 'load',
        title: `Load ${m.load1} on ${m.cores} cores (${perCore.toFixed(1)}/core)`,
        detail: 'Severely overloaded; interactive use will be sluggish.',
      });
    } else if (perCore >= 3) {
      items.push({
        severity: 'warning',
        rule: 'load',
        title: `Load ${m.load1} on ${m.cores} cores (${perCore.toFixed(1)}/core)`,
        detail: 'Sustained high load.',
      });
    }
  }

  // Packages
  if (pkgs.security > 0) {
    items.push({
      severity: 'warning',
      rule: 'security-updates',
      title: `${pkgs.security} security update${pkgs.security === 1 ? '' : 's'} pending`,
      detail: `(${pkgs.total} total upgradable). Schedule an upgrade window.`,
    });
  } else if (pkgs.total > 0) {
    items.push({
      severity: 'info',
      rule: 'updates',
      title: `${pkgs.total} package update${pkgs.total === 1 ? '' : 's'} pending`,
      detail: 'Non-security updates available.',
    });
  }
  if (pi.upgrading) {
    items.push({
      severity: 'info',
      rule: 'upgrading',
      title: 'Package upgrade in progress',
      detail: 'apt full-upgrade is running; watch progress in the Packages tab.',
    });
  }

  // Journal health (windowed counts are maintained by the fleet store)
  if (journal.oomCount > 0) {
    items.push({
      severity: 'warning',
      rule: 'oom',
      title: `OOM kills in last hour (${journal.oomCount})`,
      detail: journal.lastOom || 'Out-of-memory killer active — check top memory consumers.',
    });
  }
  if (journal.errorCount >= 20) {
    items.push({
      severity: 'warning',
      rule: 'journal-errors',
      title: `${journal.errorCount} error-level log lines in last hour`,
      detail: journal.lastError || 'High error rate in journald.',
    });
  }

  items.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return items;
}

/** Weighted attention score for a Pi (higher = needs more attention). */
export function scoreItems(items) {
  return (items || []).reduce((sum, i) => sum + (WEIGHTS[i.severity] ?? 0), 0);
}

export default evaluateAttention;
