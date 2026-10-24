CREATE TABLE saved_videos (
  url TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL
);
CREATE INDEX saved_videos_order ON saved_videos(saved_at DESC, url DESC);

CREATE TABLE extraction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_url TEXT NOT NULL,
  page_url TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  scanned_page_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  password_version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
