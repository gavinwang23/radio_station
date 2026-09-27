import mysql from 'mysql2/promise';
import { AppError } from './lib/errors.js';

export function createDatabase(config, { poolFactory = mysql.createPool } = {}) {
  let pool;
  const configured = Boolean(config.name);
  function getPool() {
    if (!configured) throw new AppError(503, 'DATABASE_UNCONFIGURED', 'Database name is not configured');
    pool ??= poolFactory({
      host: config.host, port: config.port, user: config.user, password: config.password,
      database: config.name, connectionLimit: config.connectionLimit,
      waitForConnections: true, queueLimit: 50, connectTimeout: Math.min(config.queryTimeoutMs, 5000),
      multipleStatements: false, charset: 'utf8mb4',
    });
    return pool;
  }
  async function execute(sql, values = []) {
    if (!configured) throw new AppError(503, 'DATABASE_UNCONFIGURED', 'Database name is not configured');
    let connection;
    let expired = false;
    let timer;
    const timeoutError = () => new AppError(504, 'DATABASE_TIMEOUT', 'Database request timed out');
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        // Destroying the socket also removes this connection from the pool;
        // releasing it would allow another request to reuse an unfinished query.
        if (connection) {
          try { connection.destroy(); } catch { /* The timeout still settles the caller. */ }
        }
        reject(timeoutError());
      }, config.queryTimeoutMs);
    });
    const operation = (async () => {
      try {
        const acquired = await getPool().getConnection();
        // mysql2 has no cancellation API for queued getConnection requests.
        // If this waiter expired, return its eventual connection without SQL.
        if (expired) { acquired.release(); return; }
        connection = acquired;
        return await acquired.execute(sql, values);
      } catch {
        if (expired) throw timeoutError();
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable');
      } finally {
        if (connection && !expired) connection.release();
      }
    })();
    try { return await Promise.race([operation, deadline]); }
    finally { clearTimeout(timer); }
  }
  return {
    configured,
    execute,
    async status() {
      if (!configured) return { status: 'unconfigured', reason: 'DB_NAME is not configured' };
      try { await execute('SELECT 1'); return { status: 'available' }; }
      catch (error) { return { status: 'unavailable', reason: error.code === 'DATABASE_TIMEOUT' ? 'Database request timed out' : 'Database is unavailable' }; }
    },
    async close() { if (pool) await pool.end(); },
  };
}
