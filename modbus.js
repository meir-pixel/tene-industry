const ModbusRTU = require('modbus-serial');

// XINJE XD5-32T-E registers (D-registers = Holding Registers):
//   D0  (addr 0): Read  – unit counter
//   D1  (addr 1): Write – diameter mm
//   D2  (addr 2): Write – total length mm (main segment)
//   D3  (addr 3): Write – production quantity (with waste margin)
//   D10 (addr 10): Read – error code (0=ok)
//   D100+ (addr 100+): Write – bend angles (D100=angle1, D101=angle2, ...)
const REG = { COUNTER: 0, DIAMETER: 1, LENGTH: 2, QUANTITY: 3, ERROR: 10, ANGLES_BASE: 100 };

const MACHINES_CONFIG = [
  { id: 1, label: 'A', name: 'מכונה A – XINJE', type: 'xinje', mode: 'tcp', host: '192.168.1.101', port: 502, unitId: 1 },
  { id: 2, label: 'B', name: 'מכונה B – XINJE', type: 'xinje', mode: 'tcp', host: '192.168.1.102', port: 502, unitId: 2 },
  { id: 3, label: 'C', name: 'מכונה C – MEP',   type: 'mep',   mode: 'tcp', host: '192.168.1.103', port: 502, unitId: 3 },
  { id: 4, label: 'D', name: 'מכונה D – עתידי', type: 'xinje', mode: 'tcp', host: '192.168.1.104', port: 502, unitId: 4 },
  // RTU example (uncomment and set COM port when using serial gateway):
  // { id: 1, label: 'A', name: 'מכונה A – XINJE', type: 'xinje', mode: 'rtu', serialPort: 'COM3', baudRate: 9600, unitId: 1 },
];

const STATUS_MAP = { 0: 'כבוי', 1: 'ממתין', 2: 'בייצור', 3: 'תקלה' };
const CONNECT_RETRY_MS = 10000;

class ModbusService {
  constructor() {
    this.clients   = {};   // machineId → ModbusRTU client
    this.state     = {};   // machineId → { counter, status, connected, lastSeen, ... }
    this.listeners = [];
    this.polling   = false;
    this._retryTimers = {};

    for (const m of MACHINES_CONFIG) {
      this.state[m.id] = {
        id: m.id, label: m.label, name: m.name,
        counter: 0, statusCode: -1, status: 'לא מחובר',
        connected: false, lastSeen: null, errorCode: 0,
      };
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
        await client.connectRTUBuffered(cfg.serialPort, {
          baudRate: cfg.baudRate ?? 9600, dataBits: 8, parity: 'none', stopBits: 1,
        });
      }
      client.setID(cfg.unitId);
      client.setTimeout(2000);
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
      await this.connectMachine(cfg);
      return;
    }

    try {
      const counterData = await client.readHoldingRegisters(REG.COUNTER, 1);
      const statusData  = await client.readHoldingRegisters(REG.ERROR, 1);
      const counter     = counterData.data[0];
      const errorCode   = statusData.data[0];
      const statusCode  = errorCode > 0 ? 3 : 2; // 3=error, 2=running (simplified)
      const statusText  = errorCode > 0 ? `תקלה (${errorCode})` : (STATUS_MAP[statusCode] ?? `קוד ${statusCode}`);

      const prev    = this.state[cfg.id];
      const changed = prev.counter !== counter || prev.errorCode !== errorCode;

      this.state[cfg.id] = {
        ...prev, counter, statusCode, errorCode,
        status: statusText, connected: true, lastSeen: new Date().toISOString(),
      };

      if (changed) this._broadcast(cfg.id);
    } catch (err) {
      if (this.state[cfg.id].connected) {
        this.state[cfg.id].connected = false;
        this.state[cfg.id].status = 'שגיאת תקשורת';
        this._broadcast(cfg.id);
      }
    }
  }

  // Write production parameters to machine before starting
  async writeParams(machineId, { diameter, totalLengthMm, productionQty, angles = [] }) {
    const cfg    = MACHINES_CONFIG.find(m => m.id === machineId);
    const client = this.clients[machineId];

    if (!cfg) throw new Error(`מכונה ${machineId} לא מוגדרת`);
    if (cfg.type === 'mep') {
      console.log(`[Modbus] MEP machine ${machineId} – proprietary protocol, skipping write`);
      return;
    }
    if (!client || !client.isOpen) throw new Error('מכונה לא מחוברת');

    // Write basic params: D1=diameter, D2=length, D3=qty
    await client.writeRegisters(REG.DIAMETER, [Math.round(diameter)]);
    await client.writeRegisters(REG.LENGTH,   [Math.round(totalLengthMm)]);
    await client.writeRegisters(REG.QUANTITY, [Math.round(productionQty)]);

    // Write bend angles to D100+
    if (angles.length > 0) {
      const angleVals = angles.map(a => Math.round(a));
      await client.writeRegisters(REG.ANGLES_BASE, angleVals);
    }

    console.log(`[Modbus] מכונה ${machineId}: נשלחו פרמטרים – Ø${diameter} / ${totalLengthMm}מ"מ / כמות:${productionQty} / זוויות:${angles.join(',')}`);
  }

  async startPolling(intervalMs = 5000) {
    if (this.polling) return;
    this.polling = true;
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
    console.log(`[Modbus] סקירה החלה (כל ${intervalMs / 1000} שניות)`);
  }

  stopPolling() {
    this.polling = false;
    Object.values(this.clients).forEach(c => { try { c.close(); } catch (_) {} });
    this.clients = {};
    console.log('[Modbus] סקירה הופסקה');
  }

  getAllState() { return Object.values(this.state); }
  getState(id)  { return this.state[id]; }
}

module.exports = new ModbusService();
