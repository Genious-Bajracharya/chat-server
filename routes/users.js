const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { getQuery, allQuery, runQuery } = require('../db');

const router = express.Router();

// GET /api/users/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await getQuery(
      'SELECT id, username, email, role, created_at, is_online, status, bio FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// PUT /api/users/me/profile — update username, status, bio
router.put('/me/profile', verifyToken, async (req, res) => {
  const { username, status, bio } = req.body;

  try {
    if (username !== undefined) {
      if (!username.trim()) return res.status(400).json({ error: 'Username cannot be empty.' });
      const taken = await getQuery('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), req.user.id]);
      if (taken) return res.status(409).json({ error: 'Username already taken.' });
      await runQuery('UPDATE users SET username = ? WHERE id = ?', [username.trim(), req.user.id]);
    }

    if (status !== undefined) {
      await runQuery('UPDATE users SET status = ? WHERE id = ?', [status.slice(0, 100) || null, req.user.id]);
    }

    if (bio !== undefined) {
      await runQuery('UPDATE users SET bio = ? WHERE id = ?', [bio.slice(0, 300) || null, req.user.id]);
    }

    const updated = await getQuery(
      'SELECT id, username, email, role, is_online, status, bio FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json(updated);
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// PUT /api/users/me/public-key — save user's public key
router.put('/me/public-key', verifyToken, async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: 'publicKey is required.' });
  try {
    await runQuery('UPDATE users SET public_key = ? WHERE id = ?', [publicKey, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving public key:', err);
    res.status(500).json({ error: 'Failed to save public key.' });
  }
});

// GET /api/users/:id/public-key — get any user's public key
router.get('/:id/public-key', verifyToken, async (req, res) => {
  try {
    const row = await getQuery('SELECT public_key FROM users WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'User not found.' });
    res.json({ publicKey: row.public_key });
  } catch (err) {
    console.error('Error fetching public key:', err);
    res.status(500).json({ error: 'Failed to fetch public key.' });
  }
});

// GET /api/users/by-id/:id — get user by ID
router.get('/by-id/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself.' });
    }

    const user = await getQuery(
      `SELECT id, username, email, role, created_at, is_online
       FROM users
       WHERE id = ?`,
      [id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const friendship = await getQuery(
      `SELECT * FROM friends
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`,
      [req.user.id, user.id, user.id, req.user.id]
    );

    res.json({
      ...user,
      friendStatus: friendship ? friendship.status : null,
      friendshipId: friendship ? friendship.id : null,
      isRequester: friendship ? friendship.requester_id === req.user.id : null
    });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// GET /api/users/search?q=
router.get('/search', verifyToken, async (req, res) => {
  const { q } = req.query;

  try {
    if (!q || q.trim().length < 1) {
      return res.status(400).json({ error: 'Search query is required.' });
    }

    const searchTerm = `%${q.trim()}%`;

    // Search users, exclude self
    const users = await allQuery(
      `SELECT id, username, email, role, created_at, is_online
       FROM users
       WHERE username LIKE ? AND id != ?
       LIMIT 20`,
      [searchTerm, req.user.id]
    );

    // For each result, also check if there's an existing friend relationship
    const usersWithStatus = await Promise.all(users.map(async (user) => {
      const friendship = await getQuery(
        `SELECT * FROM friends
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)`,
        [req.user.id, user.id, user.id, req.user.id]
      );

      return {
        ...user,
        friendStatus: friendship ? friendship.status : null,
        friendshipId: friendship ? friendship.id : null,
        isRequester: friendship ? friendship.requester_id === req.user.id : null
      };
    }));

    res.json(usersWithStatus);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: 'Failed to search users.' });
  }
});

// POST /api/users/:id/block — block a user
router.post('/:id/block', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    if (parseInt(id) === userId) {
      return res.status(400).json({ error: 'Cannot block yourself.' });
    }

    const user = await getQuery('SELECT id FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if already blocked
    const existing = await getQuery('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_user_id = ?', [userId, id]);
    if (existing) {
      return res.status(400).json({ error: 'User is already blocked.' });
    }

    await runQuery('INSERT INTO blocks (blocker_id, blocked_user_id) VALUES (?, ?)', [userId, id]);
    res.status(201).json({ message: 'User blocked successfully.' });
  } catch (err) {
    console.error('Error blocking user:', err);
    res.status(500).json({ error: 'Failed to block user.' });
  }
});

// POST /api/users/:id/unblock — unblock a user
router.post('/:id/unblock', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const result = await runQuery('DELETE FROM blocks WHERE blocker_id = ? AND blocked_user_id = ?', [userId, id]);
    res.json({ message: 'User unblocked successfully.' });
  } catch (err) {
    console.error('Error unblocking user:', err);
    res.status(500).json({ error: 'Failed to unblock user.' });
  }
});

// GET /api/users/:id/is-blocked — check if a user is blocked
router.get('/:id/is-blocked', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const blocked = await getQuery('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_user_id = ?', [userId, id]);
    res.json({ isBlocked: !!blocked });
  } catch (err) {
    console.error('Error checking block status:', err);
    res.status(500).json({ error: 'Failed to check block status.' });
  }
});

module.exports = router;
