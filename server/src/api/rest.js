/**
 * REST API (read-heavy; mutations are small and explicit).
 */
import { Router } from 'express';

export function restRouter({ fleet, getProber, addPi, config }) {
  const r = Router();

  r.get('/healthz', (_req, res) => res.json({ ok: true, mode: config.mock ? 'mock' : 'live' }));

  // Fleet overview (same shape as the ws snapshot)
  r.get('/fleet', (_req, res) => res.json(fleet.snapshot()));

  // All attention items, worst first
  r.get('/attention', (_req, res) => {
    const items = [];
    for (const pi of fleet.sorted()) {
      for (const a of pi.attention) items.push({ pi: pi.id, name: pi.name, ...a });
    }
    items.sort((a, b) => (a.severity > b.severity ? 1 : -1));
    res.json({ items, total: items.length });
  });

  // Single Pi, full detail incl. history
  r.get('/pis/:id', (req, res) => {
    const d = fleet.detail(req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json(d);
  });

  r.get('/pis/:id/journal', (req, res) => {
    const pi = fleet.get(req.params.id);
    if (!pi) return res.status(404).json({ error: 'not found' });
    const limit = Math.min(500, Number(req.query.limit) || 200);
    res.json({ lines: pi.journal.lines.slice(-limit) });
  });

  // Manual add (real mode)
  r.post('/pis', (req, res) => {
    const { name, ip, user, sshPort, password } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required' });
    try {
      const pi = addPi({ name, ip, user: user || config.ssh.user, sshPort: sshPort || config.ssh.port, password });
      res.status(201).json({ id: pi.id, name: pi.name, ip: pi.ip });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.delete('/pis/:id', (req, res) => {
    const ok = fleet.removePi(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  r.post('/pis/:id/reprobe', async (req, res) => {
    const pi = fleet.get(req.params.id);
    if (!pi) return res.status(404).json({ error: 'not found' });
    const prober = getProber?.(pi.id);
    if (!prober) return res.status(503).json({ error: 'no prober (mock or unprobed Pi)' });
    try {
      await prober.probeHealth?.();
      await prober.probePkgs?.();
      res.json({ ok: true, online: fleet.get(pi.id).online });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Package upgrade (streams progress over ws as {type:'upgrade'})
  r.post('/pis/:id/upgrade', async (req, res) => {
    const pi = fleet.get(req.params.id);
    if (!pi) return res.status(404).json({ error: 'not found' });
    if (pi.upgrading) return res.status(409).json({ error: 'upgrade already in progress' });
    const prober = getProber?.(pi.id);
    if (!prober?.upgrade) return res.status(503).json({ error: 'no prober for this Pi' });
    prober.upgrade({
      onLine: (line) => req.app.locals.ws?.broadcast({ type: 'upgrade', pi: pi.id, line }),
      onDone: (ok) => req.app.locals.ws?.broadcast({ type: 'upgrade', pi: pi.id, done: true, ok }),
    });
    res.json({ started: true });
  });

  return r;
}

export default restRouter;
