const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { generateToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);
  const token = generateToken(user);

  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role, avatar_url: user.avatar_url }
  });
});

router.post('/register', (req, res) => {
  const { username, email, password, full_name } = req.body;
  if (!username || !email || !password || !full_name) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const existing = prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already exists' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  prepare('INSERT INTO users (id, username, email, password_hash, full_name) VALUES (?, ?, ?, ?, ?)').run(id, username, email, hash, full_name);

  const user = prepare('SELECT id, username, email, full_name, role FROM users WHERE id = ?').get(id);
  const token = generateToken(user);
  res.status(201).json({ token, user });
});

router.get('/me', authenticateToken, (req, res) => {
  const user = prepare('SELECT id, username, email, full_name, role, avatar_url, last_login, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.get('/users', authenticateToken, (req, res) => {
  const users = prepare('SELECT id, username, email, full_name, role, is_active, last_login, created_at FROM users ORDER BY full_name').all();
  res.json(users);
});

module.exports = router;
