-- Bel-Nebula voucher-vending schema.
--
-- Designed for Postgres (recommended: a serverless-friendly host like
-- Neon or Supabase, since this backend runs well on Vercel). Run this
-- once against a fresh database before starting the backend:
--
--   psql "$DATABASE_URL" -f src/db/schema.sql

CREATE TYPE voucher_tier AS ENUM ('hourly', 'daily', 'weekly', 'monthly');
CREATE TYPE voucher_status AS ENUM ('available', 'assigned', 'used');

-- One row per Mikhmon-generated voucher. `code` is the voucher's
-- login code (Mikhmon vouchers typically use the same value as both
-- hotspot username and password).
CREATE TABLE vouchers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  tier voucher_tier NOT NULL,
  status voucher_status NOT NULL DEFAULT 'available',
  assigned_to TEXT,                    -- buyer's email or phone
  assigned_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,                 -- set later if you sync redemption status from Mikhmon
  transaction_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup for "give me one available voucher of this tier" — the
-- single most frequent query the whole system runs.
CREATE INDEX idx_vouchers_tier_status ON vouchers (tier, status);

-- One row per payment attempt, created at /payment/initialize and
-- updated as it progresses. This is what makes voucher delivery
-- idempotent — both the frontend's /verify call and the Paystack
-- webhook can safely call the same fulfilment logic for the same
-- reference without double-spending a voucher.
CREATE TABLE transactions (
  reference TEXT PRIMARY KEY,
  tier voucher_tier NOT NULL,
  amount_kobo INTEGER NOT NULL,
  contact TEXT NOT NULL,               -- email or phone the buyer typed in
  contact_method TEXT NOT NULL CHECK (contact_method IN ('email', 'sms')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fulfilled', 'paid_awaiting_voucher', 'failed')),
  voucher_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ
);

ALTER TABLE vouchers
  ADD CONSTRAINT fk_vouchers_transaction
  FOREIGN KEY (transaction_reference) REFERENCES transactions(reference);

-- Handy view for a quick stock check without writing the query by hand
-- every time (e.g. `SELECT * FROM voucher_stock;` from psql, or wire it
-- into an admin endpoint later).
CREATE VIEW voucher_stock AS
  SELECT tier,
         count(*) FILTER (WHERE status = 'available') AS available,
         count(*) FILTER (WHERE status = 'assigned')  AS assigned,
         count(*) FILTER (WHERE status = 'used')      AS used,
         count(*) AS total
  FROM vouchers
  GROUP BY tier;
