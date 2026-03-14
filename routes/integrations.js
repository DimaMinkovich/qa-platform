const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('../database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const EventProcessor = require('../services/event-processor');

const router = express.Router();

// --- Integration Management (requires auth) ---

router.get('/', authenticateToken, (req, res) => {
  const integrations = prepare(`
    SELECT i.*, u.full_name as created_by_name,
      (SELECT COUNT(*) FROM integration_events WHERE integration_id = i.id) as total_events,
      (SELECT COUNT(*) FROM integration_events WHERE integration_id = i.id AND status = 'pending') as pending_events
    FROM integrations i
    LEFT JOIN users u ON i.created_by = u.id
    ORDER BY i.created_at DESC
  `).all();
  integrations.forEach(i => { i.config = JSON.parse(i.config); });
  res.json(integrations);
});

router.post('/', authenticateToken, auditLog('create', 'integration'), (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type || !config) return res.status(400).json({ error: 'name, type, and config required' });

  const id = uuidv4();
  const webhookSecret = uuidv4().replace(/-/g, '');

  const fullConfig = { ...config, webhook_secret: webhookSecret, webhook_url: `/api/integrations/webhook/${id}` };

  prepare('INSERT INTO integrations (id, name, type, config, created_by) VALUES (?, ?, ?, ?, ?)').run(
    id, name, type, JSON.stringify(fullConfig), req.user.id
  );

  const integration = prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  integration.config = JSON.parse(integration.config);
  res.status(201).json(integration);
});

router.put('/:id', authenticateToken, auditLog('update', 'integration'), (req, res) => {
  const { name, config, is_active } = req.body;

  const existing = prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Integration not found' });

  const existingConfig = JSON.parse(existing.config);
  const newConfig = config ? { ...existingConfig, ...config } : existingConfig;

  prepare('UPDATE integrations SET name = COALESCE(?, name), config = ?, is_active = COALESCE(?, is_active), updated_at = datetime("now") WHERE id = ?').run(
    name || null, JSON.stringify(newConfig), is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id
  );

  const integration = prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id);
  integration.config = JSON.parse(integration.config);
  res.json(integration);
});

router.delete('/:id', authenticateToken, auditLog('delete', 'integration'), (req, res) => {
  prepare('DELETE FROM integrations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Webhook Receiver (no auth - uses webhook secret) ---

router.post('/webhook/:integration_id', express.json(), (req, res) => {
  const integration = prepare('SELECT * FROM integrations WHERE id = ? AND is_active = 1').get(req.params.integration_id);

  if (!integration) return res.status(404).json({ error: 'Integration not found or inactive' });

  const config = JSON.parse(integration.config);
  const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
  if (config.webhook_secret && providedSecret !== config.webhook_secret) {
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  const eventId = uuidv4();
  const eventType = detectEventType(integration.type, req.headers, req.body);

  prepare('INSERT INTO integration_events (id, integration_id, event_type, source_system, source_ref, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))').run(
    eventId, integration.id, eventType, integration.type, extractSourceRef(integration.type, req.body), JSON.stringify(req.body)
  );

  prepare('UPDATE integrations SET events_received = events_received + 1, last_sync = datetime("now") WHERE id = ?').run(integration.id);

  try {
    const processor = new EventProcessor();
    const result = processor.processEvent(eventId);
    res.json({ received: true, event_id: eventId, processed: result });
  } catch (err) {
    console.error('Event processing error:', err);
    res.json({ received: true, event_id: eventId, processed: false });
  }
});

// --- Generic Webhook (for any system) ---

router.post('/webhook/generic', express.json(), (req, res) => {
  const { source, event_type, title, description, severity, environment, reference, metadata } = req.body;

  if (!source || !event_type || !title) {
    return res.status(400).json({ error: 'source, event_type, and title required' });
  }

  const eventId = uuidv4();

  let integrationId = prepare('SELECT id FROM integrations WHERE type = "webhook" AND is_active = 1 LIMIT 1').get()?.id;

  if (!integrationId) {
    integrationId = uuidv4();
    prepare('INSERT INTO integrations (id, name, type, config) VALUES (?, ?, ?, ?)').run(
      integrationId, 'Generic Webhook', 'webhook', JSON.stringify({ auto_created: true })
    );
  }

  prepare('INSERT INTO integration_events (id, integration_id, event_type, source_system, source_ref, payload) VALUES (?, ?, ?, ?, ?, ?)').run(
    eventId, integrationId, event_type, source, reference || null, JSON.stringify(req.body)
  );

  const processor = new EventProcessor();
  const result = processor.processEvent(eventId);

  res.json({ received: true, event_id: eventId, result });
});

// --- Event History ---

router.get('/events', authenticateToken, (req, res) => {
  const { integration_id, status, limit = 100 } = req.query;

  let query = 'SELECT * FROM integration_events WHERE 1=1';
  const params = [];
  if (integration_id) { query += ' AND integration_id = ?'; params.push(integration_id); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY received_at DESC LIMIT ?';
  params.push(parseInt(limit));

  res.json(prepare(query).all(...params));
});

// --- Helpers ---

function detectEventType(integrationType, headers, body) {
  switch (integrationType) {
    case 'github':
      return headers['x-github-event'] || 'push';
    case 'gitlab':
      return headers['x-gitlab-event'] || 'push';
    case 'jenkins':
      return body.build?.phase || 'build';
    case 'sentry':
      return body.action || 'issue';
    case 'datadog':
      return body.event_type || 'alert';
    default:
      return body.event_type || 'unknown';
  }
}

function extractSourceRef(integrationType, body) {
  switch (integrationType) {
    case 'github': return body.pull_request?.html_url || body.compare || body.head_commit?.id;
    case 'gitlab': return body.object_attributes?.url || body.checkout_sha;
    case 'jenkins': return body.build?.full_url;
    case 'sentry': return body.url || body.data?.issue?.id;
    case 'datadog': return body.alert_id;
    default: return body.reference || body.id;
  }
}

module.exports = router;
