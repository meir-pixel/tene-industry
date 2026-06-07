'use strict';

function ensureVehicleCompatibility(db) {
  function ensureVehicleEventsSchema() {
    const cols = db.pragma('table_info(vehicle_events)');
    const driverId = cols.find(c => c.name === 'driver_id');
    if (!driverId || !driverId.notnull) return;
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        CREATE TABLE vehicle_events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          driver_id INTEGER,
          vehicle_id INTEGER,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL,
          odometer_km INTEGER,
          amount REAL DEFAULT 0,
          vendor TEXT,
          reference TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (driver_id) REFERENCES drivers(id),
          FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
        );
        INSERT INTO vehicle_events_new
          (id,driver_id,vehicle_id,event_type,event_date,odometer_km,amount,vendor,reference,notes,created_at)
        SELECT id,driver_id,vehicle_id,event_type,event_date,odometer_km,amount,vendor,reference,notes,created_at
        FROM vehicle_events;
        DROP TABLE vehicle_events;
        ALTER TABLE vehicle_events_new RENAME TO vehicle_events;
        COMMIT;
      `);
      console.log('[DB] Migration: vehicle_events.driver_id made nullable for independent vehicles');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  function migrateDriverVehicleRows() {
    const rows = db.prepare(`
      SELECT *
      FROM drivers
      WHERE vehicle_id IS NULL
        AND (
          COALESCE(vehicle_desc,'') <> ''
          OR COALESCE(license_plate,'') <> ''
          OR COALESCE(vehicle_make,'') <> ''
          OR COALESCE(vehicle_model,'') <> ''
        )
    `).all();
    const insertVehicle = db.prepare(`
      INSERT INTO vehicles
        (vehicle_desc,license_plate,vehicle_make,vehicle_model,vehicle_year,test_expiry,insurance_expiry,next_service_date,next_service_km,odometer_km,vehicle_status,active,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const findByPlate = db.prepare('SELECT id FROM vehicles WHERE license_plate=?');
    const setDriverVehicle = db.prepare('UPDATE drivers SET vehicle_id=? WHERE id=?');
    const setEventVehicle = db.prepare('UPDATE vehicle_events SET vehicle_id=? WHERE driver_id=? AND vehicle_id IS NULL');
    const migrateOne = db.transaction((driver) => {
      let vehicleId = null;
      const plate = String(driver.license_plate || '').trim();
      if (plate) vehicleId = findByPlate.get(plate)?.id || null;
      if (!vehicleId) {
        const r = insertVehicle.run(
          driver.vehicle_desc || null,
          plate || null,
          driver.vehicle_make || null,
          driver.vehicle_model || null,
          driver.vehicle_year || null,
          driver.test_expiry || null,
          driver.insurance_expiry || null,
          driver.next_service_date || null,
          driver.next_service_km || null,
          driver.odometer_km || 0,
          driver.vehicle_status || 'active',
          driver.active ?? 1,
          driver.notes || null
        );
        vehicleId = r.lastInsertRowid;
      }
      setDriverVehicle.run(vehicleId, driver.id);
      setEventVehicle.run(vehicleId, driver.id);
    });
    rows.forEach(migrateOne);
  }

  ensureVehicleEventsSchema();
  migrateDriverVehicleRows();
}

module.exports = {
  ensureVehicleCompatibility,
};
