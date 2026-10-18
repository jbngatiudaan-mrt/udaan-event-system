const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attendees (
  id             SERIAL PRIMARY KEY,
  ticket_code    TEXT UNIQUE NOT NULL,
  token          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT UNIQUE NOT NULL,
  email          TEXT,
  city           TEXT,
  business       TEXT,
  status         TEXT NOT NULL DEFAULT 'REGISTERED',
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at  TIMESTAMPTZ,
  checked_in_by  TEXT,
  won_prize      BOOLEAN NOT NULL DEFAULT FALSE,
  won_round      INT,
  pass_status    TEXT NOT NULL DEFAULT 'QUEUED',
  pass_sent_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attendees_eligible_idx ON attendees (status, won_prize);

CREATE TABLE IF NOT EXISTS draw_rounds (
  round_no     INT PRIMARY KEY,
  prize        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'OPEN',      -- OPEN | READY | DONE
  grid         JSONB,                              -- array of attendee ids shown on stage
  winner_id    INT REFERENCES attendees(id),
  winner_index INT,
  drawn_at     TIMESTAMPTZ,
  history      JSONB NOT NULL DEFAULT '[]'        -- voided winners
);

CREATE TABLE IF NOT EXISTS wa_outbox (
  id           SERIAL PRIMARY KEY,
  attendee_id  INT REFERENCES attendees(id),
  kind         TEXT NOT NULL,                      -- PASS | WINNER
  to_phone     TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'QUEUED',     -- QUEUED | SENT | MOCK | FAILED
  attempts     INT NOT NULL DEFAULT 0,
  provider_id  TEXT,
  error        TEXT,
  send_after   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_outbox_queue_idx ON wa_outbox (status, send_after);

-- Added after v1: safe to run on an existing database.
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE wa_outbox ADD COLUMN IF NOT EXISTS via TEXT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- What the stage screen shows (one row). Changed only from the organiser desk.
CREATE TABLE IF NOT EXISTS stage_display (
  id          INT PRIMARY KEY DEFAULT 1,
  mode        TEXT NOT NULL DEFAULT 'idle',
  round_no    INT NOT NULL DEFAULT 1,
  seq         INT NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO stage_display (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
-- Boards loaded with the old two-step flow are no longer used.
UPDATE draw_rounds SET status='OPEN', grid=NULL WHERE status='READY';
CREATE INDEX IF NOT EXISTS wa_outbox_provider_idx ON wa_outbox (provider_id);
CREATE INDEX IF NOT EXISTS wa_outbox_attendee_idx ON wa_outbox (attendee_id, kind, created_at);
`;

async function migrate() {
  await pool.query(SCHEMA);
  for (let n = 1; n <= config.event.rounds; n++) {
    await pool.query(
      `INSERT INTO draw_rounds (round_no, prize) VALUES ($1, $2) ON CONFLICT (round_no) DO NOTHING`,
      [n, `Lucky Draw ${n}`]
    );
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const q = (text, params) => pool.query(text, params);
module.exports = { pool, migrate, tx, q, query: q };
