// REST API. Realtime happens over ws; this is for fetch, polling fallback,
// and actions (add/remove Pi, start upgrade, force reprobe).

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Fleet } from '../state/fleet.js';
import type { Prober, WsServerMsg } from '../types.js';

export interface AddManualPiInput {
  name: string;
  ip: string;
  /** Explicit SSH user (default: whatever ~/.ssh/config decides). */
  user?: string;
  /** ssh-config host alias to connect to instead of the IP. */
  sshHost?: string;
  sshPort?: number;
}

export interface AddManualPiResult {
  ok: boolean;
  error?: string;
  pi?: { id: string; name: string; ip: string };
}

export function restRouter(
  fleet: Fleet,
  opts: {
    probers?: Map<string, Prober>;
    addManualPi: (input: AddManualPiInput) => AddManualPiResult;
  },
): Router {
  const router = Router();

  // Express 5 types route params as `string | string[] | undefined` (wildcard
  // routes), so every :id handler funnels through this guard.
  const routeId = (req: Request, res: Response): string | null => {
    const v = req.params.id;
    if (typeof v !== 'string' || v === '') {
      res.status(404).json({ ok: false, error: 'not found' });
      return null;
    }
    return v;
  };

  router.get('/fleet', (_req: Request, res: Response) => {
    res.json(fleet.snapshot());
  });

  router.get('/attention', (_req: Request, res: Response) => {
    const items = fleet
      .list()
      .flatMap((p) => p.attention.map((a) => ({ pi: p.id, name: p.name, ...a })))
      .sort((a, b) =>
        (a.severity === 'critical' ? 0 : a.severity === 'warning' ? 1 : 2) -
        (b.severity === 'critical' ? 0 : b.severity === 'warning' ? 1 : 2) ||
        a.rule.localeCompare(b.rule));
    res.json(items);
  });

  router.get('/pis/:id', (req: Request, res: Response) => {
    const id = routeId(req, res);
    if (id === null) return;
    const d = fleet.detail(id);
    if (!d) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json(d);
  });

  router.get('/pis/:id/journal', (req: Request, res: Response) => {
    const id = routeId(req, res);
    if (id === null) return;
    const n = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
    res.json(fleet.tailJournal(id, n));
  });

  router.post('/pis', (req: Request, res: Response) => {
    const body = req.body as AddManualPiInput | undefined;
    if (!body || typeof body.name !== 'string' || typeof body.ip !== 'string' || !body.name || !body.ip) {
      res.status(400).json({ ok: false, error: 'name and ip are required' });
      return;
    }
    if (body.sshHost !== undefined && typeof body.sshHost !== 'string') {
      res.status(400).json({ ok: false, error: 'sshHost must be a string' });
      return;
    }
    const result = opts.addManualPi(body);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: result.error });
      return;
    }
    res.status(201).json({ ok: true, pi: result.pi });
  });

  router.delete('/pis/:id', (req: Request, res: Response) => {
    const id = routeId(req, res);
    if (id === null) return;
    const prober = opts.probers?.get(id);
    if (prober) prober.stopJournal();
    const removed = fleet.removePi(id);
    if (!removed) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/pis/:id/reprobe', (req: Request, res: Response) => {
    const id = routeId(req, res);
    if (id === null) return;
    const pi = fleet.get(id);
    if (!pi) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    const prober = opts.probers?.get(pi.id);
    if (prober) {
      void prober.probeHealth().catch(() => undefined);
      void prober.probePkgs().catch(() => undefined);
    }
    res.json({ ok: true });
  });

  return router;
}
