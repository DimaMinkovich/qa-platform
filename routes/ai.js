const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const AIService = require('../services/ai-service');

const router = express.Router();
router.use(authenticateToken);

router.get('/status', (req, res) => {
  const aiService = new AIService();
  res.json(aiService.getStatus());
});

router.post('/generate-tests', async (req, res) => {
  const { project_id, source_type, source_content, options, preview } = req.body;
  if (!project_id || !source_type || !source_content) {
    return res.status(400).json({ error: 'project_id, source_type, and source_content required' });
  }

  try {
    const aiService = new AIService();
    const result = await aiService.generateTests(source_type, source_content, options);

    if (preview) {
      return res.json({ id: null, preview: true, ...result });
    }

    const id = uuidv4();
    prepare('INSERT INTO ai_generated_tests (id, project_id, source_type, source_content, generated_tests, traceability_matrix, model_used, confidence_score, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, project_id, source_type, source_content, JSON.stringify(result.tests), JSON.stringify(result.traceabilityMatrix), result.model, result.confidence, req.user.id
    );

    res.json({ id, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/detect-duplicates', async (req, res) => {
  const { project_id, bug_title, bug_description } = req.body;
  if (!project_id || !bug_title) return res.status(400).json({ error: 'project_id and bug_title required' });

  try {
    const aiService = new AIService();
    const existingBugs = prepare('SELECT id, bug_key, title, description, status, priority FROM bugs WHERE project_id = ?').all(project_id);
    const duplicates = await aiService.detectDuplicates(bug_title, bug_description, existingBugs);
    res.json({ duplicates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/root-cause', async (req, res) => {
  const { bug_id } = req.body;
  if (!bug_id) return res.status(400).json({ error: 'bug_id required' });

  try {
    const bug = prepare('SELECT * FROM bugs WHERE id = ?').get(bug_id);
    if (!bug) return res.status(404).json({ error: 'Bug not found' });

    const relatedBugs = prepare(`
      SELECT * FROM bugs WHERE project_id = ? AND id != ? AND status NOT IN ('closed','rejected')
      ORDER BY created_at DESC LIMIT 20
    `).all(bug.project_id, bug_id);

    const aiService = new AIService();
    const analysis = await aiService.analyzeRootCause(bug, relatedBugs);

    prepare('UPDATE bugs SET ai_root_cause = ?, ai_suggested_fix = ? WHERE id = ?').run(
      analysis.rootCause, analysis.suggestedFix, bug_id
    );

    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/risk-prediction', async (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  try {
    const bugs = prepare('SELECT * FROM bugs WHERE project_id = ? ORDER BY created_at DESC').all(project_id);
    const testResults = prepare(`
      SELECT tr.outcome, tc.suite_id, ts.name as suite_name
      FROM test_results tr
      JOIN test_cases tc ON tr.test_case_id = tc.id
      JOIN test_suites ts ON tc.suite_id = ts.id
      WHERE ts.project_id = ?
    `).all(project_id);

    const aiService = new AIService();
    const prediction = await aiService.predictRisks(bugs, testResults);
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/generated', (req, res) => {
  const { project_id } = req.query;
  const generated = prepare(`
    SELECT agt.*, u.full_name as created_by_name
    FROM ai_generated_tests agt
    LEFT JOIN users u ON agt.created_by = u.id
    WHERE agt.project_id = ? ORDER BY agt.created_at DESC
  `).all(project_id);

  generated.forEach(g => {
    g.generated_tests = JSON.parse(g.generated_tests);
    if (g.traceability_matrix) g.traceability_matrix = JSON.parse(g.traceability_matrix);
  });

  res.json(generated);
});

router.post('/import-generated/:id', async (req, res) => {
  const { suite_id } = req.body;
  if (!suite_id) return res.status(400).json({ error: 'suite_id required' });

  const generated = prepare('SELECT * FROM ai_generated_tests WHERE id = ?').get(req.params.id);
  if (!generated) return res.status(404).json({ error: 'Generated tests not found' });

  const tests = JSON.parse(generated.generated_tests);
  const insertCase = prepare('INSERT INTO test_cases (id, suite_id, test_key, title, description, priority, test_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertStep = prepare('INSERT INTO test_steps (id, test_case_id, step_number, action, expected_result) VALUES (?, ?, ?, ?, ?)');

  let imported = 0;
  tests.forEach(test => {
    const caseId = uuidv4();
    insertCase.run(caseId, suite_id, test.test_key || `AI-${String(++imported).padStart(3, '0')}`, test.title, test.description || null, test.priority || 2, test.type || 'manual', req.user.id);
    if (test.steps) {
      test.steps.forEach((step, i) => {
        insertStep.run(uuidv4(), caseId, i + 1, typeof step === 'string' ? step : step.action, typeof step === 'string' ? null : step.expected_result);
      });
    }
  });

  prepare("UPDATE ai_generated_tests SET status = 'imported' WHERE id = ?").run(req.params.id);
  res.json({ imported, total: tests.length });
});

module.exports = router;
