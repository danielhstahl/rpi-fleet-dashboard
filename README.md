# pi-fleet

A **local-network fleet manager for Raspberry Pis**: one dashboard to see every
Pi's health, read its journal, see which package updates are pending, watch its
network traffic — and above all, have the UI **point your attention at whatever
needs work**.

Node (Express + ws) server and React (Vite) front end, both in
**strict TypeScript** (`strict`, `noUncheckedIndexedAccess`,
`noUnusedLocals`) — `tsc` type-checks are part of the build and dev loop.

```
pi-fleet/
  server/   fleet state, attention engine, discovery, SSH probes, REST + WS
  web/      React dashboard (attention panel, fleet grid, Pi detail tabs)
```

## Quick start (no hardware needed — mock fleet)

```bash
npm install
FLEET_MOCK=1 npm run dev:server    # terminal 1: API + ws on :8787
npm run dev:web                    # terminal 2: vite dev server on :5173
```

Open http://localhost:5173 — you'll get four simulated Pis, one of which is
offline (critical), one with a nearly-full disk and running hot, and one
throwing OOM kills with pending security updates. The attention panel sorts
all of it worst-first.

### Production-ish single process

```bash
npm run build            # server tsc -> server/dist, web tsc + vite -> web/dist
npm start                # server serves the dashboard + API on :8787
```

## Using real Pis

The server talks to your Pis over **SSH** using your *local* `ssh` client — it
shells out to `ssh`, so your existing `~/.ssh/config` just works: per-host
`User`, `IdentityFile`, `Port`, `ProxyJump`, ssh-agent, control sockets, all
of it. No credentials are configured in pi-fleet, and nothing needs root:

```bash
npm start    # probes connect as whatever your ssh config says
```

Requirements per Pi: an SSH user your local machine can already log in as
(key or agent; no interactive passwords — probes run in batch mode), and
`journalctl` + `apt` available (standard on Raspberry Pi OS). `apt list
--upgradable` (the package probe) works for a normal user; only *applying*
upgrades needs root, which is deliberately not something the dashboard does —
see the Packages tab on each Pi.

### Discovery

Two ways Pis get into the fleet:

1. **Manual add** — `POST /api/pis {name, ip}` (e.g. `curl -X POST
   localhost:8787/api/pis -H 'Content-Type: application/json' -d '{"name":"pi-cam","ip":"192.168.1.50"}'` with
   JSON headers).  If using `~/.ssh/config`, put your Host rather than the IP.
2. **mDNS** — the server watches `_pi-fleet._tcp`. Run the tiny agent on each
   Pi to advertise it (systemd unit below).

Pi-side agent (optional, for mDNS auto-discovery):

```ini
# /etc/systemd/system/pi-fleet-advertise.service
[Unit]
Description=Advertise this Pi to pi-fleet (mDNS)
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 - <<'EOF'
# minimal mDNS responder using avahi if installed; otherwise no-op
EOF

[Install]
WantedBy=multi-user.target
```

Simpler: if Avahi is installed on the Pi, `avahi-publish-service pi-fleet \
_tcp 8787` in a oneshot unit advertises the service. Manual add always works
regardless.

### Per-Pi connection overrides

If a Pi isn't reachable the way your `~/.ssh/config` says, manual add accepts
optional overrides (they win over the config file):

```bash
curl -X POST localhost:8787/api/pis -H 'Content-Type: application/json' \
  -d '{"name":"pi-cam","ip":"192.168.1.50","sshHost":"pi-cam","user":"pi","sshPort":2222}'
```

`sshHost` connects to an ssh-config alias (e.g. your `Host pi-cam` stanza)
instead of the IP; `user`/`sshPort` pin user/port. Omit all three and pi-fleet
connects exactly as `ssh <ip>` would from your machine.

### Persistence

In real mode the fleet is mirrored to a sqlite database (built-in
`node:sqlite`, no native deps) at `FLEET_DB` (default `./fleet.db`):

- Pi membership (name, ip, user, sshHost, sshPort, source, addedAt)
- the retained history rings (cpu/mem/disk/temp/load + per-interface
  network rates), pruned to the same capacities as the in-memory rings
- the per-Pi journal tail (400 lines) and its sequence
- the latest package-check state

A server restart therefore does **not** lose the fleet or its history. Online
state and probe-failure counts intentionally are not persisted — probes
re-establish connectivity after the restart. Mock mode never touches the
database (its Pis are re-seeded on every start). Delete the db file to reset.

## What gets monitored

| Signal | How | Cadence |
|---|---|---|
| CPU, memory, disk, temp, load, uptime | one-shot `sh` script over SSH (one round trip) | 15 s |
| Network traffic (per interface) | `/sys/class/net/*/statistics` deltas | 5 s |
| Upgradable packages + security count | `apt list --upgradable` | 5 min |
| Journal | `journalctl -n 200` history + `journalctl -f` live tail **only while someone is viewing** | on view |

## The attention engine

Every state change re-evaluates rules; each Pi gets a weighted score
(critical = 100, warning = 25, info = 1) and the UI ranks everything by it.

| Rule | Severity |
|---|---|
| Unreachable (≥3 failed probes) | critical |
| Root disk ≥ 95% | critical |
| Temp ≥ 85 °C (throttling) | critical |
| Load ≥ 6× cores | critical |
| Intermittent (1–2 failed probes) | warning |
| Stale telemetry (>5 min) | warning |
| Disk ≥ 85%, mem ≥ 95%, temp ≥ 75 °C, load ≥ 3× cores | warning |
| Security updates pending | warning |
| OOM kills in last hour | warning |
| ≥20 error-level journal lines/hour | warning |
| Plain updates pending | info |

## API

- `GET /api/fleet` — lightweight fleet snapshot (also broadcast over WS every 5 s)
- `GET /api/attention` — all attention items, worst first
- `GET /api/pis/:id` — full Pi detail incl. history series
- `GET /api/pis/:id/journal?limit=200` — recent journal lines
- `POST /api/pis` — `{name, ip, user?, sshHost?, sshPort?}` manual add
- `DELETE /api/pis/:id` — remove a Pi
- `POST /api/pis/:id/reprobe` — force health + package probe

WebSocket `ws://host:8787/ws`:
- server → `fleet` (5 s snapshot), `journal {pi, line}`
- client → `subscribe {pi}` / `unsubscribe {pi}` (journal tail only streams while subscribed)

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP/WS port |
| `FLEET_MOCK` | — | `1` = simulated fleet (demo/dev; no persistence) |
| `FLEET_DB` | `./fleet.db` | sqlite file for fleet persistence (real mode only) |
| `SSH_PORT` | `22` | SSH port (used when a Pi doesn't set one; `~/.ssh/config` still decides auth) |
| `PROBE_INTERVAL_MS` | `15000` | health probe cadence |
| `NET_INTERVAL_MS` | `5000` | traffic sampling cadence |
| `PKG_INTERVAL_MS` | `300000` | apt state cadence |

## Quality gates

```bash
npm run typecheck   # tsc: server (src+test) and web (src+test+config)
npm test            # server: node:test suite (38 tests) via tsx;
                    # web: renderToString smoke test for every component path
npm run build       # server tsc -> dist/ + web tsc + vite production build
```

A clean `rm -rf node_modules && npm ci` is expected to pass all three — the
lockfile is the source of truth for installs.

## Known limitations / roadmap

- Pi-side agent that advertises mDNS + optionally reports metrics directly
  (push instead of poll) — would allow monitoring without SSH
- Alert notifications (e.g. webhook/Telegram when a critical appears)
- Auth on the dashboard itself (it currently trusts your LAN)
