-- Short links for shared plans.
--
-- A plan is stored as the same compact payload that otherwise rides in a URL
-- fragment, so the client encoding is unchanged; the backend only shortens it.
CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  -- SHA-256 of the payload, so re-sharing an unchanged plan reuses its link
  -- rather than filling the table with duplicates.
  hash       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS plans_hash ON plans (hash);
-- Supports pruning links nobody has opened in a long time.
CREATE INDEX IF NOT EXISTS plans_last_seen ON plans (last_seen);
