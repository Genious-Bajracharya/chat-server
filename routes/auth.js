const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { verifyToken, requireAdmin, JWT_SECRET } = require('../middleware/auth');
const { getCountryFromIP, parseDeviceInfo } = require('../utils/geoip');
const { getQuery, runQuery } = require('../db');

const router = express.Router();

// Helper: extract client IP (handles proxies like Render)
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '0.0.0.0';
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, team } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }

  if (!team || !['D', 'S'].includes(team)) {
    return res.status(400).json({ error: 'Team must be either D or S.' });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  try {
    const existingUser = await getQuery('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already taken.' });
    }

    const clientIP = getClientIP(req);
    const country = await getCountryFromIP(clientIP);
    const deviceInfo = parseDeviceInfo(req.headers['user-agent']);

    const passwordHash = await bcrypt.hash(password, 10);
    await runQuery(
      `INSERT INTO users (username, email, password_hash, role, registration_ip, registration_country, device_info, last_login_at, last_login_ip, team)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [username, email, passwordHash, 'user', clientIP, country, deviceInfo, clientIP, team]
    );

    const user = await getQuery(
      'SELECT id, username, email, role, created_at, registration_country, device_info, team FROM users WHERE email = ?',
      [email]
    );

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await getQuery('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const clientIP = getClientIP(req);
    await runQuery('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?',
      [clientIP, user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...userWithoutPassword } = user;
    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /api/auth/impersonate/:userId — admin only
router.post('/impersonate/:userId', verifyToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    const targetUser = await getQuery('SELECT id, username, email, role FROM users WHERE id = ?', [userId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const token = jwt.sign(
      {
        id: targetUser.id,
        username: targetUser.username,
        email: targetUser.email,
        role: targetUser.role,
        impersonatedBy: req.user.id,
        impersonating: true
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token, user: { ...targetUser, impersonating: true } });
  } catch (err) {
    console.error('Impersonate error:', err);
    res.status(500).json({ error: 'Failed to impersonate user.' });
  }
});

module.exports = router;
