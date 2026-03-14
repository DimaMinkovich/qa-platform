const { prepare } = require('../database');
const { v4: uuidv4 } = require('uuid');

/**
 * Event Processor — transforms integration events into bugs, test failures, or alerts.
 * Acts as the central ingestion pipeline for all external system events.
 */
class EventProcessor {
  constructor() {
    this.processors = {
      github: this._processGitHub.bind(this),
      gitlab: this._processGitLab.bind(this),
      jenkins: this._processJenkins.bind(this),
      sentry: this._processSentry.bind(this),
      datadog: this._processDatadog.bind(this),
      webhook: this._processGenericWebhook.bind(this),
      custom_api: this._processGenericWebhook.bind(this),
    };
  }

  processEvent(eventId) {
    const event = prepare(`
      SELECT ie.*, i.type as integration_type, i.config
      FROM integration_events ie
      JOIN integrations i ON ie.integration_id = i.id
      WHERE ie.id = ?
    `).get(eventId);

    if (!event) return { success: false, error: 'Event not found' };

    const payload = JSON.parse(event.payload);
    const config = JSON.parse(event.config);
    const processor = this.processors[event.integration_type];

    if (!processor) {
      prepare("UPDATE integration_events SET status = 'error', error_message = 'Unknown integration type', processed_at = datetime('now') WHERE id = ?").run(eventId);
      return { success: false, error: 'Unknown integration type' };
    }

    try {
      const result = processor(event, payload, config);

      prepare("UPDATE integration_events SET status = 'processed', processed_as = ?, result_id = ?, processed_at = datetime('now') WHERE id = ?").run(
        result.type, result.id || null, eventId
      );

      return { success: true, ...result };
    } catch (err) {
      prepare("UPDATE integration_events SET status = 'error', error_message = ?, processed_at = datetime('now') WHERE id = ?").run(err.message, eventId);
      return { success: false, error: err.message };
    }
  }

  _processGitHub(event, payload, config) {
    if (event.event_type === 'push' && payload.commits) {
      return { type: 'ignored', message: 'Push event logged' };
    }

    if (event.event_type === 'pull_request') {
      return { type: 'ignored', message: `PR ${payload.action}: ${payload.pull_request?.title}` };
    }

    if (event.event_type === 'check_run' && payload.check_run?.conclusion === 'failure') {
      return this._createBugFromEvent(event, {
        title: `CI Failure: ${payload.check_run.name}`,
        description: `GitHub Actions check "${payload.check_run.name}" failed.\n\nRepo: ${payload.repository?.full_name}\nBranch: ${payload.check_run.head_branch}\nDetails: ${payload.check_run.html_url}`,
        priority: 'high',
        severity: 'major',
        environment: 'CI/CD',
      });
    }

    if (event.event_type === 'issues' && payload.action === 'opened') {
      return this._createBugFromEvent(event, {
        title: `[GitHub] ${payload.issue.title}`,
        description: payload.issue.body || '',
        priority: payload.issue.labels?.some(l => l.name === 'critical') ? 'critical' : 'medium',
        severity: 'major',
      });
    }

    return { type: 'ignored', message: `GitHub event ${event.event_type} logged` };
  }

  _processGitLab(event, payload, config) {
    if (event.event_type === 'Pipeline Hook' && payload.object_attributes?.status === 'failed') {
      return this._createBugFromEvent(event, {
        title: `Pipeline Failed: ${payload.project?.name}`,
        description: `GitLab pipeline #${payload.object_attributes.id} failed.\nRef: ${payload.object_attributes.ref}\nURL: ${payload.object_attributes.url}`,
        priority: 'high',
        severity: 'major',
        environment: 'CI/CD',
      });
    }
    return { type: 'ignored', message: `GitLab event logged` };
  }

