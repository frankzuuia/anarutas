import { readConfig } from "../src/core/config";
import { createPool, migrate } from "../src/core/database";
const config = readConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool, config.instanceId);
  console.log("Ana Rutas: esquema verificado.");
} finally {
  await pool.end();
}
