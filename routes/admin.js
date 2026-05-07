const express = require('express');
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getQuery, allQuery, runQuery } = require('../db');

const router = express.Router();

// GET /api/admin/users — admin only, all users
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const users = await allQuery(
      `SELECT id, username, email, role, created_at, is_online, status,
              registration_country, device_info, last_login_at, last_login_ip
       FROM users ORDER BY created_at DESC`,
      []
    );

    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// POST /api/admin/users/:userId/suspend — admin only
router.post('/users/:userId/suspend', verifyToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'Cannot suspend yourself.' });
    }

    const user = await getQuery('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await runQuery('UPDATE users SET status = ? WHERE id = ?', ['suspended', userId]);
    const updated = await getQuery('SELECT id, username, email, role, status FROM users WHERE id = ?', [userId]);

    res.json(updated);
  } catch (err) {
    console.error('Error suspending user:', err);
    res.status(500).json({ error: 'Failed to suspend user.' });
  }
});

// POST /api/admin/users/:userId/unsuspend — admin only
router.post('/users/:userId/unsuspend', verifyToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await getQuery('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await runQuery('UPDATE users SET status = ? WHERE id = ?', [null, userId]);
    const updated = await getQuery('SELECT id, username, email, role, status FROM users WHERE id = ?', [userId]);

    res.json(updated);
  } catch (err) {
    console.error('Error unsuspending user:', err);
    res.status(500).json({ error: 'Failed to unsuspend user.' });
  }
});

module.exports = router;
