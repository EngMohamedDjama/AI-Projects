# SGTD Industrial IoT Hub

A unified web platform to monitor and manage SGTD's industrial fleet across
**MQTT** and **LoRa / LoRaWAN** networks. Built as a fast, dependency-free
static front-end so it can be deployed anywhere — behind an Nginx, on a
Raspberry Pi gateway, or as part of a containerized stack.

![tech](https://img.shields.io/badge/MQTT-Mosquitto-22d3ee?style=flat-square)
![tech](https://img.shields.io/badge/LoRaWAN-ChirpStack-a78bfa?style=flat-square)
![tech](https://img.shields.io/badge/UI-Vanilla%20JS-0ea5e9?style=flat-square)

---

## Modules

| Page              | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `index.html`      | Operations overview — KPIs, throughput, live activity, alerts          |
| `devices.html`    | Searchable fleet inventory across all protocols and facilities          |
| `mqtt.html`       | MQTT broker health, topic browser, live message stream, quick-publish   |
| `lora.html`       | LoRaWAN gateways, end-devices, RSSI/SNR, uplink stream, SF distribution |
| `map.html`        | Geographic view of facilities, gateways and devices                     |
| `analytics.html`  | Energy, efficiency radar, heatmap, predictive-maintenance scores        |
| `alerts.html`     | Incident queue with severity filters and acknowledgement                |
| `settings.html`   | Broker, network-server, retention, notifications and branding configs   |

## Visuals

* Dark industrial theme — deep navy `#050d1b` with cyan accent `#22d3ee`
* SGTD hex-network logo (`assets/img/sgtd-logo.svg`)
* Chart.js for line / bar / radar / doughnut charts
* Leaflet + Carto dark tiles for the network map
* Lucide-style inline SVG icon set (`assets/js/icons.js`)
* Inter + JetBrains Mono typography

## Run locally

No build step required.

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# Or just open index.html in a browser
```

## Wire it to real infrastructure

The current build streams **simulated** telemetry through `assets/js/mock-data.js`
so the UI can be demoed without a backend. To go live, replace `MockBus` with a
real MQTT-over-WebSocket client:

```html
<script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>
<script>
  const client = mqtt.connect('wss://broker.sgtd.local:8884');
  client.subscribe('sgtd/#');
  client.on('message', (topic, payload) => {
    BUS.dispatchEvent(new CustomEvent('telemetry', {
      detail: parseTelemetry(topic, payload),
    }));
  });
</script>
```

For LoRa, point ChirpStack's MQTT integration at the same broker (default:
`application/+/device/+/event/up`) — the dashboard will pick the uplinks up
through the same bus.

## Suggested back-end stack

* **MQTT broker** — Eclipse Mosquitto 2.x (TLS 1.3, ACL per facility)
* **LoRaWAN NS** — ChirpStack 4.x with PostgreSQL + Redis
* **Time-series DB** — InfluxDB 2 or TimescaleDB
* **Visualization layer** — this dashboard (or Grafana for ops-team drill-down)
* **Alerting** — Node-RED or a custom rules engine forwarding to email / SMS / Slack

## Branding

Swap the wordmark by replacing `assets/img/sgtd-logo.svg` with the official
SGTD asset. Theme colours live in `:root` in `assets/css/style.css` — change
the `--accent-*` and `--brand-*` ranges to match the brand book.

---

© SGTD — Industrial IoT Hub
