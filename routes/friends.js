const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
const { getQuery, allQuery, runQuery } = require('../db');

const router = express.Router();

// POST /api/friends/request — { addresseeId }
router.post('/request', verifyToken, async (req, res) => {
  const { addresseeId } = req.body;

  try {
    if (!addresseeId) {
      return res.status(400).json({ error: 'addresseeId is required.' });
    }

    if (addresseeId === req.user.id) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself.' });
    }

    const targetUser = await getQuery('SELECT id FROM users WHERE id = ?', [addresseeId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check for existing relationship
    const existing = await getQuery(
      `SELECT * FROM friends
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`,
      [req.user.id, addresseeId, addresseeId, req.user.id]
    );

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Already friends.' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'Friend request already pending.' });
      }
      if (existing.status === 'rejected') {
        // Allow re-sending after rejection
        await runQuery('UPDATE friends SET status = ?, requester_id = ?, addressee_id = ? WHERE id = ?',
          ['pending', req.user.id, addresseeId, existing.id]);
        const updated = await getQuery('SELECT * FROM friends WHERE id = ?', [existing.id]);
        return res.status(200).json(updated);
      }
    }

    await runQuery(
      'INSERT INTO friends (requester_id, addressee_id, status) VALUES (?, ?, ?)',
      [req.user.id, addresseeId, 'pending']
    );

    // Get the last inserted row ID (this is tricky with PostgreSQL)
    const friendRequest = await getQuery(
      `SELECT * FROM friends
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, addresseeId]
    );

    res.status(201).json(friendRequest);
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ error: 'Failed to send friend request.' });
  }
});

// POST /api/friends/respond — { requesterId, action: 'accept'|'reject' }
router.post('/respond', verifyToken, async (req, res) => {
  const { requesterId, action } = req.body;

  try {
    if (!requesterId || !action) {
      return res.status(400).json({ error: 'requesterId and action are required.' });
    }

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or reject.' });
    }

    const friendship = await getQuery(
      'SELECT * FROM friends WHERE requester_id = ? AND addressee_id = ? AND status = ?',
      [requesterId, req.user.id, 'pending']
    );

    if (!friendship) {
      return res.status(404).json({ error: 'No pending friend request found.' });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    await runQuery('UPDATE friends SET status = ? WHERE id = ?', [newStatus, friendship.id]);

    const updated = await getQuery('SELECT * FROM friends WHERE id = ?', [friendship.id]);
    res.json(updated);
  } catch (err) {
    console.error('Error responding to friend request:', err);
    res.status(500).json({ error: 'Failed to respond to friend request.' });
  }
});

// GET /api/friends — list accepted friends + pending requests
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Accepted friends
    const acceptedFriends = await allQuery(
      `SELECT
         f.id as friendshipId,
         f.status,
         f.created_at as friendsSince,
         CASE WHEN f.requester_id = ? THEN u2.id ELSE u1.id END as id,
         CASE WHEN f.requester_id = ? THEN u2.username ELSE u1.username END as username,
         CASE WHEN f.requester_id = ? THEN u2.email ELSE u1.email END as email,
         CASE WHEN f.requester_id = ? THEN u2.is_online ELSE u1.is_online END as is_online,
         CASE WHEN f.requester_id = ? THEN u2.role ELSE u1.role END as role,
         CASE WHEN f.requester_id = ? THEN u2.public_key ELSE u1.public_key END as public_key
       FROM friends f
       JOIN users u1 ON f.requester_id = u1.id
       JOIN users u2 ON f.addressee_id = u2.id
       WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'`,
      [userId, userId, userId, userId, userId, userId, userId, userId]
    );

    // Pending requests received by current user
    const pendingReceived = await allQuery(
      `SELECT
         f.id as friendshipId,
         f.created_at,
         u.id,
         u.username,
         u.email,
         u.is_online,
         u.role
       FROM friends f
       JOIN users u ON f.requester_id = u.id
       WHERE f.addressee_id = ? AND f.status = 'pending'`,
      [userId]
    );

    // Pending requests sent by current user
    const pendingSent = await allQuery(
      `SELECT
         f.id as friendshipId,
         f.created_at,
         u.id,
         u.username,
         u.email,
         u.is_online,
         u.role
       FROM friends f
       JOIN users u ON f.addressee_id = u.id
       WHERE f.requester_id = ? AND f.status = 'pending'`,
      [userId]
    );

    res.json({
      friends: acceptedFriends,
      pendingReceived,
      pendingSent
    });
  } catch (err) {
    console.error('Error fetching friends:', err);
    res.status(500).json({ error: 'Failed to fetch friends.' });
  }
});

module.exports = router;
