/**
 * Universal Jira REST Client — supports Cloud, Server, and Data Center.
 * Auto-detects instance type from URL.
 */
class JiraService {
  constructor(config) {
    this.baseUrl = (config.url || '').replace(/\/+$/, '');
    this.email = config.email || '';
    this.token = config.token || '';
    this.username = config.username || '';
    this.password = config.password || '';
    this.isCloud = /\.atlassian\.net/i.test(this.baseUrl);
    this.apiVersion = this.isCloud ? '3' : '2';
    this.apiBase = `${this.baseUrl}/rest/api/${this.apiVersion}`;
  }

  _getHeaders() {
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };

    if (this.isCloud) {
      const cred = Buffer.from(`${this.email}:${this.token}`).toString('base64');
      headers['Authorization'] = `Basic ${cred}`;
    } else if (this.token && !this.password) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else if (this.username && this.password) {
      const cred = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${cred}`;
    }

    return headers;
  }

  async _request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: this._getHeaders(),
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.errorMessages?.[0] || err.message || res.statusText;
      throw new Error(`Jira API ${res.status}: ${msg}`);
    }

    return res.json();
  }

  async testConnection() {
    const myself = await this._request('/myself');
    const serverInfo = await this._request(`${this.baseUrl}/rest/api/2/serverInfo`).catch(() => null);

    return {
      connected: true,
      type: this.isCloud ? 'cloud' : 'server',
      user: {
        displayName: myself.displayName,
        email: myself.emailAddress,
        accountId: myself.accountId || myself.key,
        avatarUrl: myself.avatarUrls?.['48x48'] || null,
      },
      server: serverInfo ? {
        version: serverInfo.version,
        deploymentType: serverInfo.deploymentType,
        serverTitle: serverInfo.serverTitle,
      } : null,
    };
  }

  async getProjects() {
    if (this.isCloud) {
      const data = await this._request('/project/search?maxResults=100&orderBy=name');
      return (data.values || []).map(p => ({
        id: p.id,
        key: p.key,
        name: p.name,
        avatarUrl: p.avatarUrls?.['48x48'] || null,
        projectTypeKey: p.projectTypeKey,
        style: p.style,
      }));
    }

    const projects = await this._request('/project');
    return (Array.isArray(projects) ? projects : []).map(p => ({
      id: p.id,
      key: p.key,
      name: p.name,
      avatarUrl: p.avatarUrls?.['48x48'] || null,
      projectTypeKey: p.projectTypeKey,
    }));
  }

  async getIssueTypes(projectKey) {
    try {
      const project = await this._request(`/project/${projectKey}`);
      return (project.issueTypes || []).map(t => ({
        id: t.id,
        name: t.name,
        subtask: t.subtask || false,
        iconUrl: t.iconUrl,
      }));
    } catch {
      return [
        { id: '10001', name: 'Epic', subtask: false },
        { id: '10002', name: 'Story', subtask: false },
        { id: '10003', name: 'Task', subtask: false },
        { id: '10004', name: 'Bug', subtask: false },
        { id: '10005', name: 'Sub-task', subtask: true },
      ];
    }
  }

  async searchIssues(projectKey, options = {}) {
    const parts = [`project = "${projectKey}"`];

    if (options.issueType) parts.push(`issuetype = "${options.issueType}"`);
    if (options.status) parts.push(`status = "${options.status}"`);
    if (options.sprint) parts.push(`sprint = "${options.sprint}"`);
    if (options.label) parts.push(`labels = "${options.label}"`);
    if (options.text) parts.push(`(summary ~ "${options.text}" OR description ~ "${options.text}")`);
    if (options.jql) parts.push(options.jql);

    const jql = parts.join(' AND ') + ' ORDER BY priority ASC, created DESC';
    const startAt = options.startAt || 0;
    const maxResults = Math.min(options.maxResults || 50, 100);

    const data = await this._request('/search', {
      method: 'POST',
      body: {
        jql,
        startAt,
        maxResults,
        fields: [
          'summary', 'description', 'issuetype', 'status', 'priority',
          'assignee', 'reporter', 'labels', 'created', 'updated',
          'parent', 'subtasks', 'comment', 'attachment',
          ...(this.isCloud ? ['customfield_10014'] : []),
        ],
      },
    });

    return {
      total: data.total || 0,
      startAt: data.startAt || 0,
      maxResults: data.maxResults || maxResults,
      issues: (data.issues || []).map(i => this._mapIssue(i)),
    };
  }

  async getIssue(issueKey) {
    const data = await this._request(`/issue/${issueKey}?expand=renderedFields`);
    return this._mapIssue(data, true);
  }

  _mapIssue(raw, full = false) {
    const f = raw.fields || {};
    const issue = {
      id: raw.id,
      key: raw.key,
      url: `${this.baseUrl}/browse/${raw.key}`,
      summary: f.summary || '',
      type: f.issuetype?.name || 'Unknown',
      typeIcon: f.issuetype?.iconUrl || null,
      status: f.status?.name || 'Unknown',
      statusCategory: f.status?.statusCategory?.key || 'undefined',
      priority: f.priority?.name || 'Medium',
      priorityIcon: f.priority?.iconUrl || null,
      assignee: f.assignee?.displayName || null,
      reporter: f.reporter?.displayName || null,
      labels: f.labels || [],
      created: f.created,
      updated: f.updated,
      parentKey: f.parent?.key || null,
      subtaskCount: f.subtasks?.length || 0,
      epicKey: f.customfield_10014 || f.parent?.key || null,
    };

    if (full) {
      issue.description = this._extractText(f.description);
      issue.renderedDescription = raw.renderedFields?.description || '';
      issue.acceptanceCriteria = this._extractAcceptanceCriteria(f.description, issue.description);
      issue.subtasks = (f.subtasks || []).map(s => ({
        key: s.key,
        summary: s.fields?.summary || '',
        status: s.fields?.status?.name || '',
        type: s.fields?.issuetype?.name || '',
      }));
      issue.comments = (f.comment?.comments || []).slice(-5).map(c => ({
        author: c.author?.displayName || '',
        body: this._extractText(c.body),
        created: c.created,
      }));
    }

    return issue;
  }

  _extractText(field) {
    if (!field) return '';
    if (typeof field === 'string') return field;

    if (field.type === 'doc' && field.content) {
      return this._adfToText(field.content);
    }

    return JSON.stringify(field);
  }

  _adfToText(nodes) {
    if (!Array.isArray(nodes)) return '';
    let text = '';

    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          text += node.text || '';
          break;
        case 'paragraph':
          text += this._adfToText(node.content) + '\n';
          break;
        case 'heading':
          text += '\n' + this._adfToText(node.content) + '\n';
          break;
        case 'bulletList':
        case 'orderedList':
          text += this._adfToText(node.content);
          break;
        case 'listItem':
          text += '- ' + this._adfToText(node.content);
          break;
        case 'codeBlock':
          text += '```\n' + this._adfToText(node.content) + '\n```\n';
          break;
        case 'table':
        case 'tableRow':
        case 'tableCell':
        case 'tableHeader':
          text += this._adfToText(node.content) + ' | ';
          break;
        case 'hardBreak':
          text += '\n';
          break;
        default:
          if (node.content) text += this._adfToText(node.content);
          break;
      }
    }

    return text;
  }

  _extractAcceptanceCriteria(rawField, plainText) {
    const text = plainText || '';
    const patterns = [
      /acceptance\s*criteria[:\s]*\n?([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/i,
      /קריטריונים?\s*(?:לקבלה|קבלה)[:\s]*\n?([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/i,
      /given[\s\S]*?when[\s\S]*?then/gi,
      /AC[:\s]*\n?([\s\S]*?)(?=\n\n|$)/i,
    ];

    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) return (match[1] || match[0]).trim();
    }

    return '';
  }

  formatIssueForAI(issue) {
    let content = `Issue: ${issue.key}\n`;
    content += `Type: ${issue.type}\n`;
    content += `Priority: ${issue.priority}\n`;
    content += `Summary: ${issue.summary}\n\n`;

    if (issue.description) {
      content += `Description:\n${issue.description}\n\n`;
    }

    if (issue.acceptanceCriteria) {
      content += `Acceptance Criteria:\n${issue.acceptanceCriteria}\n\n`;
    }

    if (issue.subtasks && issue.subtasks.length > 0) {
      content += `Subtasks:\n`;
      issue.subtasks.forEach(s => {
        content += `- ${s.key}: ${s.summary} (${s.status})\n`;
      });
      content += '\n';
    }

    if (issue.labels && issue.labels.length > 0) {
      content += `Labels: ${issue.labels.join(', ')}\n`;
    }

    return content;
  }

  formatMultipleIssuesForAI(issues) {
    return issues.map(i => this.formatIssueForAI(i)).join('\n---\n\n');
  }
}

module.exports = JiraService;
