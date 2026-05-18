# SGTD Industrial IoT Hub

A functional, Datacake-style IIoT platform for SGTD. Manage MQTT, LoRaWAN and
HTTP devices, build dashboards with widgets, write automation rules, manage
users and roles. Self-hosted, single-process Node.js.

![status](https://img.shields.io/badge/status-alpha-22d3ee?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-Node.js%2020%2B-0ea5e9?style=flat-square)
![storage](https://img.shields.io/badge/storage-SQLite%20(WAL)-a78bfa?style=flat-square)

## Features

- **Multi-user with roles** — admin / editor / viewer. First-run wizard creates
  the admin and seeds a sample fleet so the platform never looks empty.
- **Devices** — MQTT, HTTP and LoRaWAN protocols. Each device has typed fields
  (key / label / unit / min / max), automatic online/offline detection, per-
  device ingestion tokens, history retention.
- **Dashboards** — multiple per workspace, with a drag-anywhere widget grid.
  Widgets: stat, line chart, gauge, boolean, map, alerts feed, header.
- **Automation rules** — threshold-based with severity, generate alerts that
  can be acknowledged from the UI.
- **Live everywhere** — every page subscribes to a WebSocket stream so values,
  charts and alerts update instantly without polling.
- **Embedded MQTT broker** (Aedes) on port 1883. Devices authenticate with
  `username = serial`, `password = device_token`.
- **LoRaWAN webhook** — ChirpStack v4 compatible. Point ChirpStack's HTTP
  integration at `/api/v1/integrations/lorawan` and devices match by DevEUI.
- **REST API** — every action exposed; usable for headless integrations.
- **Workspace API tokens** for fleet-wide automation.

## Run locally

Requires Node.js 18+. SQLite is bundled via `better-sqlite3`.

```bash
npm install
npm start
```

Open http://localhost:8080 — you'll be taken through the first-run wizard. The
MQTT broker also starts on port 1883.

The database lives in `data/sgtd.db` (SQLite WAL). Back up that one file to
preserve all platform state.

## Deploy

Three configs are included so the platform comes online with one click:

- **Render** — push the repo, click "New Web Service from blueprint", point at
  the repo. `render.yaml` is auto-detected. Free tier works.
- **Fly.io** — `flyctl launch --copy-config` then `flyctl deploy`. Includes
  TCP port 1883 mapping for the MQTT broker.
- **Docker / Kubernetes** — `docker build . -t sgtd-iiot && docker run -p 8080:8080 -p 1883:1883 sgtd-iiot`.

Set `SGTD_JWT_SECRET` to a long random string in any deployment; otherwise the
platform generates one on first run and stores it in the DB.

## Sending data

### HTTP

```bash
curl -X POST https://<host>/api/v1/ingest \
  -H "Authorization: Bearer <device_token>" \
  -H "Content-Type: application/json" \
  -d '{"temp": 24.5, "humidity": 61}'
```

### MQTT

```bash
mosquitto_pub -h <host> -p 1883 \
  -u <serial> -P <device_token> \
  -t sgtd/<serial>/temp -m 24.5
```

You can also publish a JSON frame to `sgtd/<serial>` with multiple fields at
once: `{"temp": 24.5, "humidity": 61}`.

### LoRaWAN (ChirpStack)

In ChirpStack 4, under Application → Integrations → HTTP, point endpoint URLs at:

```
https://<host>/api/v1/integrations/lorawan
```

The platform matches devices by DevEUI (case-insensitive) and ingests anything
in `object`. RSSI and SNR are picked up automatically from `rxInfo[0]`.

## Architecture

```
┌──────────────┐    ┌──────────────────────────────────────────────┐
│  Browser SPA │◄──►│ Node.js single process                       │
│  (vanilla)   │    │                                              │
└──────────────┘    │  ├─ HTTP API   (REST + sessions + tokens)    │
                    │  ├─ WebSocket  (live telemetry / alerts)     │
                    │  ├─ MQTT       (Aedes broker, TCP :1883)     │
                    │  ├─ Rules engine (synchronous per-frame)     │
                    │  └─ Simulator  (mock fleet for empty installs)│
                    │                                              │
                    │   SQLite (data/sgtd.db, WAL mode)            │
                    └──────────────────────────────────────────────┘
```

## Tech

- Vanilla JS + Chart.js front-end (no React build step)
- `better-sqlite3` storage
- `aedes` embedded MQTT broker
- `ws` WebSocket server
- `bcryptjs` + `jsonwebtoken` for auth

## Roadmap

- Custom widget code editor (Datacake-style)
- Downlinks for LoRaWAN
- Notification channels (email/Slack/webhook outbound)
- Multi-workspace (org/workspace separation)
- CSV / Parquet export

---

© SGTD — Industrial IoT Hub
