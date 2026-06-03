function daysUntil(dateValue, now = new Date()) {
  if (!dateValue) return null;
  const target = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function vehicleHealth(row = {}, { now = new Date() } = {}) {
  const checks = [
    { key: 'test_expiry', label: 'טסט', days: daysUntil(row.test_expiry, now) },
    { key: 'insurance_expiry', label: 'ביטוח', days: daysUntil(row.insurance_expiry, now) },
    { key: 'next_service_date', label: 'טיפול', days: daysUntil(row.next_service_date, now) },
  ];
  const missing = checks.filter(check => !row[check.key]).map(check => check.label);
  const overdue = checks.filter(check => check.days != null && check.days < 0).map(check => check.label);
  const dueSoon = checks.filter(check => check.days != null && check.days >= 0 && check.days <= 30).map(check => check.label);
  if (row.next_service_km && row.odometer_km && Number(row.odometer_km) >= Number(row.next_service_km)) overdue.push('טיפול לפי ק"מ');
  return {
    missing,
    overdue,
    dueSoon,
    status: overdue.length ? 'danger' : dueSoon.length || missing.length ? 'warning' : 'ok',
  };
}

function vehicleInput(body = {}) {
  return {
    vehicle_desc: body.vehicle_desc || null,
    license_plate: body.license_plate || null,
    vehicle_make: body.vehicle_make || null,
    vehicle_model: body.vehicle_model || null,
    vehicle_year: body.vehicle_year ?? null,
    test_expiry: body.test_expiry || null,
    insurance_expiry: body.insurance_expiry || null,
    next_service_date: body.next_service_date || null,
    next_service_km: body.next_service_km ?? null,
    odometer_km: body.odometer_km ?? 0,
    vehicle_status: body.vehicle_status || 'active',
    active: body.active ?? 1,
    notes: body.notes || null,
  };
}

module.exports = {
  daysUntil,
  vehicleHealth,
  vehicleInput,
};
