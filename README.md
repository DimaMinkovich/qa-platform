# QA Platform — Enterprise Test & Bug Management with AI

A comprehensive QA management platform with AI-powered test generation, universal integration support, and smart bug management. Designed to replace and surpass Jira, TestRail, and Azure DevOps for QA teams.

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

**Default credentials:**
- `admin` / `password123` (System Admin)
- `qa_lead` / `password123` (QA Manager)
- `tester1` / `password123` (Tester)
- `developer` / `password123` (Developer)

## Features

### Test Management
- Hierarchical test suites with drag-and-drop
- Test cases with step-by-step definitions
- Test plans, runs, and result tracking
- Priority/criticality classification
- Manual, automated, and hybrid test types

### Bug Management
- Full bug lifecycle: Open → Assigned → In Progress → Fixed → Retest → Verified → Closed
- Priority (Critical/High/Medium/Low) and Severity (Blocker/Critical/Major/Minor/Trivial)
- Complete change history and audit trail
- Comments and collaboration
- Auto-created bugs from integrations

### Integration Hub
- **GitHub** — CI failure detection, issue sync
- **GitLab** — Pipeline failure monitoring
- **Jenkins** — Build failure tracking
- **Sentry** — Production error ingestion
- **Datadog** — Performance alert processing
- **Generic Webhook** — Connect any system

### AI Lab
- **Test Generation** — Create test cases from PRD, user stories, or API specs
- **Duplicate Detection** — Find similar bugs before creating duplicates
- **Root Cause Analysis** — AI-powered investigation of bug patterns
- **Risk Prediction** — Project risk assessment with recommendations

### Team & Security
- Role-based access control (Admin, QA Manager, Tester, Developer, Viewer)
- Team productivity dashboards
- Complete audit log
- JWT authentication

## API Reference

### Authentication
```
POST /api/auth/login     { username, password } → { token, user }
POST /api/auth/register  { username, email, password, full_name }
GET  /api/auth/me        → current user
GET  /api/auth/users     → all users
```

### Tests
```
GET  /api/tests/suites?project_id=...
POST /api/tests/suites   { project_id, name, parent_id, icon }
GET  /api/tests/cases?project_id=...&suite_id=...&search=...
POST /api/tests/cases    { suite_id, test_key, title, steps: [{action, expected_result}] }
GET  /api/tests/runs?project_id=...
POST /api/tests/runs     { project_id, name, environment, test_case_ids }
```

### Bugs
```
GET  /api/bugs?project_id=...&status=...&priority=...&search=...
POST /api/bugs           { project_id, title, priority, severity, steps_to_reproduce }
PUT  /api/bugs/:id       { status, priority, assigned_to, ... }
POST /api/bugs/:id/comments  { content }
GET  /api/bugs/stats?project_id=...
```

### Integrations
```
GET  /api/integrations
POST /api/integrations   { name, type, config: { api_url, api_token } }
POST /api/integrations/webhook/:id   (external webhook receiver)
POST /api/integrations/webhook/generic  { source, event_type, title, severity }
GET  /api/integrations/events
```

### AI
```
POST /api/ai/generate-tests    { project_id, source_type, source_content }
POST /api/ai/detect-duplicates { project_id, bug_title, bug_description }
POST /api/ai/root-cause        { bug_id }
POST /api/ai/risk-prediction   { project_id }
```

## Project Structure

```
qa-platform/
├── server.js              # Express app entry point
├── database.js            # SQLite database layer (20+ tables)
├── middleware/
│   ├── auth.js            # JWT authentication + RBAC
│   └── audit.js           # Automatic audit logging
├── routes/
│   ├── auth.js            # Authentication & user management
│   ├── tests.js           # Test suites, cases, runs, results
│   ├── bugs.js            # Bug CRUD, comments, history
│   ├── integrations.js    # Integration management + webhooks
│   ├── dashboard.js       # KPIs, metrics, team productivity
│   └── ai.js              # AI test generation, analysis
├── services/
│   ├── ai-service.js      # AI algorithms (heuristic + LLM)
│   └── event-processor.js # Integration event → bug/alert
├── public/
│   └── index.html         # Full SPA frontend
├── docs/
│   ├── ARCHITECTURE.md    # System architecture
│   └── ROADMAP.md         # Development roadmap
└── qa-platform.db         # SQLite database (auto-created)
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture document including data model, integration design, and scaling strategy.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the 7-phase development plan from current state to enterprise SaaS.

## License

MIT
