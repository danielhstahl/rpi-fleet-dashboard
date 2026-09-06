// journalctl short-iso line parser.
//
// Lines look like:
//   2026-09-05T11:22:33Z 1234 systemd[1]: getty@tty1.service: Failed with result exit-code.
//   2026-09-05T11:22:34Z 1234 kernel: oom-killer: Killed process 1834 (chromium) ...
//
// The unit is the token before the first colon; the level is derived from
// the message (journalctl short-iso doesn't carry a level field).

import type { JournalLevel, JournalLine } from '../types.js';

export const JOURNAL_TAIL_CMD = 'journalctl --no-pager -n 200 --output=short-iso';

const OOM_RE = /oom-killer|out of memory/i;
const ERROR_RE = /\b(failed|failure|error|errors|denied|refused|segfault|panic|cannot|timeout|critical)\b/i;
const WARN_RE = /\bwarn(ing)?\b/i;

export function levelOf(message: string): JournalLevel {
  if (OOM_RE.test(message)) return 'oom';
  if (ERROR_RE.test(message)) return 'error';
  if (WARN_RE.test(message)) return 'warn';
  return 'info';
}

export function parseJournalLine(line: string): JournalLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const ts = parts[0];
  if (!ts) return null;
  const at = Date.parse(ts);
  if (!Number.isFinite(at)) return null;

  // After the timestamp: "<pid> <unit>[pid]: <message...>"
  const rest = parts.slice(1).join(' ');
  const m = rest.match(/^\S+\s+(.*?)(\[\d+\])?:\s*(.*)$/s);
  if (!m) return null;
  const unit = m[1] ?? '';
  const message = m[3] ?? '';
  if (!unit || !message) return null;

  return { at, level: levelOf(message), unit, message };
}

/** Build a raw short-iso journal line (used by tests and mock fleet). */
export function line(ts: string, pid: string, unit: string, message: string): string {
  return `${ts} ${pid} ${unit}: ${message}`;
}
