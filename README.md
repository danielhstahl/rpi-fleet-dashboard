# pi-fleet

A **local-network fleet manager for Raspberry Pis**: one dashboard to see every
Pi's health, read its journal, update/upgrade its packages, watch its network
traffic — and above all, have the UI **point your attention at whatever needs
work**.

Node (Express + ws + ssh2) server, React (Vite) front end.

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
npm run build            # builds web/dist
npm start                # server serves the dashboard + API on :8787
```

## Using real Pis

The server talks to your Pis over **SSH** (agentless on the Pi side is *not*
required — a plain SSH key is the auth path):

```bash
SSH_USER=pi SSH_KEY=~/.ssh/id_ed25519 npm start
# or password auth:
SSH_PASSWORD=raspberry npm start
```

### Discovery

Two ways Pis get into the fleet:

1. **Manual add** — `POST /api/pis {name, ip}` (e.g. `curl -X POST
   localhost:8787/api/pis -d '{"name":"pi-cam","ip":"192.168.1.50"}'` with
   JSON headers).
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

### Per-Pi SSH auth

Global defaults come from `SSH_USER` / `SSH_KEY` / `SSH_PASSWORD`. (Per-Pi
credential overrides are on the roadmap — see open beads.)

## What gets monitored

| Signal | How | Cadence |
|---|---|---|
| CPU, memory, disk, temp, load, uptime | one-shot `sh` script over SSH (one round trip) | 15 s |
| Network traffic (per interface) | `/sys/class/net/*/statistics` deltas | 5 s |
| Upgradable packages + security count | `apt list --upgradable` | 5 min |
| Journal | `journalctl -n 200` history + `journalctl -f` live tail **only while someone is viewing** | on view |
| Upgrades | streamed `apt-get full-upgrade` with live progress in the UI | manual |

## The attention engine

Every state change re-evaluates rules; each Pi gets a weighted score
(critical = 100, warning = 25, info = 1) and the UI ranks everything by it.

| Rule | Severity |
|---|---|
| Unreachable (≥3 failed probes) | critical |
| Root disk ≥ 95% | critical |
| Temp ≥ 85 °C (throttling) | critical |
| Load ≥ 6× cores | critical |
| Flaky (1–2 failed probes) | warning |
| Stale telemetry (>5 min) | warning |
| Disk ≥ 85%, mem ≥ 95%, temp ≥ 75 °C, load ≥ 3× cores | warning |
| Security updates pending | warning |
| OOM kills in last hour | warning |
| ≥20 error-level journal lines/hour | warning |
| Plain updates pending, upgrade running | info |

## API

- `GET /api/fleet` — lightweight fleet snapshot (also broadcast over WS every 5 s)
- `GET /api/attention` — all attention items, worst first
- `GET /api/pis/:id` — full Pi detail incl. history series
- `GET /api/pis/:id/journal?limit=200` — recent journal lines
- `POST /api/pis` — `{name, ip, user?, sshPort?, password?}` manual add
- `DELETE /api/pis/:id` — remove a Pi
- `POST /api/pis/:id/upgrade` — start `apt full-upgrade` (progress over WS)
- `POST /api/pis/:id/reprobe` — force health + package probe

WebSocket `ws://host:8787/ws`:
- server → `fleet` (5 s snapshot), `journal {pi, line}`, `upgrade {pi, line|done, ok}`
- client → `subscribe {pi}` / `unsubscribe {pi}` (journal tail only streams while subscribed)

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP/WS port |
| `FLEET_MOCK` | — | `1` = simulated fleet (demo/dev) |
| `SSH_USER` | `pi` | SSH user |
| `SSH_KEY` | `~/.ssh/id_ed25519` | private key |
| `SSH_PASSWORD` | — | password auth (overrides key) |
| `SSH_PORT` | `22` | SSH port |
| `PROBE_INTERVAL_MS` | `15000` | health probe cadence |
| `NET_INTERVAL_MS` | `5000` | traffic sampling cadence |
| `PKG_INTERVAL_MS` | `300000` | apt state cadence |

## Tests

```bash
npm test        # node:test suite: attention rules, fleet store, parsers, mock fleet
npm run build   # production build of the dashboard
```

## Known limitations / roadmap

- Per-Pi SSH credentials (currently global env defaults)
- Pi-side agent that advertises mDNS + optionally reports metrics directly
  (push instead of poll) — would allow monitoring without SSH
- Alert notifications (e.g. webhook/Telegram when a critical appears)
- Auth on the dashboard itself (it currently trusts your LAN)
