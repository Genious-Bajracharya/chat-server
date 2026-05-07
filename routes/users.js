const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/me
router.get('/me', verifyToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, role, created_at, is_online, status, bio FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// PUT /api/users/me/profile — update username, status, bio
router.put('/me/profile', verifyToken, (req, res) => {
  const { username, status, bio } = req.body;

  if (username !== undefined) {
    if (!username.trim()) return res.status(400).json({ error: 'Username cannot be empty.' });
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), req.user.id);
    if (taken) return res.status(409).json({ error: 'Username already taken.' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim(), req.user.id);
  }

  if (status !== undefined) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status.slice(0, 100) || null, req.user.id);
  }

  if (bio !== undefined) {
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio.slice(0, 300) || null, req.user.id);
  }

  const updated = db.prepare(
    'SELECT id, username, email, role, is_online, status, bio FROM users WHERE id = ?'
  ).get(req.user.id);

  res.json(updated);
});

// PUT /api/users/me/public-key — save user's public key
router.put('/me/public-key', verifyToken, (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: 'publicKey is required.' });
  db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);
  res.json({ ok: true });
});

// GET /api/users/:id/public-key — get any user's public key
router.get('/:id/public-key', verifyToken, (req, res) => {
  const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found.' });
  res.json({ publicKey: row.public_key });
});

// GET /api/users/by-id/:id — get user by ID
router.get('/by-id/:id', verifyToken, (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot add yourself.' });
  }

  const user = db.prepare(
    `SELECT id, username, email, role, created_at, is_online
     FROM users
     WHERE id = ?`
  ).get(id);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const friendship = db.prepare(
    `SELECT * FROM friends
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)`
  ).get(req.user.id, user.id, user.id, req.user.id);

  res.json({
    ...user,
    friendStatus: friendship ? friendship.status : null,
    friendshipId: friendship ? friendship.id : null,
    isRequester: friendship ? friendship.requester_id === req.user.id : null
  });
});

// GET /api/users/search?q=
router.get('/search', verifyToken, (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 1) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const searchTerm = `%${q.trim()}%`;

  // Search users, exclude self
  const users = db.prepare(
    `SELECT id, username, email, role, created_at, is_online
     FROM users
     WHERE username LIKE ? AND id != ?
     LIMIT 20`
  ).all(searchTerm, req.user.id);

  // For each result, also check if there's an existing friend relationship
  const usersWithStatus = users.map((user) => {
    const friendship = db.prepare(
      `SELECT * FROM friends
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`
    ).get(req.user.id, user.id, user.id, req.user.id);

    return {
      ...user,
      friendStatus: friendship ? friendship.status : null,
      friendshipId: friendship ? friendship.id : null,
      isRequester: friendship ? friendship.requester_id === req.user.id : null
    };
  });

  res.json(usersWithStatus);
});

module.exports = router;
