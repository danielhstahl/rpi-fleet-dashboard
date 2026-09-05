/**
 * ssh2 connection pool: one persistent connection per host, auto-reuse,
 * exec with timeout, and streaming exec for journalctl -f / apt upgrade.
 */
import { Client } from 'ssh2';
import fs from 'node:fs';

export class SshPool {
  constructor(cfg) {
    this.cfg = cfg;
    this.conns = new Map();
  }

  keyFor(host, port) {
    return `${this.cfg.user}@${host}:${port}`;
  }

  authOptions(host, port) {
    const base = {
      host,
      port,
      username: this.cfg.user,
      readyTimeout: 8000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      tryKeyboard: false,
    };
    if (this.cfg.password) {
      base.password = this.cfg.password;
    } else {
      try {
        base.privateKey = fs.readFileSync(this.cfg.keyPath);
      } catch {
        const err = new Error(`no SSH key at ${this.cfg.keyPath} (set SSH_KEY or SSH_PASSWORD)`);
        err.code = 'NO_AUTH';
        throw err;
      }
    }
    return base;
  }

  async connect(host, port = this.cfg.port) {
    const key = this.keyFor(host, port);
    const existing = this.conns.get(key);
    if (existing && !existing.closed) return existing;

    const conn = new Client();
    await new Promise((resolve, reject) => {
      const fail = (e) => {
        this.conns.delete(key);
        try { conn.end(); } catch { /* ignore */ }
        reject(e);
      };
      conn.once('ready', () => resolve(conn));
      conn.once('error', fail);
      conn.once('timeout', () => fail(new Error(`ssh connect timeout to ${host}:${port}`)));
      try {
        conn.connect(this.authOptions(host, port));
      } catch (e) {
        fail(e);
      }
    });
    conn.once('close', () => this.conns.delete(key));
    conn.once('error', () => this.conns.delete(key));
    this.conns.set(key, conn);
    return conn;
  }

  /** Run a command to completion. */
  async exec(host, cmd, { port, timeoutMs = this.cfg.timeoutMs } = {}) {
    const conn = await this.connect(host, port);
    return await new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error(`exec timeout after ${timeoutMs}ms`)), timeoutMs);
      const finish = (err, result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(result);
      };
      conn.exec(cmd, (err, stream) => {
        if (err) return finish(err);
        let out = '';
        let errOut = '';
        stream.on('data', (d) => (out += d.toString()));
        stream.stderr.on('data', (d) => (errOut += d.toString()));
        stream.on('close', (code) => {
          if (code === undefined || code === null) return finish(new Error('ssh stream closed unexpectedly'));
          if (code === 0) return finish(null, { stdout: out, stderr: errOut });
          finish(new Error(`remote exit ${code}: ${(errOut || out).trim().slice(0, 300)}`));
        });
        stream.on('error', (e) => finish(e));
      });
    });
  }

  /**
   * Run a long-lived streaming command (journalctl -f, apt upgrade).
   * onLine fires per output line; onExit(code) when the channel closes.
   * @returns {Promise<() => void>} a stop function that kills the channel.
   */
  async execStream(host, cmd, { port, onLine, onExit } = {}) {
    const conn = await this.connect(host, port);
    let channel;
    await new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        channel = stream;
        resolve();
      });
    });
    let buf = '';
    channel.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (l) onLine?.(l);
      }
    });
    channel.stderr.on('data', (d) => {
      const s = d.toString();
      // apt writes progress to stderr; surface it as lines too
      s.split('\n').filter(Boolean).forEach((l) => onLine?.(l));
    });
    channel.on('close', (code) => {
      if (buf) onLine?.(buf);
      onExit?.(code ?? 0);
    });
    channel.on('error', () => onExit?.(1));
    return () => {
      try { channel.close(); } catch { /* ignore */ }
    };
  }

  async closeAll() {
    for (const c of this.conns.values()) {
      try { c.end(); } catch { /* ignore */ }
    }
    this.conns.clear();
  }
}

export default SshPool;
