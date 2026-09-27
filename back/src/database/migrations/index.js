const SOURCE_MIGRATION = '001_signal_sources';

// These tables belong to this application; imported aircraft catalog tables
// deliberately never appear in migrations.
export async function migrate(database) {
  await database.execute(`CREATE TABLE IF NOT EXISTS rs_schema_migrations (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [rows] = await database.execute('SELECT id FROM rs_schema_migrations WHERE id = ?', [SOURCE_MIGRATION]);
  if (rows.length) return { applied: [] };
  await database.execute(`CREATE TABLE IF NOT EXISTS signal_sources (
    module VARCHAR(64) NOT NULL PRIMARY KEY,
    protocol VARCHAR(32) NOT NULL,
    name VARCHAR(120) NOT NULL,
    host VARCHAR(253) NOT NULL,
    port SMALLINT UNSIGNED NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    station_name VARCHAR(120) NOT NULL DEFAULT '',
    station_latitude DOUBLE NULL,
    station_longitude DOUBLE NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await database.execute('INSERT IGNORE INTO rs_schema_migrations (id) VALUES (?)', [SOURCE_MIGRATION]);
  return { applied: [SOURCE_MIGRATION] };
}
