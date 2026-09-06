import { useState } from 'react';
import type { PiDetailData, SnapshotPi, UpgradeState } from '../types';

interface PackagesTabProps {
  pi: SnapshotPi;
  detail: PiDetailData | null;
  upgrades: UpgradeState | undefined;
  clearUpgrade: (pi: string) => void;
}

/**
 * Package state + one-click upgrade with live progress (ws 'upgrade' events).
 */
export default function PackagesTab({ pi, detail, upgrades, clearUpgrade }: PackagesTabProps) {
  const [starting, setStarting] = useState(false);
  const up = upgrades;
  // detail.pkgs has list/at; the snapshot only has counts — merge explicitly.
  const pkgs = {
    total: detail?.pkgs.total ?? pi.pkgs.total,
    security: detail?.pkgs.security ?? pi.pkgs.security,
    checked: detail?.pkgs.checked ?? pi.pkgs.checked,
    at: detail?.pkgs.at ?? null,
    list: detail?.pkgs.list ?? [],
  };
  const list = pkgs.list;

  async function startUpgrade() {
    setStarting(true);
    try {
      const r = await fetch(`/api/pis/${pi.id}/upgrade`, { method: 'POST' });
      if (!r.ok) {
        const d: unknown = await r.json().catch(() => ({}));
        const err =
          typeof d === 'object' && d !== null && typeof (d as { error?: unknown }).error === 'string'
            ? (d as { error: string }).error
            : `upgrade failed: ${r.status}`;
        alert(err);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="tab-body">
      <div className="pkgs-summary">
        <div className="pkg-count total">{pi.upgrading ? '—' : pkgs.total} <small>upgradable</small></div>
        <div className={`pkg-count ${pkgs.security > 0 ? 'sec' : 'ok'}`}>{pkgs.security} <small>security</small></div>
        <div className="muted">{pkgs.checked && pkgs.at ? `checked ${new Date(pkgs.at).toLocaleTimeString()}` : 'not checked yet'}</div>
      </div>

      {pi.upgrading || (up && up.done === null) ? (
        <div className="upgrade-progress">
          <div className="banner upgrading">▲ apt full-upgrade in progress — live output:</div>
          <pre className="upgrade-log">{(up?.lines ?? []).slice(-30).join('\n')}</pre>
        </div>
      ) : up && up.done !== null ? (
        <div className={`banner ${up.done ? 'okb' : 'critb'}`}>
          {up.done ? '✓ Upgrade finished successfully' : '✕ Upgrade finished with errors — see log above'}
          <button className="linkish" onClick={() => clearUpgrade(pi.id)}>dismiss</button>
        </div>
      ) : null}

      {list.length > 0 && !pi.upgrading && (
        <div className="pkg-list">
          <h3>Upgradable (top {list.length})</h3>
          {list.map((p) => (
            <div key={p} className={`pkg ${/security/.test(p) ? 'sec' : ''}`}>
              {p}
            </div>
          ))}
        </div>
      )}

      {!pi.upgrading && (
        <button className="btn primary" onClick={startUpgrade} disabled={starting}>
          {starting ? 'Starting…' : `Upgrade packages${pkgs.total ? ` (${pkgs.total})` : ''}`}
        </button>
      )}
    </div>
  );
}
