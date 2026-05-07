const express = require('express');
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/users — admin only, all users
router.get('/users', verifyToken, requireAdmin, (req, res) => {
  const users = db.prepare(
    `SELECT id, username, email, role, created_at, is_online, status,
            registration_country, device_info, last_login_at, last_login_ip
     FROM users ORDER BY created_at DESC`
  ).all();

  res.json(users);
});

// POST /api/admin/users/:userId/suspend — admin only
router.post('/users/:userId/suspend', verifyToken, requireAdmin, (req, res) => {
  const { userId } = req.params;

  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'Cannot suspend yourself.' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('suspended', userId);
  const updated = db.prepare('SELECT id, username, email, role, status FROM users WHERE id = ?').get(userId);

  res.json(updated);
});

// POST /api/admin/users/:userId/unsuspend — admin only
router.post('/users/:userId/unsuspend', verifyToken, requireAdmin, (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(null, userId);
  const updated = db.prepare('SELECT id, username, email, role, status FROM users WHERE id = ?').get(userId);

  res.json(updated);
});

module.exports = router;
