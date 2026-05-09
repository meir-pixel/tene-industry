const ModbusRTU = require('modbus-serial');

// Machine configuration
// mode: 'tcp'  → Modbus TCP or TCP-to-RTU gateway  (host + port)
// mode: 'rtu'  → Modbus RTU direct serial           (serialPort + baudRate)
const MACHINES_CONFIG = [
  { id: 1, name: 'מכונה 1 – כיפוף', mode: 'tcp', host: '192.168.1.101', port: 502, unitId: 1, counterReg: 0, statusReg: 1 },
  { id: 2, name: 'מכונה 2 – כיפוף', mode: 'tcp', host: '192.168.1.102', port: 502, unitId: 2, counterReg: 0, statusReg: 1 },
  // RTU example:
  // { id: 3, name: 'מכונה 3', mode: 'rtu', serialPort: 'COM3', baudRate: 9600, unitId: 3, counterReg: 0, statusReg: 1 },
];

const STATUS_MAP = { 0: 'כבוי', 1: 'ממתין', 2: 'בייצור', 3: 'תקלה' };

class ModbusService {
  constructor() {
    this.clients = {};   // machineId -> ModbusRTU client
    this.state = {};     // machineId -> { counter, status, connected, lastSeen }
    this.listeners = []; // WebSocket broadcast callbacks
    this.polling = false;

    for (const m of MACHINES_CONFIG) {
      this.state[m.id] = { id: m.id, name: m.name, counter: 0, status: 'לא מחובר', statusCode: -1, connected: false, lastSeen: null };
    }
  }

  onUpdate(fn) { this.listeners.push(fn); }

  _broadcast(machineId) {
    const data = this.state[machineId];
    this.listeners.forEach(fn => fn(machineId, data));
  }

  async connectMachine(cfg) {
    const client = new ModbusRTU();
    try {
      if (cfg.mode === 'tcp') {
        await client.connectTCP(cfg.host, { port: cfg.port ?? 502 });
      } else {
        await client.connectRTUBuffered(cfg.serialPort, { baudRate: cfg.baudRate ?? 9600, dataBits: 8, parity: 'none', stopBits: 1 });
      }
      client.setID(cfg.unitId);
      client.setTimeout(1500);
      this.clients[cfg.id] = client;
      this.state[cfg.id].connected = true;
      const addr = cfg.mode === 'tcp' ? `${cfg.host}:${cfg.port ?? 502}` : cfg.serialPort;
      console.log(`[Modbus] מחובר: ${cfg.name} (${addr})`);
    } catch (err) {
      console.warn(`[Modbus] לא ניתן להתחבר ל-${cfg.name}: ${err.message}`);
      this.state[cfg.id].connected = false;
    }
  }

  async pollMachine(cfg) {
    const client = this.clients[cfg.id];
    if (!client || !client.isOpen) {
      if (this.state[cfg.id].connected) {
        this.state[cfg.id].connected = false;
        this.state[cfg.id].status = 'לא מחובר';
        this._broadcast(cfg.id);
      }
      // Retry connection
      await this.connectMachine(cfg);
      return;
    }

    try {
      const counterData = await client.readHoldingRegisters(cfg.counterReg, 1);
      const statusData  = await client.readHoldingRegisters(cfg.statusReg, 1);
      const counter     = counterData.data[0];
      const statusCode  = statusData.data[0];
      const statusText  = STATUS_MAP[statusCode] ?? `קוד ${statusCode}`;

      const prev = this.state[cfg.id];
      const changed = prev.counter !== counter || prev.statusCode !== statusCode;

      this.state[cfg.id] = { ...prev, counter, statusCode, status: statusText, connected: true, lastSeen: new Date().toISOString() };

      if (changed) this._broadcast(cfg.id);
    } catch (err) {
      if (this.state[cfg.id].connected) {
        this.state[cfg.id].connected = false;
        this.state[cfg.id].status = 'שגיאת תקשורת';
        this._broadcast(cfg.id);
      }
    }
  }

  async startPolling(intervalMs = 1000) {
    if (this.polling) return;
    this.polling = true;

    // Initial connect
    for (const cfg of MACHINES_CONFIG) {
      await this.connectMachine(cfg);
    }

    const tick = async () => {
      if (!this.polling) return;
      for (const cfg of MACHINES_CONFIG) {
        await this.pollMachine(cfg);
      }
      setTimeout(tick, intervalMs);
    };

    tick();
    console.log('[Modbus] סקירה החלה');
  }

  stopPolling() {
    this.polling = false;
    Object.values(this.clients).forEach(c => { try { c.close(); } catch (_) {} });
    this.clients = {};
  }

  getAllState() { return Object.values(this.state); }
  getState(id)  { return this.state[id]; }
}

module.exports = new ModbusService();
