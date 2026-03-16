const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const JiraService = require('../services/jira-service');
const AIService = require('../services/ai-service');

const router = express.Router();
router.use(authenticateToken);

function auditLog(action, entity) {
  return (req, res, next) => {
    try { prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(uuidv4(), req.user?.id, action, entity, null); } catch {}
    next();
  };
}

// ==================== TEST CONNECTION ====================

router.post('/test-connection', async (req, res) => {
  const { url, email, token, username, password } = req.body;
  if (!url) return res.status(400).json({ error: 'Jira URL is required' });

  try {
    const jira = new JiraService({ url, email, token, username, password });
    const result = await jira.testConnection();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, connected: false });
  }
});

// ==================== SAVE / GET CONNECTION ====================

router.get('/connections', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const connections = prepare(`SELECT id, project_id, jira_url, jira_type, display_name, email, is_active, last_synced, created_at
    FROM jira_connections WHERE project_id = ? AND is_active = 1 ORDER BY created_at DESC`).all(project_id);
  res.json(connections);
});

router.post('/connect', auditLog('create', 'jira_connection'), async (req, res) => {
  const { project_id, url, email, token, username, password } = req.body;
  if (!project_id || !url) return res.status(400).json({ error: 'project_id and url required' });

  try {
    const jira = new JiraService({ url, email, token, username, password });
    const info = await jira.testConnection();

    const existing = prepare(`SELECT id FROM jira_connections WHERE project_id = ? AND jira_url = ? AND is_active = 1`).get(project_id, url.replace(/\/+$/, ''));
    if (existing) {
      prepare(`UPDATE jira_connections SET email = ?, access_token = ?, username = ?, jira_type = ?, display_name = ?, last_synced = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
        email || null, token || null, username || null, info.type, info.user?.displayName || '', existing.id
      );
      return res.json({ id: existing.id, ...info, updated: true });
    }

    const id = uuidv4();
    prepare(`INSERT INTO jira_connections (id, project_id, jira_url, jira_type, email, access_token, username, display_name, is_active, last_synced, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, datetime('now'), datetime('now'))`).run(
      id, project_id, url.replace(/\/+$/, ''), info.type, email || null, token || null, username || null,
      info.user?.displayName || '', req.user?.id
    );

    res.json({ id, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/connections/:id', auditLog('delete', 'jira_connection'), (req, res) => {
  prepare(`UPDATE jira_connections SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// ==================== PROJECTS ====================

router.get('/projects', async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

  const conn = prepare(`SELECT * FROM jira_connections WHERE id = ? AND is_active = 1`).get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const jira = _buildJiraClient(conn);
    const projects = await jira.getProjects();
    res.json(projects);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== ISSUE TYPES ====================

router.get('/issue-types', async (req, res) => {
  const { connection_id, project_key } = req.query;
  if (!connection_id || !project_key) return res.status(400).json({ error: 'connection_id and project_key required' });

  const conn = prepare(`SELECT * FROM jira_connections WHERE id = ? AND is_active = 1`).get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const jira = _buildJiraClient(conn);
    const types = await jira.getIssueTypes(project_key);
    res.json(types);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== SEARCH ISSUES ====================

router.post('/search', async (req, res) => {
  const { connection_id, project_key, issueType, status, text, jql, startAt, maxResults } = req.body;
  if (!connection_id || !project_key) return res.status(400).json({ error: 'connection_id and project_key required' });

  const conn = prepare(`SELECT * FROM jira_connections WHERE id = ? AND is_active = 1`).get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const jira = _buildJiraClient(conn);
    const result = await jira.searchIssues(project_key, { issueType, status, text, jql, startAt, maxResults });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== GET SINGLE ISSUE (FULL) ====================

router.get('/issue/:key', async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id required' });

  const conn = prepare(`SELECT * FROM jira_connections WHERE id = ? AND is_active = 1`).get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const jira = _buildJiraClient(conn);
    const issue = await jira.getIssue(req.params.key);
    res.json(issue);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== GENERATE TESTS FROM ISSUES ====================

router.post('/generate-tests', auditLog('generate', 'jira_tests'), async (req, res) => {
  const { connection_id, project_id, issue_keys, options } = req.body;
  if (!connection_id || !project_id || !issue_keys || !issue_keys.length) {
    return res.status(400).json({ error: 'connection_id, project_id, and issue_keys[] required' });
  }

  const conn = prepare(`SELECT * FROM jira_connections WHERE id = ? AND is_active = 1`).get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const jira = _buildJiraClient(conn);

    const fullIssues = [];
    for (const key of issue_keys.slice(0, 20)) {
      try {
        const issue = await jira.getIssue(key);
        fullIssues.push(issue);
      } catch (e) {
        console.warn(`Failed to fetch issue ${key}:`, e.message);
      }
    }

    if (fullIssues.length === 0) {
      return res.status(400).json({ error: 'Could not fetch any of the specified issues' });
    }

    const content = jira.formatMultipleIssuesForAI(fullIssues);

    let projectContext = '';
    try {
      const docs = prepare(`SELECT name, doc_type, content FROM project_documents WHERE project_id = ? AND is_active = 1`).all(project_id);
      docs.forEach(d => { projectContext += `\n=== ${d.doc_type}: ${d.name} ===\n${d.content}\n`; });
    } catch {}

    const aiService = new AIService();
    const mergedOptions = { ...(options || {}), projectContext, jiraSource: true };
    const result = await aiService.generateTests('jira_issues', content, mergedOptions);

    result.jiraIssues = fullIssues.map(i => ({ key: i.key, summary: i.summary, type: i.type }));

    const preview = req.body.preview;
    if (preview) {
      return res.json({ id: null, preview: true, ...result });
    }

    const id = uuidv4();
    prepare('INSERT INTO ai_generated_tests (id, project_id, source_type, source_content, generated_tests, traceability_matrix, model_used, confidence_score, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, project_id, 'jira_issues', content.substring(0, 5000), JSON.stringify(result.tests), JSON.stringify(result.traceabilityMatrix || []), result.model, result.confidence, req.user?.id
    );

    res.json({ id, ...result });
  } catch (err) {
    console.error('Jira test generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== HELPERS ====================

function _buildJiraClient(conn) {
  return new JiraService({
    url: conn.jira_url,
    email: conn.email,
    token: conn.access_token,
    username: conn.username,
    password: '',
  });
}

module.exports = router;
