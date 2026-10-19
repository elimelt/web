-- pgcrypto provides hmac(), used to match pseudonymous visitor ids
-- (left(hex(HMAC-SHA256(secret, visitor_ip)), 16)) in SQL.
-- Additive and idempotent. If the extension is unavailable the API falls back
-- to filtering by id in Python.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto extension not available, skipping';
END $$;
