import { validateIdentifier } from '../../config.js';
import { AppError } from '../../lib/errors.js';

const quote = identifier => `\`${validateIdentifier(identifier)}\``;

export function normalizeIcao(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{6}$/i.test(value)) throw new AppError(400, 'INVALID_ICAO', 'ICAO must contain exactly six hexadecimal characters');
  return value.toLowerCase();
}

export function createCatalogRepository({ config, database }) {
  const { table, columnMapping } = config.adsb;
  async function schema() {
    if (!database.configured) return { status: 'database_unconfigured', reason: 'DB_NAME is not configured', columns: [] };
    if (!table) return { status: 'table_unconfigured', reason: 'ADSB_TABLE is not configured', columns: [] };
    let rows;
    try {
      [rows] = await database.execute(
        'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [config.database.name, table],
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'DATABASE_UNAVAILABLE') return { status: 'database_unavailable', reason: 'Database is unavailable', columns: [] };
      throw error;
    }
    if (!rows.length) return { status: 'table_missing', table, columns: [], reason: 'Configured table does not exist or is not visible to this database user' };
    const columns = rows.map(row => ({ name: row.COLUMN_NAME, type: row.DATA_TYPE, nullable: row.IS_NULLABLE === 'YES' }));
    const names = new Set(columns.map(column => column.name));
    const missingColumns = [...new Set(Object.values(columnMapping).filter(name => !names.has(name)))];
    return { status: missingColumns.length ? 'column_mismatch' : 'ready', table, columns, mapping: { ...columnMapping }, missingColumns };
  }
  return {
    schema,
    async lookup(value) {
      const icao = normalizeIcao(value);
      const current = await schema();
      if (current.status !== 'ready') {
        const codes = {
          database_unconfigured: ['DATABASE_UNCONFIGURED', 'Database name is not configured'],
          database_unavailable: ['DATABASE_UNAVAILABLE', 'Database is unavailable'],
          table_unconfigured: ['CATALOG_TABLE_UNCONFIGURED', 'Aircraft catalog table is not configured'],
          table_missing: ['CATALOG_TABLE_MISSING', 'Configured aircraft catalog table is missing'],
          column_mismatch: ['CATALOG_COLUMN_MISMATCH', 'Configured aircraft catalog columns do not match the imported table'],
        };
        const [code, message] = codes[current.status];
        throw new AppError(503, code, message);
      }
      const select = Object.entries(columnMapping).map(([logical, actual]) => `${quote(actual)} AS ${quote(logical)}`).join(', ');
      const [rows] = await database.execute(`SELECT ${select} FROM ${quote(table)} WHERE ${quote(columnMapping.icao)} = ? LIMIT 1`, [icao]);
      if (!rows.length) throw new AppError(404, 'AIRCRAFT_NOT_FOUND', 'Aircraft was not found in the catalog');
      return rows[0];
    },
  };
}
