const Database = require('better-sqlite3');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');

let db;

// ============================================
// USERS & FRIENDS DATABASE
// Production: PostgreSQL (Persistent on Render)
// Local: SQLite (for easy development)
// ============================================

if (process.env.DATABASE_URL) {
  // Production: PostgreSQL on Neon
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.connect().catch(err => console.error('PostgreSQL connection error:', err));

  db = client;
  db.isPg = true;

  // Initialize tables
  client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_online INTEGER DEFAULT 0,
      public_key TEXT,
      status TEXT,
      bio TEXT,
      registration_ip TEXT,
      registration_country TEXT,
      device_info TEXT,
      last_login_at TIMESTAMP,
      last_login_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(requester_id, addressee_id)
    );
  `).catch(err => console.error('Table creation error:', err));

  console.log('✅ Using PostgreSQL for users/friends');
} else {
  // Local: SQLite (easier for development)
  const DB_PATH = path.join(__dirname, 'chat.db');
  db = new Database(DB_PATH);
  db.isPg = false;

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  console.log('✅ Using SQLite for users/friends (local development)');
}

// ============================================
// MESSAGES DATABASE (SQLite - Always Local)
// ⚠️ WILL BE DELETED ON RENDER RESTART
// Messages stay in SQLite for now
// ============================================
const MSG_DB_PATH = path.join(__dirname, 'messages.db');
const messagesDb = new Database(MSG_DB_PATH);

messagesDb.pragma('journal_mode = WAL');
messagesDb.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji)
  );
`);

// Seed admin & KingKai users
if (!process.env.DATABASE_URL) {
  // Local SQLite seeding
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@chat.app');
  if (!adminExists) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('admin', 'admin@chat.app', passwordHash, 'admin');
    console.log('✅ Admin user seeded: admin@chat.app / admin123');
  }

  const kingkaiExists = db.prepare('SELECT id FROM users WHERE username = ?').get('KingKai');
  if (!kingkaiExists) {
    const passwordHash = bcrypt.hashSync('kingkai123', 10);
    db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('KingKai', 'kingkai@chat.app', passwordHash, 'user');
    console.log('✅ KingKai user seeded');
  }
} else {
  // PostgreSQL seeding
  db.query('SELECT id FROM users WHERE email = $1', ['admin@chat.app'], (err, result) => {
    if (!err && result.rows.length === 0) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      db.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['admin', 'admin@chat.app', passwordHash, 'admin'],
        (err) => {
          if (!err) console.log('✅ Admin user seeded');
        }
      );
    }
  });

  db.query('SELECT id FROM users WHERE username = $1', ['KingKai'], (err, result) => {
    if (!err && result.rows.length === 0) {
      const passwordHash = bcrypt.hashSync('kingkai123', 10);
      db.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        ['KingKai', 'kingkai@chat.app', passwordHash, 'user']
      );
    }
  });
}

module.exports = db;
module.exports.messagesDb = messagesDb;
