const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

const router = express.Router();
router.use(authenticateToken);

// --- Test Suites ---

router.get('/suites', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const suites = prepare(`
    SELECT s.*, u.full_name as created_by_name,
      (SELECT COUNT(*) FROM test_cases tc WHERE tc.suite_id = s.id) as test_count
    FROM test_suites s
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.project_id = ?
    ORDER BY s.sort_order, s.name
  `).all(project_id);

  const buildTree = (parentId) => {
    return suites
      .filter(s => s.parent_id === parentId)
      .map(s => ({ ...s, children: buildTree(s.id) }));
  };

  res.json(buildTree(null));
});

router.post('/suites', auditLog('create', 'test_suite'), (req, res) => {
  const { project_id, parent_id, name, description, icon } = req.body;
  if (!project_id || !name) return res.status(400).json({ error: 'project_id and name required' });

  const id = uuidv4();
  prepare('INSERT INTO test_suites (id, project_id, parent_id, name, description, icon, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, project_id, parent_id || null, name, description || null, icon || '📁', req.user.id
  );

  const suite = prepare('SELECT * FROM test_suites WHERE id = ?').get(id);
  res.status(201).json(suite);
});

router.delete('/suites/:id', auditLog('delete', 'test_suite'), (req, res) => {
  prepare('DELETE FROM test_suites WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Test Cases ---

router.get('/cases', (req, res) => {
  const { suite_id, project_id, search, priority, type } = req.query;

  let query = `
    SELECT tc.*, ts.name as suite_name, ts.icon as suite_icon, u.full_name as created_by_name
    FROM test_cases tc
    JOIN test_suites ts ON tc.suite_id = ts.id
    LEFT JOIN users u ON tc.created_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (suite_id) { query += ' AND tc.suite_id = ?'; params.push(suite_id); }
  if (project_id) { query += ' AND ts.project_id = ?'; params.push(project_id); }
  if (search) { query += ' AND (tc.title LIKE ? OR tc.test_key LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (priority) { query += ' AND tc.priority = ?'; params.push(priority); }
  if (type) { query += ' AND tc.test_type = ?'; params.push(type); }

  query += ' ORDER BY tc.test_key';
  const cases = prepare(query).all(...params);

  const stepsStmt = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number');
  cases.forEach(tc => { tc.steps = stepsStmt.all(tc.id); });

  res.json(cases);
});

router.post('/cases', auditLog('create', 'test_case'), (req, res) => {
  const { suite_id, test_key, title, description, preconditions, priority, test_type, is_critical, estimated_time_minutes, tags, steps } = req.body;
  if (!suite_id || !test_key || !title) return res.status(400).json({ error: 'suite_id, test_key, and title required' });

  const id = uuidv4();

  prepare(`INSERT INTO test_cases (id, suite_id, test_key, title, description, preconditions, priority, test_type, is_critical, estimated_time_minutes, tags, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, suite_id, test_key, title, description || null, preconditions || null, priority || 2, test_type || 'manual', is_critical ? 1 : 0, estimated_time_minutes || null, tags ? JSON.stringify(tags) : null, req.user.id
  );

  if (steps && steps.length > 0) {
    const insertStep = prepare('INSERT INTO test_steps (id, test_case_id, step_number, action, expected_result, test_data) VALUES (?, ?, ?, ?, ?, ?)');
    steps.forEach((step, i) => {
      insertStep.run(uuidv4(), id, i + 1, step.action, step.expected_result || null, step.test_data || null);
    });
  }

  const testCase = prepare('SELECT * FROM test_cases WHERE id = ?').get(id);
  testCase.steps = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number').all(id);
  res.status(201).json(testCase);
});

router.put('/cases/:id', auditLog('update', 'test_case'), (req, res) => {
  const { title, description, preconditions, priority, test_type, is_critical, estimated_time_minutes, tags, steps, suite_id } = req.body;

  prepare(`UPDATE test_cases SET title = COALESCE(?, title), description = COALESCE(?, description), preconditions = COALESCE(?, preconditions), priority = COALESCE(?, priority), test_type = COALESCE(?, test_type), is_critical = COALESCE(?, is_critical), estimated_time_minutes = COALESCE(?, estimated_time_minutes), tags = COALESCE(?, tags), suite_id = COALESCE(?, suite_id), updated_at = datetime('now') WHERE id = ?`).run(
    title, description, preconditions, priority, test_type, is_critical !== undefined ? (is_critical ? 1 : 0) : undefined, estimated_time_minutes, tags ? JSON.stringify(tags) : undefined, suite_id || undefined, req.params.id
  );

  if (steps) {
    prepare('DELETE FROM test_steps WHERE test_case_id = ?').run(req.params.id);
    const insertStep = prepare('INSERT INTO test_steps (id, test_case_id, step_number, action, expected_result, test_data) VALUES (?, ?, ?, ?, ?, ?)');
    steps.forEach((step, i) => {
      insertStep.run(uuidv4(), req.params.id, i + 1, step.action, step.expected_result || null, step.test_data || null);
    });
  }

  const testCase = prepare('SELECT * FROM test_cases WHERE id = ?').get(req.params.id);
  testCase.steps = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number').all(req.params.id);
  res.json(testCase);
});

router.delete('/cases/:id', auditLog('delete', 'test_case'), (req, res) => {
  prepare('DELETE FROM test_cases WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Test Runs ---

router.get('/runs', (req, res) => {
  const { project_id } = req.query;
  const runs = prepare(`
    SELECT tr.*, u.full_name as assigned_to_name, cu.full_name as created_by_name,
      (SELECT COUNT(*) FROM test_results WHERE run_id = tr.id) as total_tests,
      (SELECT COUNT(*) FROM test_results WHERE run_id = tr.id AND outcome = 'passed') as passed,
      (SELECT COUNT(*) FROM test_results WHERE run_id = tr.id AND outcome = 'failed') as failed
    FROM test_runs tr
    LEFT JOIN users u ON tr.assigned_to = u.id
    LEFT JOIN users cu ON tr.created_by = cu.id
    WHERE tr.project_id = ?
    ORDER BY tr.created_at DESC
  `).all(project_id);
  res.json(runs);
});

router.post('/runs', auditLog('create', 'test_run'), (req, res) => {
  const { project_id, plan_id, name, environment, build_number, assigned_to, test_case_ids } = req.body;
  if (!project_id || !name) return res.status(400).json({ error: 'project_id and name required' });

  const id = uuidv4();

  prepare('INSERT INTO test_runs (id, project_id, plan_id, name, environment, build_number, assigned_to, started_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), ?)').run(
    id, project_id, plan_id || null, name, environment || 'staging', build_number || null, assigned_to || null, req.user.id
  );

  if (test_case_ids && test_case_ids.length > 0) {
    const insertResult = prepare('INSERT INTO test_results (id, run_id, test_case_id) VALUES (?, ?, ?)');
    test_case_ids.forEach(tcId => insertResult.run(uuidv4(), id, tcId));
  }

  res.status(201).json(prepare('SELECT * FROM test_runs WHERE id = ?').get(id));
});

// --- Check if test case is in an active (incomplete) run ---

router.get('/runs/active-check/:test_case_id', (req, res) => {
  const activeRuns = prepare(`
    SELECT tr.run_id, r.name, tr.outcome
    FROM test_results tr
    JOIN test_runs r ON tr.run_id = r.id
    WHERE tr.test_case_id = ?
      AND (tr.outcome IS NULL OR tr.outcome = 'not_run')
  `).all(req.params.test_case_id);

  if (activeRuns.length > 0) {
    const runNames = [...new Set(activeRuns.map(r => r.name))];
    res.json({ has_active: true, runs: runNames, count: activeRuns.length });
  } else {
    res.json({ has_active: false, runs: [], count: 0 });
  }
});

// --- Add tests to existing run ---

router.post('/runs/:id/add', auditLog('update', 'test_run'), (req, res) => {
  const { test_case_ids } = req.body;
  if (!test_case_ids || !test_case_ids.length) return res.status(400).json({ error: 'test_case_ids required' });

  const existing = prepare('SELECT test_case_id FROM test_results WHERE run_id = ?').all(req.params.id).map(r => r.test_case_id);
  const insertResult = prepare('INSERT INTO test_results (id, run_id, test_case_id) VALUES (?, ?, ?)');
  let added = 0;
  test_case_ids.forEach(tcId => {
    if (!existing.includes(tcId)) {
      insertResult.run(uuidv4(), req.params.id, tcId);
      added++;
    }
  });

  res.json({ success: true, added });
});

// --- Clone Test Case ---

router.post('/cases/:id/clone', auditLog('create', 'test_case'), (req, res) => {
  const original = prepare('SELECT * FROM test_cases WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Test case not found' });

  const originalSteps = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number').all(req.params.id);
  const id = uuidv4();
  const newKey = original.test_key + '-COPY';

  prepare(`INSERT INTO test_cases (id, suite_id, test_key, title, description, preconditions, priority, test_type, is_critical, estimated_time_minutes, tags, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.body.suite_id || original.suite_id, newKey, `[Copy] ${original.title}`, original.description, original.preconditions, original.priority, original.test_type, original.is_critical, original.estimated_time_minutes, original.tags, req.user.id
  );

  if (originalSteps.length > 0) {
    const insertStep = prepare('INSERT INTO test_steps (id, test_case_id, step_number, action, expected_result, test_data) VALUES (?, ?, ?, ?, ?, ?)');
    originalSteps.forEach(s => insertStep.run(uuidv4(), id, s.step_number, s.action, s.expected_result, s.test_data));
  }

  const testCase = prepare('SELECT * FROM test_cases WHERE id = ?').get(id);
  testCase.steps = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number').all(id);
  res.status(201).json(testCase);
});

// --- Test Results ---

router.get('/results/:run_id', (req, res) => {
  const results = prepare(`
    SELECT tr.*, tc.test_key, tc.title, tc.description, tc.preconditions, tc.priority, tc.is_critical, tc.test_type, u.full_name as executed_by_name
    FROM test_results tr
    JOIN test_cases tc ON tr.test_case_id = tc.id
    LEFT JOIN users u ON tr.executed_by = u.id
    WHERE tr.run_id = ?
    ORDER BY tc.test_key
  `).all(req.params.run_id);

  const stepsStmt = prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_number');
  results.forEach(r => { r.steps = stepsStmt.all(r.test_case_id); });

  res.json(results);
});

router.put('/results/:id', auditLog('update', 'test_result'), (req, res) => {
  const { outcome, comment, duration_seconds } = req.body;

  prepare('UPDATE test_results SET outcome = ?, comment = ?, duration_seconds = ?, executed_by = ?, executed_at = datetime("now"), updated_at = datetime("now") WHERE id = ?').run(
    outcome, comment || null, duration_seconds || null, req.user.id, req.params.id
  );

  res.json(prepare('SELECT * FROM test_results WHERE id = ?').get(req.params.id));
});

// --- Projects ---

router.get('/projects', (req, res) => {
  const projects = prepare(`
    SELECT p.*, u.full_name as owner_name,
      (SELECT COUNT(*) FROM test_cases tc JOIN test_suites ts ON tc.suite_id = ts.id WHERE ts.project_id = p.id) as total_tests,
      (SELECT COUNT(*) FROM bugs WHERE project_id = p.id AND status NOT IN ('closed','rejected')) as open_bugs
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    ORDER BY p.name
  `).all();
  res.json(projects);
});

router.post('/projects', auditLog('create', 'project'), (req, res) => {
  const { name, key, description } = req.body;
  if (!name || !key) return res.status(400).json({ error: 'name and key required' });

  const id = uuidv4();
  prepare('INSERT INTO projects (id, name, key, description, owner_id) VALUES (?, ?, ?, ?, ?)').run(id, name, key, description || null, req.user.id);
  res.status(201).json(prepare('SELECT * FROM projects WHERE id = ?').get(id));
});

module.exports = router;
