const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { prepare } = require('../database');

const { authenticateToken } = require('../middleware/auth');
router.use(authenticateToken);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function auditLog(action, entity) {
  return (req, res, next) => {
    try { prepare('INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(uuidv4(), req.user?.id, action, entity, null); } catch {}
    next();
  };
}

// ==================== PROJECT DOCUMENTS ====================

router.get('/documents', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const docs = prepare(`
    SELECT pd.*, u.full_name as uploaded_by_name
    FROM project_documents pd
    LEFT JOIN users u ON pd.uploaded_by = u.id
    WHERE pd.project_id = ? AND pd.is_active = 1
    ORDER BY pd.created_at DESC
  `).all(project_id);

  res.json(docs);
});

router.get('/documents/:id', (req, res) => {
  const doc = prepare('SELECT * FROM project_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

router.post('/documents/text', auditLog('create', 'project_document'), (req, res) => {
  const { project_id, name, doc_type, content } = req.body;
  if (!project_id || !name || !content) return res.status(400).json({ error: 'project_id, name, and content required' });

  const id = uuidv4();
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const summary = content.substring(0, 500).replace(/\n/g, ' ').trim();

  prepare(`INSERT INTO project_documents (id, project_id, name, doc_type, content, summary, word_count, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, project_id, name, doc_type || 'specification', content, summary, wordCount, req.user.id
  );

  const doc = prepare('SELECT * FROM project_documents WHERE id = ?').get(id);
  res.status(201).json(doc);
});

router.post('/documents/upload', upload.single('file'), auditLog('upload', 'project_document'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { project_id, doc_type } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const content = req.file.buffer.toString('utf-8');
  const name = req.file.originalname;
  const id = uuidv4();
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const summary = content.substring(0, 500).replace(/\n/g, ' ').trim();

  prepare(`INSERT INTO project_documents (id, project_id, name, doc_type, content, summary, word_count, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, project_id, name, doc_type || 'specification', content, summary, wordCount, req.user.id
  );

  const doc = prepare('SELECT * FROM project_documents WHERE id = ?').get(id);
  res.status(201).json(doc);
});

router.put('/documents/:id', auditLog('update', 'project_document'), (req, res) => {
  const { name, content, doc_type } = req.body;
  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : undefined;
  const summary = content ? content.substring(0, 500).replace(/\n/g, ' ').trim() : undefined;

  prepare(`UPDATE project_documents SET
    name = COALESCE(?, name),
    content = COALESCE(?, content),
    doc_type = COALESCE(?, doc_type),
    summary = COALESCE(?, summary),
    word_count = COALESCE(?, word_count),
    updated_at = datetime('now')
    WHERE id = ?`).run(name, content, doc_type, summary, wordCount, req.params.id);

  const doc = prepare('SELECT * FROM project_documents WHERE id = ?').get(req.params.id);
  res.json(doc);
});

router.delete('/documents/:id', auditLog('delete', 'project_document'), (req, res) => {
  prepare('UPDATE project_documents SET is_active = 0, updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/context', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const docs = prepare(`SELECT name, doc_type, content, word_count FROM project_documents WHERE project_id = ? AND is_active = 1 ORDER BY created_at DESC`).all(project_id);
  const git = prepare(`SELECT * FROM project_git_connections WHERE project_id = ? AND is_active = 1`).get(project_id);

  let totalContext = '';
  docs.forEach(d => {
    totalContext += `\n\n=== ${d.doc_type.toUpperCase()}: ${d.name} ===\n${d.content}`;
  });

  if (git && git.repo_info) {
    try {
      const info = JSON.parse(git.repo_info);
      totalContext += `\n\n=== GIT REPOSITORY: ${git.repo_owner}/${git.repo_name} ===\n`;
      if (info.description) totalContext += `Description: ${info.description}\n`;
      if (info.readme) totalContext += `README:\n${info.readme}\n`;
      if (info.recentCommits) totalContext += `Recent Commits:\n${info.recentCommits.map(c => `- ${c.message}`).join('\n')}\n`;
      if (info.structure) totalContext += `File Structure:\n${info.structure}\n`;
    } catch {}
  }

  res.json({
    has_context: totalContext.trim().length > 0,
    document_count: docs.length,
    git_connected: !!git,
    total_words: docs.reduce((sum, d) => sum + (d.word_count || 0), 0),
    context: totalContext.trim()
  });
});

// ==================== GIT CONNECTION ====================

router.get('/git', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const connections = prepare(`SELECT id, project_id, provider, repo_url, repo_owner, repo_name, branch, last_synced, is_active, created_at FROM project_git_connections WHERE project_id = ? AND is_active = 1`).all(project_id);
  res.json(connections);
});

router.post('/git/connect', auditLog('create', 'git_connection'), async (req, res) => {
  const { project_id, repo_url, access_token, branch } = req.body;
  if (!project_id || !repo_url) return res.status(400).json({ error: 'project_id and repo_url required' });

  const parsed = parseRepoUrl(repo_url);
  if (!parsed) return res.status(400).json({ error: 'Invalid repository URL. Use format: https://github.com/owner/repo' });

  const id = uuidv4();

  prepare(`INSERT INTO project_git_connections (id, project_id, provider, repo_url, repo_owner, repo_name, branch, access_token, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, project_id, parsed.provider, repo_url, parsed.owner, parsed.name, branch || 'main', access_token || null, req.user.id
  );

  try {
    const repoInfo = await fetchRepoInfo(parsed.provider, parsed.owner, parsed.name, branch || 'main', access_token);
    prepare('UPDATE project_git_connections SET repo_info = ?, last_synced = datetime("now") WHERE id = ?').run(JSON.stringify(repoInfo), id);

    res.status(201).json({ id, ...parsed, repo_info: repoInfo, synced: true });
  } catch (err) {
    const conn = prepare('SELECT * FROM project_git_connections WHERE id = ?').get(id);
    res.status(201).json({ id, ...parsed, synced: false, sync_error: err.message, connection: conn });
  }
});

router.post('/git/:id/sync', auditLog('sync', 'git_connection'), async (req, res) => {
  const conn = prepare('SELECT * FROM project_git_connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const repoInfo = await fetchRepoInfo(conn.provider, conn.repo_owner, conn.repo_name, conn.branch, conn.access_token);
    prepare('UPDATE project_git_connections SET repo_info = ?, last_synced = datetime("now") WHERE id = ?').run(JSON.stringify(repoInfo), conn.id);
    res.json({ success: true, repo_info: repoInfo });
  } catch (err) {
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

router.delete('/git/:id', auditLog('delete', 'git_connection'), (req, res) => {
  prepare('UPDATE project_git_connections SET is_active = 0, updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== HELPERS ====================

function parseRepoUrl(url) {
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');

  const githubMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);
  if (githubMatch) return { provider: 'github', owner: githubMatch[1], name: githubMatch[2] };

  const gitlabMatch = cleaned.match(/gitlab\.com[/:]([^/]+)\/([^/]+)/);
  if (gitlabMatch) return { provider: 'gitlab', owner: gitlabMatch[1], name: gitlabMatch[2] };

  const bitbucketMatch = cleaned.match(/bitbucket\.org[/:]([^/]+)\/([^/]+)/);
  if (bitbucketMatch) return { provider: 'bitbucket', owner: bitbucketMatch[1], name: bitbucketMatch[2] };

  return null;
}

async function fetchRepoInfo(provider, owner, name, branch, token) {
  const headers = { 'Accept': 'application/json', 'User-Agent': 'QA-Platform/1.0' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const info = { description: '', readme: '', recentCommits: [], structure: '', languages: {} };

  if (provider === 'github') {
    const base = `https://api.github.com/repos/${owner}/${name}`;

    const repoRes = await fetch(base, { headers });
    if (repoRes.ok) {
      const repo = await repoRes.json();
      info.description = repo.description || '';
      info.languages = {};
      info.defaultBranch = repo.default_branch;
      info.stars = repo.stargazers_count;
      info.openIssues = repo.open_issues_count;
    } else if (repoRes.status === 404) {
      throw new Error('Repository not found. Check the URL or add an access token for private repos.');
    } else if (repoRes.status === 401 || repoRes.status === 403) {
      throw new Error('Access denied. The repository may be private — add a Personal Access Token.');
    }

    try {
      const readmeRes = await fetch(`${base}/readme`, { headers });
      if (readmeRes.ok) {
        const readmeData = await readmeRes.json();
        info.readme = Buffer.from(readmeData.content, 'base64').toString('utf-8').substring(0, 5000);
      }
    } catch {}

    try {
      const commitsRes = await fetch(`${base}/commits?sha=${branch}&per_page=10`, { headers });
      if (commitsRes.ok) {
        const commits = await commitsRes.json();
        info.recentCommits = commits.map(c => ({
          sha: c.sha.substring(0, 7),
          message: (c.commit?.message || '').split('\n')[0].substring(0, 100),
          author: c.commit?.author?.name || '',
          date: c.commit?.author?.date || ''
        }));
      }
    } catch {}

    try {
      const treeRes = await fetch(`${base}/git/trees/${branch}?recursive=1`, { headers });
      if (treeRes.ok) {
        const tree = await treeRes.json();
        const paths = (tree.tree || [])
          .filter(t => t.type === 'blob')
          .map(t => t.path)
          .slice(0, 200);
        info.structure = paths.join('\n');
      }
    } catch {}

    try {
      const langsRes = await fetch(`${base}/languages`, { headers });
      if (langsRes.ok) info.languages = await langsRes.json();
    } catch {}

  } else if (provider === 'gitlab') {
    const encodedPath = encodeURIComponent(`${owner}/${name}`);
    const base = `https://gitlab.com/api/v4/projects/${encodedPath}`;
    const glHeaders = { ...headers };
    if (token) { delete glHeaders['Authorization']; glHeaders['PRIVATE-TOKEN'] = token; }

    const repoRes = await fetch(base, { headers: glHeaders });
    if (repoRes.ok) {
      const repo = await repoRes.json();
      info.description = repo.description || '';
      info.readme = repo.readme_url || '';
    }
  }

  return info;
}

module.exports = router;
