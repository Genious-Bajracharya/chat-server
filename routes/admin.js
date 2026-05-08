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

// POST /api/users/:userId/report — any user can report another user
router.post('/report/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const reporterId = req.user.id;

  try {
    if (parseInt(userId) === reporterId) {
      return res.status(400).json({ error: 'You cannot report yourself.' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    const reportedUser = await getQuery('SELECT id FROM users WHERE id = ?', [userId]);
    if (!reportedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const result = await runQuery(
      'INSERT INTO reports (reporter_id, reported_user_id, reason) VALUES (?, ?, ?)',
      [reporterId, userId, reason.trim()]
    );

    const reportId = db.isPg ? result.rows[0]?.id : result.lastID;
    res.status(201).json({
      message: 'Report submitted successfully.',
      reportId
    });
  } catch (err) {
    console.error('Error submitting report:', err);
    res.status(500).json({ error: 'Failed to submit report.' });
  }
});

// GET /api/admin/reports — admin only, view all reports
router.get('/reports', verifyToken, requireAdmin, async (req, res) => {
  try {
    const reports = await allQuery(
      `SELECT r.id, r.reporter_id, r.reported_user_id, r.reason, r.status,
              r.created_at, r.resolved_at, r.resolved_by_admin_id,
              ru.username AS reported_username, ru.email AS reported_email,
              rpu.username AS reporter_username, rpu.email AS reporter_email,
              au.username AS admin_username
       FROM reports r
       JOIN users ru ON r.reported_user_id = ru.id
       JOIN users rpu ON r.reporter_id = rpu.id
       LEFT JOIN users au ON r.resolved_by_admin_id = au.id
       ORDER BY r.status = 'pending' DESC, r.created_at DESC`,
      []
    );

    res.json(reports);
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// POST /api/admin/reports/:reportId/resolve — admin only, resolve or dismiss a report
router.post('/reports/:reportId/resolve', verifyToken, requireAdmin, async (req, res) => {
  const { reportId } = req.params;
  const { action } = req.body; // action: 'suspend' or 'dismiss'
  const adminId = req.user.id;

  try {
    const report = await getQuery('SELECT reported_user_id, status FROM reports WHERE id = ?', [reportId]);
    if (!report) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    if (report.status !== 'pending') {
      return res.status(400).json({ error: 'This report has already been resolved.' });
    }

    if (action === 'suspend') {
      // Suspend the reported user
      await runQuery('UPDATE users SET status = ? WHERE id = ?', ['suspended', report.reported_user_id]);
    }

    // Mark report as resolved
    await runQuery(
      'UPDATE reports SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by_admin_id = ? WHERE id = ?',
      ['resolved', adminId, reportId]
    );

    const updated = await getQuery(
      `SELECT r.id, r.reporter_id, r.reported_user_id, r.reason, r.status,
              r.created_at, r.resolved_at, r.resolved_by_admin_id,
              ru.username AS reported_username,
              rpu.username AS reporter_username,
              au.username AS admin_username
       FROM reports r
       JOIN users ru ON r.reported_user_id = ru.id
       JOIN users rpu ON r.reporter_id = rpu.id
       LEFT JOIN users au ON r.resolved_by_admin_id = au.id
       WHERE r.id = ?`,
      [reportId]
    );

    res.json(updated);
  } catch (err) {
    console.error('Error resolving report:', err);
    res.status(500).json({ error: 'Failed to resolve report.' });
  }
});

module.exports = router;
