const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const configuredPath = process.env.DATABASE_PATH || './data/etairos.sqlite';
const databasePath = path.resolve(process.cwd(), configuredPath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN ('ADMIN','SUPERVISOR','STAFF','VIEWER')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS verification_codes (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('PV','MS')),
    location_key TEXT NOT NULL,
    date_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, location_key, date_key)
  );
  CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);
  CREATE INDEX IF NOT EXISTS records_location_idx ON records(location_key);
`);

const userByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const userById = db.prepare('SELECT * FROM users WHERE id = ?');
const recordsByType = db.prepare('SELECT * FROM records WHERE type = ? ORDER BY date_key DESC, id DESC');
const allRecords = db.prepare('SELECT * FROM records ORDER BY date_key DESC, id DESC');
const recordById = db.prepare('SELECT * FROM records WHERE id = ?');
const insertRecord = db.prepare('INSERT INTO records(type,location_key,date_key,payload) VALUES(?,?,?,?)');

function recordRows(type) {
  return (type ? recordsByType.all(type) : allRecords.all()).map(row => {
    const value = JSON.parse(row.payload);
    return { ...value, id: row.id, type: row.type, recordId: value.recordId || `${row.type}-${String(row.id).padStart(5, '0')}` };
  });
}
function getRecord(id) {
  const row = recordById.get(Number(id));
  if (!row) return null;
  const value = JSON.parse(row.payload);
  return { ...value, id: row.id, type: row.type, recordId: value.recordId || `${row.type}-${String(row.id).padStart(5, '0')}` };
}
function createRecord(type, payload) {
  const locationKey = String(payload.location || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const dateKey = String(payload.date || '').trim();
  if (!locationKey || !dateKey) throw new Error('DATE_AND_LOCATION_REQUIRED');
  const result = insertRecord.run(type, locationKey, dateKey, JSON.stringify(payload));
  return getRecord(result.lastInsertRowid);
}
function updateRecord(id, type, payload) {
  const locationKey = String(payload.location || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const dateKey = String(payload.date || '').trim();
  if (!locationKey || !dateKey) throw new Error('DATE_AND_LOCATION_REQUIRED');
  const result = db.prepare('UPDATE records SET type=?, location_key=?, date_key=?, payload=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(type, locationKey, dateKey, JSON.stringify(payload), Number(id));
  return result.changes ? getRecord(id) : null;
}
function deleteRecord(id) { return db.prepare('DELETE FROM records WHERE id=?').run(Number(id)).changes > 0; }
function listUsers() { return db.prepare('SELECT id,name,email,role,status,verified,created_at FROM users ORDER BY created_at DESC').all(); }
function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, verified: Boolean(user.verified) };
}

module.exports = { db, userByEmail, userById, recordRows, getRecord, createRecord, updateRecord, deleteRecord, listUsers, publicUser };
