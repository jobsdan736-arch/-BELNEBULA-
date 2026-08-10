const { Pool } = require('pg');

// Neon/Supabase/most managed Postgres hosts require SSL. `sslmode=require`
// in DATABASE_URL usually handles this on its own, but we set it
// explicitly too so a bare `postgres://` URL still works without a
// separate flag to remember.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // A background client (idle in the pool) errored out — log it instead
  // of letting it crash the whole process.
  console.error('[db] unexpected pool error', err);
});

module.exports = pool;
