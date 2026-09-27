const IDENTIFIER = /^[A-Za-z0-9_$-]{1,64}$/;
const CATALOG_FIELDS = new Set(['icao', 'registration', 'type', 'manufacturer', 'operator']);
export const DEFAULT_GOOGLE_MAPS_API_BASE_URL = 'https://tile.googleapis.com';

function googleMapsApiBaseUrl(value) {
  const input = (value || '').trim() || DEFAULT_GOOGLE_MAPS_API_BASE_URL;
  const message = 'GOOGLE_MAPS_API_BASE_URL must be HTTP or HTTPS without URL credentials, query strings or fragments';
  const authority = /^https?:\/\/([^/?#\\]+)/i.exec(input)?.[1];
  let url;
  try { url = new URL(input); } catch { throw new Error(message); }
  if (!authority || authority.includes('@') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) throw new Error(message);
  return url.href.replace(/\/+$/, '');
}

function integer(value, fallback, name, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return result;
}

function optionalNumber(value, name, min, max) {
  if (value === undefined || String(value).trim() === '') return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return result;
}

export function validateIdentifier(value, name = 'SQL identifier') {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${name} must use 1–64 letters, digits, underscores, dollar signs or hyphens`);
  return value;
}

export function loadConfig(env = process.env) {
  let mapping = { icao: 'icao' };
  if (env.ADSB_COLUMN_MAPPING) {
    try { mapping = JSON.parse(env.ADSB_COLUMN_MAPPING); } catch { throw new Error('ADSB_COLUMN_MAPPING must be valid JSON'); }
    if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object' || !mapping.icao) throw new Error('ADSB_COLUMN_MAPPING must contain the icao field');
  }
  for (const [logical, actual] of Object.entries(mapping)) {
    if (!CATALOG_FIELDS.has(logical)) throw new Error('ADSB_COLUMN_MAPPING contains an unsupported logical field');
    validateIdentifier(actual, `ADSB_COLUMN_MAPPING.${logical}`);
  }
  const sourceUrl = (env.ADSB_SOURCE_URL || '').trim();
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw new Error('ADSB_SOURCE_URL must be an HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('ADSB_SOURCE_URL must be HTTP or HTTPS without URL credentials');
  }
  const table = (env.ADSB_TABLE || '').trim();
  if (table) validateIdentifier(table, 'ADSB_TABLE');
  return {
    server: {
      host: (env.HOST || '127.0.0.1').trim(),
      port: integer(env.PORT, 3000, 'PORT', 1, 65535),
      corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:9528,http://127.0.0.1:9528,http://localhost:9529,http://127.0.0.1:9529').split(',').map(value => value.trim()).filter(Boolean),
    },
    database: {
      host: (env.DB_HOST || '127.0.0.1').trim(),
      port: integer(env.DB_PORT, 3306, 'DB_PORT', 1, 65535),
      user: env.DB_USER || '',
      password: env.DB_PASSWORD || '',
      name: (env.DB_NAME || '').trim(),
      connectionLimit: integer(env.DB_CONNECTION_LIMIT, 5, 'DB_CONNECTION_LIMIT', 1, 100),
      queryTimeoutMs: integer(env.DB_QUERY_TIMEOUT_MS, 5000, 'DB_QUERY_TIMEOUT_MS', 1, 120000),
    },
    adsb: {
      sourceUrl,
      sourceTimeoutMs: integer(env.ADSB_SOURCE_TIMEOUT_MS, 5000, 'ADSB_SOURCE_TIMEOUT_MS', 1, 120000),
      table,
      columnMapping: mapping,
    },
    maps: {
      googleApiKey: env.GOOGLE_MAPS_API_KEY || '',
      googleApiBaseUrl: googleMapsApiBaseUrl(env.GOOGLE_MAPS_API_BASE_URL),
    },
    station: {
      id: env.STATION_ID || 'local-station',
      name: env.STATION_NAME || 'Radio Station',
      latitude: optionalNumber(env.STATION_LATITUDE, 'STATION_LATITUDE', -90, 90),
      longitude: optionalNumber(env.STATION_LONGITUDE, 'STATION_LONGITUDE', -180, 180),
      altitudeMeters: optionalNumber(env.STATION_ALTITUDE_METERS, 'STATION_ALTITUDE_METERS', -500, 100000),
    },
  };
}
