-- 名前と ID（重複不可）
CREATE TABLE IF NOT EXISTS profiles (
  account_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 引き継ぎコード
CREATE TABLE IF NOT EXISTS transfer_codes (
  code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transfer_codes_account ON transfer_codes(account_id);
-- 公開ビルド（プロフィールカード）
CREATE TABLE IF NOT EXISTS builds (
  char_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  handle TEXT,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  weapon TEXT,
  visibility TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS builds_name ON builds(name);
-- タイムアタックのランキング
CREATE TABLE IF NOT EXISTS time_attack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  time REAL NOT NULL,
  names TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS time_attack_course ON time_attack(course, time);
-- 通報・不正の記録・管理の記録
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  account_id TEXT,
  target TEXT,
  detail TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_kind ON reports(kind, at);
-- 停止中のアカウント
CREATE TABLE IF NOT EXISTS bans (
  account_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  until INTEGER NOT NULL,
  at INTEGER NOT NULL
);
