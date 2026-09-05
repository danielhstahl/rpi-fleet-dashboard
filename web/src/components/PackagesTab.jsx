import { useState } from 'react';

/**
 * Package state + one-click upgrade with live progress (ws 'upgrade' events).
 */
export default function PackagesTab({ pi, detail, upgrades, clearUpgrade }) {
  const [starting, setStarting] = useState(false);
  const up = upgrades;
  const pkgs = detail?.pkgs || pi.pkgs || {};
  const list = pkgs.list || [];

  async function startUpgrade() {
    setStarting(true);
    try {
      const r = await fetch(`/api/pis/${pi.id}/upgrade`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || `upgrade failed: ${r.status}`);
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="tab-body">
      <div className="pkgs-summary">
        <div className="pkg-count total">{pi.upgrading ? '—' : pkgs.total ?? 0} <small>upgradable</small></div>
        <div className={`pkg-count ${pkgs.security > 0 ? 'sec' : 'ok'}`}>{pkgs.security ?? 0} <small>security</small></div>
        <div className="muted">{pkgs.checked ? `checked ${new Date(pkgs.at).toLocaleTimeString()}` : 'not checked yet'}</div>
      </div>

      {pi.upgrading || (up && !up.done) ? (
        <div className="upgrade-progress">
          <div className="banner upgrading">▲ apt full-upgrade in progress — live output:</div>
          <pre className="upgrade-log">{(up?.lines || []).slice(-30).join('\n')}</pre>
        </div>
      ) : up?.done !== undefined && up?.done !== null ? (
        <div className={`banner ${up.done ? 'okb' : 'critb'}`}>
          {up.done ? '✓ Upgrade finished successfully' : '✕ Upgrade finished with errors — see log below'}
          <button className="linkish" onClick={() => clearUpgrade(pi.id)}>dismiss</button>
        </div>
      ) : null}

      {list.length > 0 && !pi.upgrading && (
        <div className="pkg-list">
          <h3>Upgradable (top {list.length})</h3>
          {list.map((p) => (
            <div key={p} className={`pkg ${/security/.test(p) ? 'sec' : ''}`}>{p}</div>
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
