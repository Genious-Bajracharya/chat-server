const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/friends/request — { addresseeId }
router.post('/request', verifyToken, (req, res) => {
  const { addresseeId } = req.body;

  if (!addresseeId) {
    return res.status(400).json({ error: 'addresseeId is required.' });
  }

  if (addresseeId === req.user.id) {
    return res.status(400).json({ error: 'Cannot send friend request to yourself.' });
  }

  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(addresseeId);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  // Check for existing relationship
  const existing = db.prepare(
    `SELECT * FROM friends
     WHERE (requester_id = ? AND addressee_id = ?)
        OR (requester_id = ? AND addressee_id = ?)`
  ).get(req.user.id, addresseeId, addresseeId, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(409).json({ error: 'Already friends.' });
    }
    if (existing.status === 'pending') {
      return res.status(409).json({ error: 'Friend request already pending.' });
    }
    if (existing.status === 'rejected') {
      // Allow re-sending after rejection
      db.prepare('UPDATE friends SET status = ?, requester_id = ?, addressee_id = ? WHERE id = ?')
        .run('pending', req.user.id, addresseeId, existing.id);
      const updated = db.prepare('SELECT * FROM friends WHERE id = ?').get(existing.id);
      return res.status(200).json(updated);
    }
  }

  const result = db.prepare(
    'INSERT INTO friends (requester_id, addressee_id, status) VALUES (?, ?, ?)'
  ).run(req.user.id, addresseeId, 'pending');

  const friendRequest = db.prepare('SELECT * FROM friends WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(friendRequest);
});

// POST /api/friends/respond — { requesterId, action: 'accept'|'reject' }
router.post('/respond', verifyToken, (req, res) => {
  const { requesterId, action } = req.body;

  if (!requesterId || !action) {
    return res.status(400).json({ error: 'requesterId and action are required.' });
  }

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Action must be accept or reject.' });
  }

  const friendship = db.prepare(
    'SELECT * FROM friends WHERE requester_id = ? AND addressee_id = ? AND status = ?'
  ).get(requesterId, req.user.id, 'pending');

  if (!friendship) {
    return res.status(404).json({ error: 'No pending friend request found.' });
  }

  const newStatus = action === 'accept' ? 'accepted' : 'rejected';
  db.prepare('UPDATE friends SET status = ? WHERE id = ?').run(newStatus, friendship.id);

  const updated = db.prepare('SELECT * FROM friends WHERE id = ?').get(friendship.id);
  res.json(updated);
});

// GET /api/friends — list accepted friends + pending requests
router.get('/', verifyToken, (req, res) => {
  const userId = req.user.id;

  // Accepted friends
  const acceptedFriends = db.prepare(
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
     WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'`
  ).all(userId, userId, userId, userId, userId, userId, userId, userId);

  // Pending requests received by current user
  const pendingReceived = db.prepare(
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
     WHERE f.addressee_id = ? AND f.status = 'pending'`
  ).all(userId);

  // Pending requests sent by current user
  const pendingSent = db.prepare(
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
     WHERE f.requester_id = ? AND f.status = 'pending'`
  ).all(userId);

  res.json({
    friends: acceptedFriends,
    pendingReceived,
    pendingSent
  });
});

module.exports = router;
