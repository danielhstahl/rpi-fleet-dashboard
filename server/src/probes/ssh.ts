// Remote command runner: shells out to the local `ssh` client.
//
// Using the system client (instead of the ssh2 library) means the server
// runs with the operator's existing `~/.ssh/config`: per-host User,
// IdentityFile, Port, ProxyJump, ControlMaster, … all apply, the
// ssh-agent is used automatically, and no keys or passwords need to be
// configured in the server itself. Everything runs as the normal user.
//
// Target precedence:
//   host  — Pi.sshHost (an ssh-config alias/hostname) if set, else Pi.ip
//   user  — Pi.user if set, else whatever ~/.ssh/config decides
//   port  — Pi.sshPort / SSH_PORT if non-default, else ssh's own default

import { spawn } from 'node:child_process';

export interface SshTarget {
  /** Pi IP, or an ssh-config host alias (Pi.sshHost). */
  host: string;
  /** Explicit user; omit to let `~/.ssh/config` decide. */
  user?: string;
  /** SSH port; omit (or 22) to let `~/.ssh/config` / the default decide. */
  port?: number;
}

const SSH_OPTS = [
  // Never prompt (no password or passphrase entry): auth problems must
  // fail fast so probes count as misses instead of hanging.
  '-o', 'BatchMode=yes',
  '-o', 'NumberOfPasswordPrompts=0',
  // New Pis join without pre-seeding known_hosts; *changed* keys are
  // still rejected.
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=6',
];

function sshArgs(t: SshTarget, cmd: string): string[] {
  const args = [...SSH_OPTS];
  if (t.port && t.port !== 22) args.push('-p', String(t.port));
  args.push(t.user ? `${t.user}@${t.host}` : t.host, cmd);
  return args;
}

/** Run a command to completion; resolves with stdout(+stderr) on exit 0. */
export function runOnce(t: SshTarget, cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn('ssh', sshArgs(t, cmd), { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ssh timeout to ${t.host} after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`ssh spawn failed: ${err.message}`));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`ssh exit ${code} for ${t.host}: ${out.trim().slice(-200)}`));
    });
  });
}

/**
 * Run a long-lived command (journal tails) and stream its output.
 * Resolves immediately with a stop function; `onExit` fires when the
 * process ends (code null when we stopped it, or it never ran).
 */
export function runStream(
  t: SshTarget,
  cmd: string,
  onData: (chunk: string) => void,
  onExit?: (code: number | null) => void,
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('ssh', sshArgs(t, cmd), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      // Give ssh a moment to exit cleanly, then force it.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000).unref();
    };
    child.stdout.on('data', (d: Buffer) => onData(d.toString()));
    child.stderr.on('data', (d: Buffer) => onData(d.toString()));
    child.on('error', (err: Error) => {
      if (!stopped) reject(new Error(`ssh spawn failed: ${err.message}`));
      onExit?.(null);
    });
    child.on('close', (code: number | null) => {
      onExit?.(stopped ? null : code ?? null);
    });
    resolve(stop);
  });
}