  _processJenkins(event, payload, config) {
    if (payload.build?.status === 'FAILURE' || payload.build?.phase === 'COMPLETED' && payload.build?.status === 'FAILURE') {
      return this._createBugFromEvent(event, {
        title: `Build Failed: ${payload.name || payload.build?.full_url}`,
        description: `Jenkins build failed.\nJob: ${payload.name}\nBuild: #${payload.build?.number}\nURL: ${payload.build?.full_url}`,
        priority: 'high',
        severity: 'critical',
        environment: 'CI/CD',
      });
    }
    return { type: 'ignored', message: 'Jenkins event logged' };
  }

  _processSentry(event, payload, config) {
    if (payload.action === 'created' || payload.data?.issue) {
      const issue = payload.data?.issue || payload;
      return this._createBugFromEvent(event, {
        title: `[Sentry] ${issue.title || issue.message || 'Error detected'}`,
        description: `Error captured by Sentry:\n\n${issue.culprit || ''}\n\nLevel: ${issue.level || 'error'}\nFirst seen: ${issue.firstSeen || ''}\nEvents: ${issue.count || 1}\nUsers affected: ${issue.userCount || 'unknown'}\n\nURL: ${issue.url || payload.url || ''}`,
        priority: issue.level === 'fatal' ? 'critical' : issue.level === 'error' ? 'high' : 'medium',
        severity: issue.level === 'fatal' ? 'blocker' : 'critical',
        environment: 'Production',
      });
    }
    return { type: 'ignored', message: 'Sentry event logged' };
  }

  _processDatadog(event, payload, config) {
    if (payload.alert_type === 'error' || payload.event_type === 'alert') {
      return this._createBugFromEvent(event, {
        title: `[Datadog Alert] ${payload.title || 'Performance alert'}`,
        description: `Datadog alert triggered:\n\n${payload.body || payload.text || ''}\n\nAlert ID: ${payload.alert_id || ''}\nPriority: ${payload.priority || 'normal'}`,
        priority: payload.priority === 'P1' ? 'critical' : payload.priority === 'P2' ? 'high' : 'medium',
        severity: 'major',
        environment: 'Production',
      });
    }
    return { type: 'ignored', message: 'Datadog event logged' };
  }

  _processGenericWebhook(event, payload, config) {
    if (payload.severity === 'error' || payload.severity === 'critical' || payload.event_type === 'error' || payload.event_type === 'crash') {
      return this._createBugFromEvent(event, {
        title: payload.title || `[${payload.source || 'External'}] ${payload.event_type || 'Error'}`,
        description: payload.description || JSON.stringify(payload, null, 2),
        priority: payload.severity === 'critical' ? 'critical' : payload.severity === 'error' ? 'high' : 'medium',
        severity: payload.severity === 'critical' ? 'blocker' : 'major',
        environment: payload.environment || 'Unknown',
      });
    }
    return { type: 'ignored', message: 'Webhook event logged' };
  }

  _createBugFromEvent(event, bugData) {
    const project = prepare('SELECT id, key FROM projects LIMIT 1').get();
    if (!project) return { type: 'alert', message: 'No project configured' };

    const bugCount = prepare('SELECT COUNT(*) as count FROM bugs WHERE project_id = ?').get(project.id).count;
    const bugKey = `${project.key}-${String(bugCount + 1).padStart(3, '0')}`;
    const bugId = uuidv4();

    prepare(`INSERT INTO bugs (id, project_id, bug_key, title, description, status, priority, severity, environment, source, source_system, source_ref) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 'integration', ?, ?)`).run(
      bugId, project.id, bugKey, bugData.title, bugData.description,
      bugData.priority || 'medium', bugData.severity || 'major', bugData.environment || null,
      event.source_system, event.source_ref
    );

    prepare('INSERT INTO bug_history (id, bug_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)').run(
      uuidv4(), bugId, 'system', 'status', null, 'open'
    );

    return { type: 'bug', id: bugId, bug_key: bugKey, message: `Bug created: ${bugKey} - ${bugData.title}` };
  }
}

module.exports = EventProcessor;
