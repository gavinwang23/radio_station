import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { migrate } from './migrations/index.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const database = createDatabase(loadConfig().database);
try {
  const result = await migrate(database);
  console.log(`数据库结构已就绪，新增迁移 ${result.applied.length} 项。`);
} catch (error) {
  console.error(`无法初始化数据库结构 (${error.code || 'MIGRATION_FAILED'})`);
  process.exitCode = 1;
} finally { await database.close(); }
