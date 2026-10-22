-- Mine Lode shared high scores. No IP address or other player identifier is stored.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  level INTEGER NOT NULL,
  seed TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- "Top of a mode" queries and pruning.
CREATE INDEX IF NOT EXISTS scores_mode_top ON scores (mode, score DESC, created_at ASC, id ASC);

-- Start-stamp ids already spent; rows older than the stamp lifetime are deleted on each accepted post.
CREATE TABLE IF NOT EXISTS used_stamps (
  id TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);
