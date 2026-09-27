import { isIP } from 'node:net';
import { AppError } from '../../lib/errors.js';
import { migrate } from '../../database/migrations/index.js';

export function defaultAdsbSource() {
  return { name: 'dump1090', host: '127.0.0.1', port: 30002, enabled: false, station: { name: '', latitude: null, longitude: null } };
}

const invalid = message => new AppError(400, 'INVALID_SOURCE', message);

function shortName(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(`${label} must be text of at most 120 characters`);
  return value.trim();
}

export function normalizeSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Source must be an object');
  if (input.protocol !== undefined && input.protocol !== 'avr-tcp') throw invalid('ADS-B sources use the avr-tcp protocol');
  if (typeof input.host !== 'string') throw invalid('Receiver host is required');
  const host = input.host.trim();
  const hostname = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!host || (!isIP(host) && (!hostname || /^[\d.]+$/.test(host)))) throw invalid('Receiver host must be an IP address or hostname without a URL, path, port, or credentials');
  const port = input.port === undefined ? 30002 : input.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid('Receiver port must be an integer between 1 and 65535');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalid('Source enabled must be a boolean');
  const station = input.station === undefined ? {} : input.station;
  if (!station || typeof station !== 'object' || Array.isArray(station)) throw invalid('Station must be an object');
  const coordinate = (value, limit, field) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) throw invalid(`Station ${field} is outside the valid range`);
    return value;
  };
  return {
    name: shortName(input.name, 'dump1090', 'Source name'), host, port, enabled: input.enabled ?? false,
    station: { name: shortName(station.name, '', 'Station name'), latitude: coordinate(station.latitude, 90, 'latitude'), longitude: coordinate(station.longitude, 180, 'longitude') },
  };
}

function checkModule(module) {
  if (module !== 'adsb') throw new AppError(400, 'INVALID_SOURCE_MODULE', 'Unsupported signal source module');
}

export function createSourceRepository({ database }) {
  let ready = false;
  let pending;
  let error = null;
  async function ensureReady() {
    if (ready) return;
    if (!pending) pending = (async () => {
      try {
        if (!database?.execute) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable');
        await migrate(database);
        ready = true;
        error = null;
      } catch (failure) {
        error = { code: failure.code ?? 'DATABASE_UNAVAILABLE', message: failure.code === 'DATABASE_TIMEOUT' ? 'Database request timed out' : 'Database is unavailable' };
        throw failure;
      } finally { pending = undefined; }
    })();
    return pending;
  }
  return {
    ready: ensureReady,
    migrationStatus: () => ({ ready, error: error ? { ...error } : null }),
    async get(module) {
      checkModule(module);
      await ensureReady();
      const [rows] = await database.execute(`SELECT name, host, port, enabled, station_name, station_latitude, station_longitude
        FROM signal_sources WHERE module = ? AND protocol = ? LIMIT 1`, [module, 'avr-tcp']);
      if (!rows.length) return null;
      const row = rows[0];
      return normalizeSource({ name: row.name, host: row.host, port: Number(row.port), enabled: Boolean(Number(row.enabled)), station: { name: row.station_name, latitude: row.station_latitude == null ? null : Number(row.station_latitude), longitude: row.station_longitude == null ? null : Number(row.station_longitude) } });
    },
    async save(module, input) {
      checkModule(module);
      const source = normalizeSource(input);
      await ensureReady();
      await database.execute(`INSERT INTO signal_sources
        (module, protocol, name, host, port, enabled, station_name, station_latitude, station_longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE protocol = VALUES(protocol), name = VALUES(name), host = VALUES(host),
          port = VALUES(port), enabled = VALUES(enabled), station_name = VALUES(station_name),
          station_latitude = VALUES(station_latitude), station_longitude = VALUES(station_longitude), updated_at = CURRENT_TIMESTAMP`,
      [module, 'avr-tcp', source.name, source.host, source.port, source.enabled ? 1 : 0, source.station.name, source.station.latitude, source.station.longitude]);
      return source;
    },
  };
}
