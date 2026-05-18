// Embedded MQTT broker (Aedes).
// Devices authenticate with their device_token and publish to:
//    sgtd/<serial>/<field>      (single value, JSON or scalar)
//    sgtd/<serial>              (full JSON frame: {"field": value, ...})

const net = require('net');
const aedes = require('aedes');
const { db } = require('./db');
const { ingest } = require('./telemetry');

function start({ port = 1883 } = {}) {
  const broker = aedes();

  broker.authenticate = function (client, username, password, callback) {
    // username = device serial, password = device_token
    if (!username || !password) return callback(null, false);
    const token = password.toString();
    const device = db.prepare('SELECT * FROM devices WHERE serial = ? AND device_token = ?')
      .get(username, token);
    if (!device) {
      const err = new Error('Authentication failed');
      err.returnCode = 4; // bad user/pass
      return callback(err, null);
    }
    client.device = device;
    callback(null, true);
  };

  broker.on('publish', (packet, client) => {
    if (!client || !client.device) return;
    const topic = packet.topic;
    if (!topic.startsWith('sgtd/')) return;
    const parts = topic.split('/');
    const serial = parts[1];
    if (serial !== client.device.serial) return;
    const payload = packet.payload.toString();
    let frame = null;
    if (parts.length >= 3) {
      // single field
      let val;
      try { val = JSON.parse(payload); }
      catch { val = isNaN(Number(payload)) ? payload : Number(payload); }
      frame = { [parts[2]]: val };
    } else {
      try { frame = JSON.parse(payload); }
      catch { return; }
    }
    if (frame && typeof frame === 'object') {
      ingest(client.device, frame);
    }
  });

  const server = net.createServer(broker.handle);
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[mqtt] broker listening on tcp://0.0.0.0:${port}`);
      resolve({ broker, server });
    });
  });
}

module.exports = { start };
