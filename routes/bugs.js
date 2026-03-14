const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { project_id, status, priority, severity, assigned_to, search, source, page = 1, limit = 50 } = req.query;

  let query = `
    SELECT b.*, r.full_name as reported_by_name, a.full_name as assigned_to_name
    FROM bugs b
    LEFT JOIN users r ON b.reported_by = r.id
    LEFT JOIN users a ON b.assigned_to = a.id
    WHERE 1=1
  `;
  const params = [];

  if (project_id) { query += ' AND b.project_id = ?'; params.push(project_id); }
  if (status) { query += ' AND b.status = ?'; params.push(status); }
  if (priority) { query += ' AND b.priority = ?'; params.push(priority); }
  if (severity) { query += ' AND b.severity = ?'; params.push(severity); }
  if (assigned_to) { query += ' AND b.assigned_to = ?'; params.push(assigned_to); }
  if (source) { query += ' AND b.source = ?'; params.push(source); }
  if (search) { query += ' AND (b.title LIKE ? OR b.bug_key LIKE ? OR b.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const countQuery = query.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM');
  const total = prepare(countQuery).get(...params).total;

  query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const bugs = prepare(query).all(...params);
  res.json({ bugs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
});

router.get('/stats', (req, res) => {
  const { project_id } = req.query;

  const byStatus = prepare(`SELECT status, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY status`).all(project_id);
  const byPriority = prepare(`SELECT priority, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY priority`).all(project_id);
  const bySeverity = prepare(`SELECT severity, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY severity`).all(project_id);
  const bySource = prepare(`SELECT source, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY source`).all(project_id);
  const recentTrend = prepare(`
    SELECT date(created_at) as date, COUNT(*) as opened,
      (SELECT COUNT(*) FROM bugs b2 WHERE b2.project_id = ? AND date(b2.resolved_at) = date(b.created_at)) as closed
    FROM bugs b WHERE b.project_id = ? AND b.created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at) ORDER BY date
  `).all(project_id, project_id);

  res.json({ byStatus, byPriority, bySeverity, bySource, recentTrend });
});

router.get('/:id', (req, res) => {
  const bug = prepare(`
    SELECT b.*, r.full_name as reported_by_name, a.full_name as assigned_to_name
    FROM bugs b
    LEFT JOIN users r ON b.reported_by = r.id
    LEFT JOIN users a ON b.assigned_to = a.id
    WHERE b.id = ?
  `).get(req.params.id);

  if (!bug) return res.status(404).json({ error: 'Bug not found' });

  bug.comments = prepare(`
    SELECT bc.*, u.full_name as user_name FROM bug_comments bc
    LEFT JOIN users u ON bc.user_id = u.id WHERE bc.bug_id = ? ORDER BY bc.created_at
  `).all(req.params.id);

  bug.history = prepare(`
    SELECT bh.*, u.full_name as user_name FROM bug_history bh
    LEFT JOIN users u ON bh.user_id = u.id WHERE bh.bug_id = ? ORDER BY bh.created_at DESC
  `).all(req.params.id);

  res.json(bug);
});

router.post('/', auditLog('create', 'bug'), (req, res) => {
  const { project_id, title, description, steps_to_reproduce, actual_result, expected_result, priority, severity, environment, browser, os, version, assigned_to, tags, source, source_system, source_ref } = req.body;

  if (!project_id || !title) return res.status(400).json({ error: 'project_id and title required' });

  const id = uuidv4();

  const project = prepare('SELECT key FROM projects WHERE id = ?').get(project_id);
  const bugCount = prepare('SELECT COUNT(*) as count FROM bugs WHERE project_id = ?').get(project_id).count;
  const bugKey = `${project?.key || 'BUG'}-${String(bugCount + 1).padStart(3, '0')}`;

  prepare(`INSERT INTO bugs (id, project_id, bug_key, title, description, steps_to_reproduce, actual_result, expected_result, priority, severity, environment, browser, os, version, assigned_to, reported_by, tags, source, source_system, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, project_id, bugKey, title, description || null, steps_to_reproduce || null, actual_result || null, expected_result || null,
    priority || 'medium', severity || 'major', environment || null, browser || null, os || null, version || null,
    assigned_to || null, req.user.id, tags ? JSON.stringify(tags) : null, source || 'manual', source_system || null, source_ref || null
  );

  prepare('INSERT INTO bug_history (id, bug_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(), id, req.user.id, 'status', null, 'open'
  );

  const bug = prepare('SELECT * FROM bugs WHERE id = ?').get(id);
  res.status(201).json(bug);
});

router.put('/:id', auditLog('update', 'bug'), (req, res) => {
  const existing = prepare('SELECT * FROM bugs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bug not found' });

  const fields = ['title', 'description', 'steps_to_reproduce', 'actual_result', 'expected_result', 'status', 'priority', 'severity', 'environment', 'assigned_to', 'resolution', 'tags'];

  const updates = [];
  const params = [];
  const historyInsert = prepare('INSERT INTO bug_history (id, bug_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)');

  fields.forEach(field => {
    if (req.body[field] !== undefined && req.body[field] !== existing[field]) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
      historyInsert.run(uuidv4(), req.params.id, req.user.id, field, existing[field], req.body[field]);
    }
  });

  if (req.body.status && ['closed', 'verified', 'fixed'].includes(req.body.status) && !existing.resolved_at) {
    updates.push('resolved_at = datetime("now")');
  }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    prepare(`UPDATE bugs SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  }

  res.json(prepare('SELECT * FROM bugs WHERE id = ?').get(req.params.id));
});

router.post('/:id/comments', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const id = uuidv4();
  prepare('INSERT INTO bug_comments (id, bug_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, content);
  res.status(201).json(prepare('SELECT bc.*, u.full_name as user_name FROM bug_comments bc LEFT JOIN users u ON bc.user_id = u.id WHERE bc.id = ?').get(id));
});

module.exports = router;
