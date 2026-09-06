import type { PiDetailData, SnapshotPi } from '../types';

interface PackagesTabProps {
  pi: SnapshotPi;
  detail: PiDetailData | null;
}

/**
 * Read-only package state: what's pending on this Pi (apt list, which a
 * normal user can run). The dashboard itself never applies upgrades —
 * that needs root, so it's done on the Pi (console or your own tooling).
 */
export default function PackagesTab({ pi, detail }: PackagesTabProps) {
  // detail.pkgs has list/at; the snapshot only has counts — merge explicitly.
  const pkgs = {
    total: detail?.pkgs.total ?? pi.pkgs.total,
    security: detail?.pkgs.security ?? pi.pkgs.security,
    checked: detail?.pkgs.checked ?? pi.pkgs.checked,
    at: detail?.pkgs.at ?? null,
    list: detail?.pkgs.list ?? [],
  };
  const list = pkgs.list;

  return (
    <div className="tab-body">
      <div className="pkgs-summary">
        <div className="pkg-count total">{pkgs.total} <small>upgradable</small></div>
        <div className={`pkg-count ${pkgs.security > 0 ? 'sec' : 'ok'}`}>{pkgs.security} <small>security</small></div>
        <div className="muted">{pkgs.checked && pkgs.at ? `checked ${new Date(pkgs.at).toLocaleTimeString()}` : 'not checked yet'}</div>
      </div>

      {list.length > 0 ? (
        <div className="pkg-list">
          <h3>Upgradable (top {list.length})</h3>
          {list.map((p) => (
            <div key={p} className={`pkg ${/security/.test(p) ? 'sec' : ''}`}>
              {p}
            </div>
          ))}
        </div>
      ) : (
        <div className="banner okb">✓ Nothing pending{pkgs.checked ? '' : ' (not checked yet)'}</div>
      )}

      {pkgs.total > 0 && (
        <p className="muted pkg-note">
          Upgrades need root — apply them on the Pi itself (
          <code>sudo apt full-upgrade</code>) or via your own tooling.
        </p>
      )}
    </div>
  );
}
