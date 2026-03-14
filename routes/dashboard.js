const express = require('express');
const { prepare } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/overview', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const totalTests = prepare('SELECT COUNT(*) as count FROM test_cases tc JOIN test_suites ts ON tc.suite_id = ts.id WHERE ts.project_id = ?').get(project_id).count;
  const totalBugs = prepare('SELECT COUNT(*) as count FROM bugs WHERE project_id = ?').get(project_id).count;
  const openBugs = prepare("SELECT COUNT(*) as count FROM bugs WHERE project_id = ? AND status NOT IN ('closed','rejected','verified')").get(project_id).count;
  const criticalBugs = prepare("SELECT COUNT(*) as count FROM bugs WHERE project_id = ? AND priority = 'critical' AND status NOT IN ('closed','rejected','verified')").get(project_id).count;

  const latestRun = prepare('SELECT * FROM test_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(project_id);
  let runStats = null;
  if (latestRun) {
    runStats = prepare(`
      SELECT outcome, COUNT(*) as count FROM test_results WHERE run_id = ? GROUP BY outcome
    `).all(latestRun.id);
  }

  const testsByType = prepare(`
    SELECT tc.test_type, COUNT(*) as count FROM test_cases tc
    JOIN test_suites ts ON tc.suite_id = ts.id WHERE ts.project_id = ? GROUP BY tc.test_type
  `).all(project_id);

  const bugsByStatus = prepare('SELECT status, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY status').all(project_id);
  const bugsByPriority = prepare('SELECT priority, COUNT(*) as count FROM bugs WHERE project_id = ? GROUP BY priority').all(project_id);

  const recentBugs = prepare(`
    SELECT b.bug_key, b.title, b.status, b.priority, b.severity, b.created_at, u.full_name as reported_by_name
    FROM bugs b LEFT JOIN users u ON b.reported_by = u.id
    WHERE b.project_id = ? ORDER BY b.created_at DESC LIMIT 10
  `).all(project_id);

  const suiteProgress = prepare(`
    SELECT ts.id, ts.name, ts.icon,
      (SELECT COUNT(*) FROM test_cases WHERE suite_id = ts.id) as total
    FROM test_suites ts WHERE ts.project_id = ? AND ts.parent_id IS NULL ORDER BY ts.sort_order
  `).all(project_id);

  const integrationStats = prepare(`
    SELECT COUNT(*) as total_integrations,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_integrations,
      SUM(events_received) as total_events
    FROM integrations
  `).get();

  const recentEvents = prepare(`
    SELECT ie.event_type, ie.source_system, ie.status, ie.processed_as, ie.received_at,
      i.name as integration_name
    FROM integration_events ie
    JOIN integrations i ON ie.integration_id = i.id
    ORDER BY ie.received_at DESC LIMIT 10
  `).all();

  res.json({
    overview: { totalTests, totalBugs, openBugs, criticalBugs },
    latestRun: latestRun ? { ...latestRun, stats: runStats } : null,
    testsByType,
    bugsByStatus,
    bugsByPriority,
    recentBugs,
    suiteProgress,
    integrationStats,
    recentEvents
  });
});

router.get('/team-productivity', (req, res) => {
  const { project_id } = req.query;

  const testerStats = prepare(`
    SELECT u.id, u.full_name, u.role,
      (SELECT COUNT(*) FROM test_results WHERE executed_by = u.id) as tests_executed,
      (SELECT COUNT(*) FROM test_results WHERE executed_by = u.id AND outcome = 'passed') as tests_passed,
      (SELECT COUNT(*) FROM test_results WHERE executed_by = u.id AND outcome = 'failed') as tests_failed,
      (SELECT COUNT(*) FROM bugs WHERE reported_by = u.id) as bugs_reported,
      (SELECT COUNT(*) FROM bugs WHERE assigned_to = u.id AND status NOT IN ('closed','rejected','verified')) as bugs_assigned_open
    FROM users u WHERE u.is_active = 1
    ORDER BY tests_executed DESC
  `).all();

  res.json({ testerStats });
});

router.get('/audit-log', (req, res) => {
  const { limit = 100 } = req.query;

  const logs = prepare(`
    SELECT al.*, u.full_name as user_name
    FROM audit_log al LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC LIMIT ?
  `).all(parseInt(limit));

  res.json(logs);
});

module.exports = router;
