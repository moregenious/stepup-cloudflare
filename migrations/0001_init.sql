-- Step Up English: document store (see src/lib/storage/d1.js)
CREATE TABLE IF NOT EXISTS docs (
  path TEXT PRIMARY KEY,
  ver  INTEGER NOT NULL DEFAULT 0,
  tok  TEXT,
  data TEXT,
  body TEXT
);
