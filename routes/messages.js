const express = require('express');
const db = require('../db');
const messagesDb = require('../db').messagesDb;
const { verifyToken } = require('../middleware/auth');
const { getQuery, allQuery, runQuery } = require('../db');

const router = express.Router();

async function getReactions(messageId) {
  const rows = await allQuery(
    `SELECT r.emoji, r.user_id, u.username
     FROM message_reactions r
     JOIN users u ON r.user_id = u.id
     WHERE r.message_id = ?`,
    [messageId]
  );

  // Group by emoji: { '👍': [{ userId, username }, ...] }
  return rows.reduce((acc, row) => {
    if (!acc[row.emoji]) acc[row.emoji] = [];
    acc[row.emoji].push({ userId: row.user_id, username: row.username });
    return acc;
  }, {});
}

// GET /api/messages/:friendId
router.get('/:friendId', verifyToken, async (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.id;

  try {
    if (req.user.role !== 'admin') {
      const friendship = await getQuery(
        `SELECT id FROM friends
         WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
           AND status = 'accepted'`,
        [userId, friendId, friendId, userId]
      );
      if (!friendship) return res.status(403).json({ error: 'You are not friends with this user.' });
    }

    const messages = await allQuery(
      `SELECT m.*, u.username as sender_username, u.public_key as sender_public_key
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC
       LIMIT 50`,
      [userId, friendId, friendId, userId]
    );

    // Mark unread messages as read
    await runQuery(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL`,
      [userId, friendId]
    );

    const withReactions = await Promise.all(messages.map(async (m) => ({
      ...m,
      reactions: await getReactions(m.id)
    })));

    res.json(withReactions);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// PUT /api/messages/:id — edit own message
router.put('/:id', verifyToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required.' });

  try {
    const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Cannot edit others messages.' });
    if (msg.file_url) return res.status(400).json({ error: 'Cannot edit media messages.' });

    await runQuery('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
      [content.trim(), msg.id]);

    const updated = await getQuery('SELECT * FROM messages WHERE id = ?', [msg.id]);
    const sender = await getQuery('SELECT username, public_key FROM users WHERE id = ?', [updated.sender_id]);
    const reactions = await getReactions(updated.id);

    res.json({ ...updated, sender_username: sender?.username, sender_public_key: sender?.public_key, reactions });
  } catch (err) {
    console.error('Error editing message:', err);
    res.status(500).json({ error: 'Failed to edit message.' });
  }
});

// DELETE /api/messages/:id — delete own message
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Cannot delete others messages.' });

    await runQuery('DELETE FROM messages WHERE id = ?', [msg.id]);

    res.json({ ok: true, messageId: msg.id, receiverId: msg.receiver_id });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ error: 'Failed to delete message.' });
  }
});

// POST /api/messages/:id/mark-read — KingKai only
router.post('/:id/mark-read', verifyToken, async (req, res) => {
  try {
    if (req.user.username !== 'KingKai') {
      return res.status(403).json({ error: 'This feature is only available to KingKai.' });
    }

    const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    if (msg.receiver_id !== req.user.id) {
      return res.status(403).json({ error: 'Can only mark your received messages as read.' });
    }

    if (!msg.read_at) {
      await runQuery('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = ?', [msg.id]);
    }

    const updated = await getQuery('SELECT * FROM messages WHERE id = ?', [msg.id]);
    const reactions = await getReactions(updated.id);
    res.json({ ...updated, reactions });
  } catch (err) {
    console.error('Error marking message as read:', err);
    res.status(500).json({ error: 'Failed to mark message as read.' });
  }
});

// POST /api/messages/:id/react — toggle reaction
router.post('/:id/react', verifyToken, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji is required.' });

  try {
    const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });

    const existing = await getQuery(
      'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [msg.id, req.user.id, emoji]
    );

    if (existing) {
      await runQuery('DELETE FROM message_reactions WHERE id = ?', [existing.id]);
    } else {
      await runQuery('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [msg.id, req.user.id, emoji]);
    }

    const reactions = await getReactions(msg.id);
    res.json({
      messageId: msg.id,
      reactions,
      otherUserId: msg.sender_id === req.user.id ? msg.receiver_id : msg.sender_id
    });
  } catch (err) {
    console.error('Error adding reaction:', err);
    res.status(500).json({ error: 'Failed to add reaction.' });
  }
});

module.exports = router;
module.exports.getReactions = getReactions;
