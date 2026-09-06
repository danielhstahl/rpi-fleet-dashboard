// Thin ssh2 wrapper: one-shot execs and streaming execs with cleanup.

import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';

export interface SshOpts {
  host: string;
  port: number;
  username: string;
  keyPath?: string;
  password?: string;
  readyTimeout?: number;
}

function toConnectConfig(opts: SshOpts): ConnectConfig {
  const cfg: ConnectConfig = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    readyTimeout: opts.readyTimeout ?? 6000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
  };
  if (opts.keyPath) {
    try {
      cfg.privateKey = readFileSync(opts.keyPath);
    } catch {
      // no key file → fall through to password if configured
    }
  }
  if (cfg.privateKey === undefined && opts.password) cfg.password = opts.password;
  return cfg;
}

export function connect(opts: SshOpts): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const timer = setTimeout(() => {
      c.end();
      reject(new Error(`connect timeout to ${opts.host}:${opts.port}`));
    }, (opts.readyTimeout ?? 6000) + 2000);
    c.on('ready', () => {
      clearTimeout(timer);
      resolve(c);
    });
    c.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    c.connect(toConnectConfig(opts));
  });
}

/** Run a command to completion; resolves with stdout. */
export function execOnce(opts: SshOpts, cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const c = new Client();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      c.end();
      reject(new Error(`exec timeout: ${cmd.slice(0, 60)}...`));
    }, timeoutMs);

    c.on('ready', () => {
      c.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          c.end();
          reject(err);
          return;
        }
        let out = '';
        stream.on('data', (d: Buffer) => {
          out += d.toString();
        });
        stream.stderr.on('data', (d: Buffer) => {
          out += d.toString();
        });
        stream.on('close', (code: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          c.end();
          if (code === 0) resolve(out);
          else reject(new Error(`exit ${code}: ${out.slice(-200)}`));
        });
      });
    });
    c.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.end();
      reject(err);
    });
    c.connect(toConnectConfig(opts));
  });
}

/**
 * Run a long-lived command (journals, upgrades). Resolves with a stop
 * function; `onExit` fires when the remote stream closes.
 */
export function execStream(
  opts: SshOpts,
  cmd: string,
  onData: (chunk: string) => void,
  onExit?: (code: number | null) => void,
  timeoutMs = 15 * 60_000,
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const timer = setTimeout(() => {
      try { c.end(); } catch { /* already gone */ }
      reject(new Error(`stream timeout: ${cmd.slice(0, 60)}...`));
    }, timeoutMs);

    c.on('ready', () => {
      c.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          c.end();
          reject(err);
          return;
        }
        let settled = false;
        const stop = (): void => {
          try { stream.close(); } catch { /* already closed */ }
        };
        const finish = (code: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          onExit?.(code);
          c.end();
          resolve(stop);
        };
        stream.on('data', (d: Buffer) => onData(d.toString()));
        stream.stderr.on('data', (d: Buffer) => onData(d.toString()));
        stream.on('close', (code: number) => finish(code ?? null));
        resolve(stop);
      });
    });
    c.on('error', (err: Error) => {
      clearTimeout(timer);
      c.end();
      reject(err);
    });
    c.connect(toConnectConfig(opts));
  });
}
