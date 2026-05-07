const express = require('express');
const db = require('../db');
const messagesDb = require('../db').messagesDb;
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function getReactions(messageId) {
  const rows = messagesDb.prepare(
    `SELECT r.emoji, r.user_id
     FROM message_reactions r
     WHERE r.message_id = ?`
  ).all(messageId);

  // Group by emoji: { '👍': [{ userId, username }, ...] }
  return rows.reduce((acc, row) => {
    if (!acc[row.emoji]) acc[row.emoji] = [];
    acc[row.emoji].push({ userId: row.user_id, username: row.username });
    return acc;
  }, {});
}

// GET /api/messages/:friendId
router.get('/:friendId', verifyToken, (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.id;

  if (req.user.role !== 'admin') {
    const friendship = db.prepare(
      `SELECT id FROM friends
       WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
         AND status = 'accepted'`
    ).get(userId, friendId, friendId, userId);
    if (!friendship) return res.status(403).json({ error: 'You are not friends with this user.' });
  }

  const messages = messagesDb.prepare(
    `SELECT m.*
     FROM messages m
     WHERE (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
     ORDER BY m.created_at DESC
     LIMIT 50`
  ).all(userId, friendId, friendId, userId);

  // Get sender info from users DB and add to messages
  const withSenderInfo = messages.map(m => {
    const sender = db.prepare('SELECT username, public_key FROM users WHERE id = ?').get(m.sender_id);
    return {
      ...m,
      sender_username: sender?.username,
      sender_public_key: sender?.public_key
    };
  });

  messagesDb.prepare(
    `UPDATE messages SET read_at = CURRENT_TIMESTAMP
     WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL`
  ).run(userId, friendId);

  const withReactions = withSenderInfo.reverse().map((m) => ({
    ...m,
    reactions: getReactions(m.id)
  }));

  res.json(withReactions);
});

// PUT /api/messages/:id — edit own message
router.put('/:id', verifyToken, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required.' });

  const msg = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Cannot edit others messages.' });
  if (msg.deleted) return res.status(400).json({ error: 'Cannot edit deleted message.' });
  if (msg.file_url) return res.status(400).json({ error: 'Cannot edit media messages.' });

  messagesDb.prepare('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(content.trim(), msg.id);

  const updated = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  const sender = db.prepare('SELECT username, public_key FROM users WHERE id = ?').get(updated.sender_id);

  res.json({ ...updated, sender_username: sender?.username, sender_public_key: sender?.public_key, reactions: getReactions(updated.id) });
});

// DELETE /api/messages/:id — soft delete own message
router.delete('/:id', verifyToken, (req, res) => {
  const msg = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Cannot delete others messages.' });

  messagesDb.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);

  res.json({ ok: true, messageId: msg.id, receiverId: msg.receiver_id });
});

// POST /api/messages/:id/mark-read — KingKai only
router.post('/:id/mark-read', verifyToken, (req, res) => {
  if (req.user.username !== 'KingKai') {
    return res.status(403).json({ error: 'This feature is only available to KingKai.' });
  }

  const msg = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  if (msg.receiver_id !== req.user.id) {
    return res.status(403).json({ error: 'Can only mark your received messages as read.' });
  }

  if (!msg.read_at) {
    messagesDb.prepare('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = ?').run(msg.id);
  }

  const updated = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  res.json({ ...updated, reactions: getReactions(updated.id) });
});

// POST /api/messages/:id/react — toggle reaction
router.post('/:id/react', verifyToken, (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji is required.' });

  const msg = messagesDb.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });
  if (msg.deleted) return res.status(400).json({ error: 'Cannot react to deleted message.' });

  const existing = messagesDb.prepare(
    'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(msg.id, req.user.id, emoji);

  if (existing) {
    messagesDb.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
  } else {
    messagesDb.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
      .run(msg.id, req.user.id, emoji);
  }

  res.json({
    messageId: msg.id,
    reactions: getReactions(msg.id),
    otherUserId: msg.sender_id === req.user.id ? msg.receiver_id : msg.sender_id
  });
});

module.exports = router;
module.exports.getReactions = getReactions;
