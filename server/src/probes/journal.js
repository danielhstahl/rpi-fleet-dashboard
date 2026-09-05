/**
 * journalctl helpers: history fetch, live follow, and short-iso line parsing.
 * Output format: `2026-09-05T18:00:00.123456+0000 hostname unit[pid]: message`
 */

export const JOURNAL_TAIL = 'journalctl -n 200 --no-pager -o short-iso';
export const JOURNAL_FOLLOW = 'journalctl -f --no-pager -o short-iso -n 0';

/** Build a short-iso style line (used by the mock fleet). */
export function line(ts, host, unit, msg) {
  return `${ts} ${host} ${unit}: ${msg}`;
}

/**
 * @param {string} raw short-iso journal line
 * @returns {{at:number, level:'info'|'warn'|'error'|'oom', unit:string, message:string}|null}
 */
export function parseJournalLine(raw) {
  const m = /^(\S+)\s+(\S+)\s+([^\s:\[]+)(?:\[(\d+)\])?:\s*(.*)$/.exec(raw.trim());
  if (!m) return null;
  const [, ts, _host, unit, _pid, msg] = m;
  let level = 'info';
  if (/out of memory|oom[- ]killer|invoked oom/i.test(msg)) level = 'oom';
  else if (/\b(emerg|alert|crit|err(ors)?)\b|failed|failure/i.test(raw)) level = 'error';
  else if (/\b(warn(ing)?|notice)\b/i.test(raw)) level = 'warn';
  return {
    at: Date.parse(ts) || Date.now(),
    level,
    unit,
    message: msg.slice(0, 500),
  };
}

export default { JOURNAL_TAIL, JOURNAL_FOLLOW, parseJournalLine, line };
