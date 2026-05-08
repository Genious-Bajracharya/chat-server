const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');
const { runQuery, getQuery, allQuery } = require('./db');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  path: '/api/socket.io/',
  cors: {
    origin: [
      process.env.CLIENT_URL || 'http://localhost:5173',
      'http://localhost:5173',
      'http://localhost:3000',
      'https://dnschat.vercel.app'
    ].filter(Boolean),
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper: get all accepted friend IDs for a user
async function getFriendIds(userId) {
  const rows = await allQuery(
    `SELECT
       CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END as friendId
     FROM friends
     WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
    [userId, userId, userId]
  );
  return rows.map((r) => r.friendId);
}

// Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: no token'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
});

// Track connected sockets per user
const userSockets = new Map(); // userId -> Set of socketIds

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`User connected: ${socket.user.username} (${userId}) socket: ${socket.id}`);

  // Track socket
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socket.id);

  // Join personal room immediately
  socket.join(`user_${userId}`);

  // Join personal room handler
  socket.on('join', (data) => {
    socket.join(`user_${userId}`);
    console.log(`User ${socket.user.username} joined room user_${userId}`);
  });

  // Mark user as online and notify friends (async)
  (async () => {
    try {
      await runQuery('UPDATE users SET is_online = 1 WHERE id = ?', [userId]);
      const friendIds = await getFriendIds(userId);
      friendIds.forEach((friendId) => {
        io.to(`user_${friendId}`).emit('user_online', {
          userId,
          username: socket.user.username
        });
      });
    } catch (err) {
      console.error('Error marking user online:', err);
    }
  })();

  // Send message
  socket.on('send_message', async (data) => {
    const { receiverId, content, fileUrl, fileType } = data;

    if (!receiverId || (!content?.trim() && !fileUrl)) {
      return socket.emit('error', { message: 'receiverId and content or file are required.' });
    }

    try {
      // Verify friendship (unless admin)
      if (socket.user.role !== 'admin') {
        const friendship = await getQuery(
          `SELECT id FROM friends
           WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
             AND status = 'accepted'`,
          [userId, receiverId, receiverId, userId]
        );

        if (!friendship) {
          return socket.emit('error', { message: 'You are not friends with this user.' });
        }
      }

      // Check receiver exists
      const receiver = await getQuery('SELECT id, username FROM users WHERE id = ?', [receiverId]);
      if (!receiver) {
        return socket.emit('error', { message: 'Receiver not found.' });
      }

      // Save message to PostgreSQL
      await runQuery(
        'INSERT INTO messages (sender_id, receiver_id, content, file_url, file_type) VALUES (?, ?, ?, ?, ?)',
        [userId, receiverId, content?.trim() || '', fileUrl || null, fileType || null]
      );

      const message = await getQuery(
        `SELECT m.*, u.username as sender_username, u.public_key as sender_public_key FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.sender_id = ? AND m.receiver_id = ? AND m.created_at = (
           SELECT MAX(created_at) FROM messages WHERE sender_id = ? AND receiver_id = ?
         )`,
        [userId, receiverId, userId, receiverId]
      );

      // Emit to receiver
      io.to(`user_${receiverId}`).emit('receive_message', message);

      // Confirm to sender
      socket.emit('message_sent', message);
    } catch (err) {
      console.error('Error sending message:', err);
      socket.emit('error', { message: 'Failed to send message.' });
    }
  });

  // Typing indicator
  socket.on('typing_start', ({ receiverId }) => {
    io.to(`user_${receiverId}`).emit('user_typing', {
      userId,
      username: socket.user.username
    });
  });

  socket.on('typing_stop', ({ receiverId }) => {
    io.to(`user_${receiverId}`).emit('user_stopped_typing', { userId });
  });

  // Edit message
  socket.on('edit_message', async ({ messageId, content }) => {
    if (!content?.trim()) return;

    try {
      const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [messageId]);
      if (!msg || msg.sender_id !== userId || msg.file_url) return;

      await runQuery('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
        [content.trim(), messageId]);

      const updated = await getQuery('SELECT * FROM messages WHERE id = ?', [messageId]);
      const sender = await getQuery('SELECT username, public_key FROM users WHERE id = ?', [userId]);

      const { getReactions } = require('./routes/messages');
      const reactions = await getReactions(messageId);
      const payload = { ...updated, sender_username: sender?.username, sender_public_key: sender?.public_key, reactions };

      socket.emit('message_edited', payload);
      io.to(`user_${msg.receiver_id}`).emit('message_edited', payload);
    } catch (err) {
      console.error('Error editing message:', err);
    }
  });

  // Delete message
  socket.on('delete_message', async ({ messageId }) => {
    try {
      const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [messageId]);
      if (!msg || msg.sender_id !== userId) return;

      await runQuery('DELETE FROM messages WHERE id = ?', [messageId]);

      socket.emit('message_deleted', { messageId });
      io.to(`user_${msg.receiver_id}`).emit('message_deleted', { messageId });
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  // Reaction
  socket.on('add_reaction', async ({ messageId, emoji }) => {
    if (!emoji) return;

    try {
      const msg = await getQuery('SELECT * FROM messages WHERE id = ?', [messageId]);
      if (!msg) return;

      const existing = await getQuery(
        'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [messageId, userId, emoji]
      );

      if (existing) {
        await runQuery('DELETE FROM message_reactions WHERE id = ?', [existing.id]);
      } else {
        await runQuery('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
          [messageId, userId, emoji]);
      }

      const { getReactions } = require('./routes/messages');
      const reactions = await getReactions(messageId);
      const payload = { messageId, reactions };

      socket.emit('reaction_updated', payload);
      const otherUserId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
      io.to(`user_${otherUserId}`).emit('reaction_updated', payload);
    } catch (err) {
      console.error('Error adding reaction:', err);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username} socket: ${socket.id}`);

    const userSocketSet = userSockets.get(userId);
    if (userSocketSet) {
      userSocketSet.delete(socket.id);

      // Only mark offline if no more active sockets for this user
      if (userSocketSet.size === 0) {
        userSockets.delete(userId);

        (async () => {
          try {
            await runQuery('UPDATE users SET is_online = 0 WHERE id = ?', [userId]);
            const friendIds = await getFriendIds(userId);
            friendIds.forEach((friendId) => {
              io.to(`user_${friendId}`).emit('user_offline', {
                userId,
                username: socket.user.username
              });
            });
          } catch (err) {
            console.error('Error marking user offline:', err);
          }
        })();
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`ChatApp server running on port ${PORT}`);
  console.log(`CORS enabled for ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
});
