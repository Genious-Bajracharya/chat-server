const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

// ⚠️ WARNING: DUAL DATABASE SETUP
// Users & Friends: PostgreSQL (persistent on Render)
// Messages: SQLite (WILL BE DELETED ON RENDER RESTART)
// When deployed: Messages will be lost every time Render restarts!
// Add Cloudinary + migrate to PostgreSQL for messages before production!

// ============================================
// MESSAGES DATABASE (SQLite - Local only)
// ============================================
const MSG_DB_PATH = path.join(__dirname, 'messages.db');
const messagesDb = new Database(MSG_DB_PATH);

// Enable WAL mode for better concurrent performance
messagesDb.pragma('journal_mode = WAL');
messagesDb.pragma('foreign_keys = ON');

// Create messages table
messagesDb.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    file_url TEXT,
    file_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME,
    edited_at DATETIME,
    deleted INTEGER DEFAULT 0
  );
`);

// Create message_reactions table
messagesDb.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji)
  );
`);

// ============================================
// USERS & FRIENDS DATABASE (SQLite - Local)
// For now, will migrate to PostgreSQL later
// ============================================
const USERS_DB_PATH = path.join(__dirname, 'chat.db');
const db = new Database(USERS_DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_online INTEGER DEFAULT 0,
    public_key TEXT,
    status TEXT,
    bio TEXT,
    registration_ip TEXT,
    registration_country TEXT,
    device_info TEXT,
    last_login_at DATETIME,
    last_login_ip TEXT
  );
`);

// Create friends table
db.exec(`
  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(requester_id, addressee_id)
  );
`);

// Seed admin user if not present
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@chat.app');
if (!adminExists) {
  const passwordHash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('admin', 'admin@chat.app', passwordHash, 'admin');
  console.log('Admin user seeded: admin@chat.app / admin123');
}

// Seed KingKai user if not present
const kingkaiExists = db.prepare('SELECT id FROM users WHERE username = ?').get('KingKai');
if (!kingkaiExists) {
  const passwordHash = bcrypt.hashSync('kingkai123', 10);
  db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('KingKai', 'kingkai@chat.app', passwordHash, 'user');
  console.log('KingKai user seeded: kingkai@chat.app / kingkai123');
}

module.exports = db;
module.exports.messagesDb = messagesDb;
module.exports.usersDb = db;
