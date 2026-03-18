# QA Platform — Full System Specification v2.1.0
## Enterprise Test & Bug Management Platform with AI

---

# 1. OVERVIEW

Build a complete, production-ready QA and Bug Management platform as a single-page web application. The system supports manual test case management, bug lifecycle tracking, AI-powered test generation from specifications (Hebrew + English), integration with external systems (GitHub, GitLab, Jenkins, Sentry, Datadog, Jira), and a project knowledge base.

**Key principles:**
- Designed for non-technical QA teams — every action must be intuitive
- Hebrew-first AI test generation with professional QA terminology
- Everything runs as a single Node.js process with SQLite (sql.js) — zero external dependencies
- Dark theme UI, single HTML file frontend (no build step)
- JWT authentication with role-based access control

---

# 2. TECH STACK

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (v18+) |
| Backend | Express.js 4.x |
| Database | SQLite via `sql.js` (in-process, file-persisted) |
| Auth | `jsonwebtoken` (JWT, 24h expiry), `bcryptjs` (password hashing) |
| IDs | `uuid` v4 |
| File uploads | `multer` (memory storage, 10MB limit) |
| CORS | `cors` middleware |
| Frontend | Vanilla JS, single `public/index.html` file |
| Charts | Chart.js (CDN) |
| AI | Google Gemini API (pluggable, fallback to heuristic engine) |

**package.json dependencies:**
```json
{
  "express": "^4.18.2",
  "sql.js": "^1.10.0",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.2",
  "uuid": "^9.0.0",
  "cors": "^2.8.5",
  "multer": "^1.4.5-lts.1"
}
```

**npm scripts:**
- `start`: `node server.js`
- `dev`: `node --watch server.js`

---

# 3. PROJECT STRUCTURE

```
qa-platform/
├── server.js                    # Express app entry point
├── database.js                  # SQLite init, schema, seed, helpers
├── package.json
├── .gitignore                   # node_modules/, *.db, .env, .DS_Store
├── middleware/
│   ├── auth.js                  # JWT auth, role-based access
│   └── audit.js                 # Audit logging middleware
├── routes/
│   ├── auth.js                  # Login, register, user management
│   ├── tests.js                 # Suites, cases, steps, runs, results
│   ├── bugs.js                  # Bug CRUD, comments, history
│   ├── integrations.js          # External connectors, webhooks
│   ├── dashboard.js             # KPIs, team productivity
│   ├── ai.js                    # AI test generation, duplicate detection, risk
│   ├── project.js               # Documents, Git connections
│   └── jira.js                  # Jira integration
├── services/
│   ├── ai-service.js            # AI QA Architect Engine (10-stage pipeline)
│   ├── jira-service.js          # Universal Jira REST client
│   └── event-processor.js       # Integration event → bug transformer
└── public/
    └── index.html               # Entire SPA frontend (single file)
```

---

# 4. DATABASE SCHEMA

SQLite database persisted to `qa-platform.db`. Uses `sql.js` with a `prepare()` helper that mimics better-sqlite3 API (`.run()`, `.get()`, `.all()`). Database is saved to disk after every write operation.

## 4.1 Tables

### users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tester',   -- admin, qa_manager, tester, developer
  avatar_url TEXT,
  is_active INTEGER DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### teams
```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  lead_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### team_members
```sql
CREATE TABLE team_members (
  team_id TEXT,
  user_id TEXT,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);
```

### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,              -- e.g. "MON"
  description TEXT,
  status TEXT DEFAULT 'active',
  owner_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### test_suites
```sql
CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_id TEXT,                         -- hierarchical tree
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📁',
  sort_order INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### test_cases
```sql
CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  test_key TEXT NOT NULL,                -- e.g. "AUTH-001"
  title TEXT NOT NULL,
  description TEXT,
  preconditions TEXT,
  priority INTEGER DEFAULT 2,            -- 1=Critical, 2=High, 3=Medium, 4=Low
  test_type TEXT DEFAULT 'manual',       -- manual, automated, hybrid
  is_critical INTEGER DEFAULT 0,
  estimated_time_minutes INTEGER,
  tags TEXT,                             -- JSON array
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### test_steps
```sql
CREATE TABLE test_steps (
  id TEXT PRIMARY KEY,
  test_case_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  expected_result TEXT,
  test_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### test_plans
```sql
CREATE TABLE test_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  start_date TEXT,
  end_date TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### test_plan_cases
```sql
CREATE TABLE test_plan_cases (
  plan_id TEXT,
  test_case_id TEXT,
  PRIMARY KEY (plan_id, test_case_id)
);
```

### test_runs
```sql
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  environment TEXT DEFAULT 'staging',
  build_number TEXT,
  status TEXT DEFAULT 'in_progress',     -- in_progress, completed
  assigned_to TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### test_results
```sql
CREATE TABLE test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  outcome TEXT DEFAULT 'not_run',        -- not_run, passed, failed, blocked, skipped
  duration_seconds INTEGER,
  executed_by TEXT,
  executed_at TEXT,
  comment TEXT,
  attachments TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### test_step_results
```sql
CREATE TABLE test_step_results (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  outcome TEXT DEFAULT 'not_run',        -- not_run, passed, failed
  actual_result TEXT,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### bugs
```sql
CREATE TABLE bugs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  bug_key TEXT NOT NULL,                 -- e.g. "MON-BUG-001"
  title TEXT NOT NULL,
  description TEXT,
  steps_to_reproduce TEXT,
  actual_result TEXT,
  expected_result TEXT,
  status TEXT DEFAULT 'open',            -- open, assigned, in_progress, fixed, retest, closed, rejected
  priority TEXT DEFAULT 'medium',        -- critical, high, medium, low
  severity TEXT DEFAULT 'major',         -- blocker, critical, major, minor, trivial
  environment TEXT,
  browser TEXT,
  os TEXT,
  version TEXT,
  assigned_to TEXT,
  reported_by TEXT,
  test_result_id TEXT,
  source TEXT DEFAULT 'manual',          -- manual, integration, ai
  source_system TEXT,
  source_ref TEXT,
  tags TEXT,
  attachments TEXT,
  ai_duplicate_score REAL,
  ai_root_cause TEXT,
  ai_suggested_fix TEXT,
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### bug_comments
```sql
CREATE TABLE bug_comments (
  id TEXT PRIMARY KEY,
  bug_id TEXT NOT NULL,
  user_id TEXT,
  content TEXT NOT NULL,
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### bug_history
```sql
CREATE TABLE bug_history (
  id TEXT PRIMARY KEY,
  bug_id TEXT NOT NULL,
  user_id TEXT,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### integrations
```sql
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- github, gitlab, jenkins, sentry, datadog, webhook, custom_api
  config TEXT NOT NULL,                  -- JSON: { api_url, api_token, secret }
  is_active INTEGER DEFAULT 1,
  last_sync TEXT,
  events_received INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### integration_events
```sql
CREATE TABLE integration_events (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_ref TEXT,
  payload TEXT NOT NULL,                 -- JSON
  status TEXT DEFAULT 'pending',         -- pending, processed, error
  processed_as TEXT,                     -- bug, alert, ignored
  result_id TEXT,
  error_message TEXT,
  received_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);
```

### ai_generated_tests
```sql
CREATE TABLE ai_generated_tests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,             -- prd, user_story, api_spec, technical_doc, free_text, jira_issues
  source_content TEXT NOT NULL,
  generated_tests TEXT NOT NULL,         -- JSON array
  traceability_matrix TEXT,              -- JSON
  model_used TEXT,
  confidence_score REAL,
  status TEXT DEFAULT 'draft',           -- draft, imported
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### audit_log
```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,                          -- JSON
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### dashboard_metrics
```sql
CREATE TABLE dashboard_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  metric_data TEXT NOT NULL,
  calculated_at TEXT DEFAULT (datetime('now'))
);
```

### project_documents
```sql
CREATE TABLE project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'specification',  -- specification, architecture, api_doc, user_guide, requirements, release_notes, other
  content TEXT NOT NULL,
  summary TEXT,
  word_count INTEGER DEFAULT 0,
  uploaded_by TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### project_git_connections
```sql
CREATE TABLE project_git_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  repo_owner TEXT,
  repo_name TEXT,
  branch TEXT DEFAULT 'main',
  access_token TEXT,
  last_synced TEXT,
  repo_info TEXT,                        -- JSON: { description, readme, languages, structure, commits }
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### jira_connections
```sql
CREATE TABLE jira_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  jira_url TEXT NOT NULL,
  jira_type TEXT DEFAULT 'cloud',        -- cloud, server
  email TEXT,
  access_token TEXT,
  username TEXT,
  display_name TEXT,
  is_active INTEGER DEFAULT 1,
  last_synced TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## 4.2 Indexes

```sql
CREATE INDEX idx_tc_suite ON test_cases(suite_id);
CREATE INDEX idx_tr_run ON test_results(run_id);
CREATE INDEX idx_tr_case ON test_results(test_case_id);
CREATE INDEX idx_bugs_proj ON bugs(project_id);
CREATE INDEX idx_bugs_st ON bugs(status);
CREATE INDEX idx_ie_int ON integration_events(integration_id);
CREATE INDEX idx_bh_bug ON bug_history(bug_id);
CREATE INDEX idx_jc_proj ON jira_connections(project_id);
CREATE INDEX idx_pd_proj ON project_documents(project_id);
CREATE INDEX idx_pgc_proj ON project_git_connections(project_id);
```

## 4.3 Seed Data

On first run (when users table is empty), create:
- **5 users**: admin (admin role), qa_lead (qa_manager), tester1 (tester), tester2 (tester), developer (developer). All with password "password123".
- **1 team**: "QA Team Alpha" led by qa_lead, containing qa_lead + both testers.
- **1 project**: "Monitoring Platform" (key: "MON").
- **6 test suites**: Authentication (with child Login Flow), Monitoring (with child Posts Management), Dashboard & Stats (with child Main Dashboard).
- **10 test cases** across the suites, each with 2-3 steps.
- **3 bugs**: "Login button unresponsive on mobile", "Dashboard charts not loading", "Memory leak in posts list".

---

# 5. API ENDPOINTS

All endpoints return JSON. Auth-protected routes require `Authorization: Bearer <jwt>`.

## 5.1 Auth (`/api/auth`)

| Method | Path | Auth | Body / Query | Response |
|--------|------|------|-------------|----------|
| POST | `/login` | No | `{ username, password }` | `{ token, user }` |
| POST | `/register` | No | `{ username, email, password, full_name }` | `{ id, token, user }` |
| GET | `/me` | Yes | — | User object |
| GET | `/users` | Yes | — | Array of users |

## 5.2 Tests (`/api/tests`)

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| GET | `/suites?project_id=` | — | Nested suite tree |
| POST | `/suites` | `{ project_id, name, parent_id?, icon? }` | Suite object |
| DELETE | `/suites/:id` | — | `{ success }` |
| GET | `/cases?suite_id=&project_id=&search=&priority=&type=` | — | Array of cases with steps |
| POST | `/cases` | `{ suite_id, test_key, title, description?, preconditions?, priority?, test_type?, steps?[{action, expected_result}] }` | Case object |
| PUT | `/cases/:id` | Same fields (all optional), including `suite_id` | Case object |
| DELETE | `/cases/:id` | — | `{ success }` |
| POST | `/cases/:id/clone` | — | Cloned case |
| GET | `/runs?project_id=` | — | Runs with result counts |
| POST | `/runs` | `{ project_id, name, environment?, build_number?, test_case_ids[] }` | Run object |
| GET | `/runs/active-check/:test_case_id` | — | `{ in_active_run, run_name? }` |
| POST | `/runs/:id/add` | `{ test_case_ids[] }` | `{ added }` |
| GET | `/results/:run_id` | — | Results with case details and step results |
| PUT | `/results/:id` | `{ outcome?, comment?, duration_seconds?, step_results?[{step_id, outcome, actual_result}] }` | Result object |
| GET | `/projects` | — | Projects with counts |
| POST | `/projects` | `{ name, key, description? }` | Project object |

### Test Run Logic
- Creating a run with `test_case_ids` automatically creates `test_results` for each (outcome: not_run).
- When updating a result, if `step_results` are provided, upsert into `test_step_results`. If any step is `failed`, auto-set the overall result to `failed`.
- When all results in a run are not `not_run`, set run status to `completed`.

## 5.3 Bugs (`/api/bugs`)

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| GET | `/?project_id=&status=&priority=&severity=&assigned_to=&search=&source=&page=&limit=` | — | `{ bugs, total, page, totalPages }` |
| GET | `/stats?project_id=` | — | `{ byStatus, byPriority, bySeverity, bySource, recentTrend[] }` |
| GET | `/:id` | — | Bug with comments and history |
| POST | `/` | `{ project_id, title, description?, steps_to_reproduce?, actual_result?, expected_result?, priority?, severity?, environment?, assigned_to?, test_result_id?, source? }` | Bug (auto-generates bug_key) |
| PUT | `/:id` | Any fields | Updated bug (records changes in bug_history) |
| POST | `/:id/comments` | `{ content }` | Comment object |

### Bug Key Generation
Auto-generated as `{PROJECT_KEY}-BUG-{NNN}` where NNN is sequential.

### Bug History
Every `PUT` compares old vs new values and records each changed field in `bug_history`.

## 5.4 Integrations (`/api/integrations`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/` | Yes | — | All integrations |
| POST | `/` | Yes | `{ name, type, config: { api_url?, api_token?, secret? } }` | Integration |
| PUT | `/:id` | Yes | Same fields | Updated integration |
| DELETE | `/:id` | Yes | — | `{ success }` |
| POST | `/webhook/:integration_id` | No | Any JSON payload | `{ received, event_id, processed? }` |
| POST | `/webhook/generic` | No | `{ source, event_type, ...payload }` | `{ received, event_id }` |
| GET | `/events` | Yes | — | Integration events |

### Webhook Processing
When a webhook is received: store in `integration_events`, then run through `EventProcessor` which transforms events from GitHub/GitLab/Jenkins/Sentry/Datadog into bugs automatically.

## 5.5 Dashboard (`/api/dashboard`)

| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/overview?project_id=` | — | `{ kpis, latestRun, bugs, suiteProgress[], integrations }` |
| GET | `/team-productivity?project_id=` | — | Array of user stats |
| GET | `/audit-log?project_id=&limit=` | — | Audit log entries |

## 5.6 AI (`/api/ai`)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/status` | — | `{ provider, model, language, connected }` |
| POST | `/generate-tests` | `{ project_id, source_type, source_content, options?, preview? }` | `{ tests[], specAnalysis, modules[], missingRequirements[], traceabilityMatrix[], summary, model, confidence }` |
| POST | `/detect-duplicates` | `{ project_id, bug_title, bug_description? }` | `{ duplicates[] }` |
| POST | `/root-cause` | `{ bug_id }` | `{ rootCause, suggestedFix, confidence, relatedBugIds[] }` |
| POST | `/risk-prediction` | `{ project_id }` | `{ overallRiskLevel, highRiskAreas[], metrics, recommendations[] }` |
| GET | `/generated?project_id=` | — | Previously generated test sets |
| POST | `/import-generated/:id` | `{ suite_id }` | `{ imported, total }` |

### Project Context Integration
The `/generate-tests` endpoint automatically fetches all active `project_documents` and `project_git_connections` for the project, combines them into a context block, and injects into the AI prompt.

## 5.7 Project (`/api/project`)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/documents?project_id=` | — | Active documents |
| GET | `/documents/:id` | — | Single document |
| POST | `/documents/text` | `{ project_id, name, doc_type, content }` | Document |
| POST | `/documents/upload` | FormData: `file`, query: `project_id` | Document |
| PUT | `/documents/:id` | `{ name?, doc_type?, content? }` | Updated document |
| DELETE | `/documents/:id` | — | Soft delete (is_active=0) |
| GET | `/context?project_id=` | — | `{ has_context, document_count, git_connected, total_words, context }` |
| GET | `/git?project_id=` | — | Git connections |
| POST | `/git/connect` | `{ project_id, repo_url, branch?, access_token? }` | Connection with repo info |
| POST | `/git/:id/sync` | — | Re-synced connection |
| DELETE | `/git/:id` | — | Soft delete |

### Git Connection
Parses repo URL to detect GitHub/GitLab, fetches: description, README, recent commits, file structure, languages. Stores as JSON in `repo_info`.

## 5.8 Jira (`/api/jira`)

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| POST | `/test-connection` | `{ url, email?, token?, username?, password? }` | `{ connected, type, user, server }` |
| GET | `/connections?project_id=` | — | Active connections |
| POST | `/connect` | `{ project_id, url, email?, token?, username? }` | Connection info |
| DELETE | `/connections/:id` | — | Soft delete |
| GET | `/projects?connection_id=` | — | Jira projects |
| GET | `/issue-types?connection_id=&project_key=` | — | Issue types |
| POST | `/search` | `{ connection_id, project_key, issueType?, status?, text?, jql?, startAt?, maxResults? }` | `{ total, issues[] }` |
| GET | `/issue/:key?connection_id=` | — | Full issue with description, AC, subtasks, comments |
| POST | `/generate-tests` | `{ connection_id, project_id, issue_keys[], preview? }` | Generated tests (same format as AI generate) |

### Jira Client
- Auto-detects Cloud (`.atlassian.net`) vs Server/Data Center from URL
- Cloud auth: Basic (email:api_token)
- Server auth: Bearer (PAT) or Basic (username:password)
- API v3 for Cloud, v2 for Server
- Converts Atlassian Document Format (ADF) to plain text
- Extracts Acceptance Criteria from descriptions

---

# 6. AI QA ARCHITECT ENGINE

## 6.1 Architecture

The AI service has a pluggable provider model:
1. **Gemini** (primary): Uses Google Gemini API (model: `gemini-2.0-flash`)
2. **Heuristic** (fallback): Built-in 10-stage QA Architect pipeline

Provider is selected based on environment variables:
- `GEMINI_API_KEY` → uses Gemini
- `OPENAI_API_KEY` → uses OpenAI
- Neither → uses heuristic engine

## 6.2 Test Generation — 10-Stage Pipeline

When generating tests, the engine processes the input through 10 stages:

1. **Spec Analysis**: Extract features, functional requirements, non-functional requirements, user flows, integrations, risk points
2. **Module Decomposition**: Break system into logical modules
3. **Test Scenarios**: Create high-level scenarios per module
4. **Detailed Test Cases**: Full manual test cases with step-by-step instructions
5. **Negative Testing**: Invalid data, empty fields, unauthorized access
6. **Edge Cases**: Boundary values, dates, data volume
7. **UX Testing**: Error messages, navigation, UI consistency
8. **Data Testing**: CRUD operations, data integrity
9. **Spec Gap Analysis**: Missing requirements, impact, recommendations
10. **Coverage Matrix**: Requirement-to-test-case traceability

### Output Format
```json
{
  "specAnalysis": { "features": [], "functionalReqs": [], "nonFunctionalReqs": [], "userFlows": [], "integrations": [], "riskPoints": [] },
  "modules": [{ "name": "", "description": "" }],
  "tests": [{
    "test_key": "TC-001",
    "module": "",
    "title": "",
    "description": "",
    "preconditions": "",
    "assigned_role": "tester|senior_tester|qa_lead",
    "priority": 1,
    "severity": "critical|major|minor",
    "type": "manual",
    "category": "functional|negative|edge_case|ux|data|security",
    "steps": [{ "step": 1, "action": "", "expected_result": "" }],
    "test_data": ""
  }],
  "missingRequirements": [{ "requirement": "", "impact": "", "recommendation": "" }],
  "traceabilityMatrix": [{ "requirement": "", "testCases": ["TC-001"] }],
  "summary": { "totalTests": 0, "byCategory": {}, "byPriority": {} }
}
```

### Assigned Roles
Each test case gets an `assigned_role`:
- `qa_lead`: Architectural tests, integration, security, coverage review
- `senior_tester`: Complex negative tests, performance, E2E, edge cases
- `tester`: Standard functional, basic UX, positive flows

### Hebrew Detection
If input contains >5 Hebrew characters, all output is generated in professional Hebrew.

### Gemini Prompt
The Gemini prompt instructs the AI to act as a senior QA Architect with 15+ years experience, covering all 10 stages, outputting structured JSON with Hebrew or English based on input language. Temperature: 0.4, max tokens: 8192, response MIME: `application/json`.

### Project Context
When available, project documents and Git repo info are prepended to the prompt as a "PROJECT KNOWLEDGE BASE" block (truncated to 4000 chars).

## 6.3 Duplicate Bug Detection

Uses Jaccard similarity on tokenized titles/descriptions. With Gemini: sends existing bug list and new bug for AI comparison with similarity scores. Threshold: 0.25 for heuristic, 0.3 for Gemini.

## 6.4 Root Cause Analysis

Heuristic: pattern matching on environment clusters, similar component areas, severity distribution. Gemini: full analysis prompt returning rootCause, suggestedFix, confidence, relatedPatterns.

## 6.5 Risk Prediction

Calculates: recent bug rate (7 days), critical open bugs, suite failure rates. Risk levels: low/medium/high/critical. Gemini enhances with natural language analysis and recommendations.

---

# 7. EVENT PROCESSOR

Transforms external system events into bugs:

| Source | Trigger | Creates Bug |
|--------|---------|-------------|
| GitHub | `check_run` failure | CI Failure bug |
| GitHub | `issues` opened | GitHub issue as bug |
| GitLab | Pipeline failed | Pipeline failure bug |
| Jenkins | Build FAILURE | Build failure bug |
| Sentry | Issue created | Error/crash bug |
| Datadog | Alert triggered | Performance alert bug |
| Generic webhook | `severity: error/critical` | External error bug |

Each bug is auto-tagged with `source: 'integration'`, source_system, and source_ref.

---

# 8. JIRA SERVICE

Universal Jira REST client supporting:

- **Cloud**: `https://org.atlassian.net` — API v3, Basic Auth (email:token)
- **Server/Data Center**: any other URL — API v2, Bearer Token (PAT)

### Features
- Auto-detect instance type from URL
- `testConnection()`: validates credentials, returns user info and server details
- `getProjects()`: lists all projects (Cloud uses `/project/search`, Server uses `/project`)
- `getIssueTypes(projectKey)`: returns issue types with fallback defaults
- `searchIssues()`: JQL-based search with filters (type, status, text, labels, sprint)
- `getIssue()`: full issue with rendered description, acceptance criteria, subtasks, last 5 comments
- ADF (Atlassian Document Format) to plain text converter
- Acceptance criteria extraction (English + Hebrew patterns, Given/When/Then)
- `formatIssueForAI()`: structures issue content for AI prompt consumption

---

# 9. FRONTEND (Single Page Application)

## 9.1 General Design

- **Theme**: Dark theme with CSS custom properties
- **Layout**: Top navigation bar, left sidebar (test suite tree), main content area
- **Routing**: JavaScript-based page switching (`switchPage()`)
- **State**: In-memory variables (`allSuites`, `allTests`, `projectId`, etc.)
- **API calls**: `api()` helper function that adds JWT token to all requests
- **Notifications**: Toast system (success/error/warning/info)
- **Charts**: Chart.js loaded from CDN

## 9.2 Pages

### Login Screen
Username + password form. Demo credentials shown. On success: stores JWT in localStorage, loads app.

### Dashboard
- KPI cards: total tests, pass rate, open bugs, critical bugs
- Charts: bug status pie, bug priority bar, test execution trend
- Recent bugs list
- Integration events

### Tests (2 tabs)
**Test Cases tab:**
- Left sidebar: hierarchical suite tree with icons
- Toolbar: search, priority filter, type filter, New Test Case, New Run, Export CSV
- Table: key, title, priority badge, type, steps count, actions (edit, clone, delete, add-to-run)
- Detail panel: full test case with steps table, edit/clone/delete/export/add-to-run buttons

**Test Runs tab:**
- List of runs with status, progress bar, environment, date
- Run detail: each test result with step-level pass/fail dropdowns
- Per-step status tracking (pass/fail/not_run)
- Auto-fail test when any step fails
- "File Bug" button on failed steps (opens bug modal pre-filled)
- Validation: cannot re-run if incomplete tests exist

### Bugs
- Toolbar: search, status/priority/severity filters, Report Bug button
- Table: key, title, status badge, priority, severity, assignee, source, date
- Detail panel: full bug info, comments, history timeline, AI analysis
- Edit inline, add comments

### Integrations (2 tabs)
- Connectors: card grid showing connected systems, status, event counts
- Event Feed: table of all received events with status, processing result
- Add Integration modal: name, type (github/gitlab/jenkins/sentry/datadog/webhook), URL, token

### AI Lab
- Status banner showing AI provider (Gemini/Heuristic) and project knowledge status
- **Generate Tests**: source type dropdown, textarea for spec, Generate button
- Results display: 10-stage analysis, test list with checkboxes, expand for steps
- Select All / Deselect All, Import to Suite modal
- **Duplicate Detection**: bug title + description input, Check button
- **Risk Prediction**: one-click analysis

### Project
- Banner explaining knowledge base concept (3 steps: upload doc → go to AI Lab → AI uses context)
- **System Documents** (primary): paste text or upload file (.txt, .md, .json, .csv, .html, .xml), document name, type selector, word count. Active documents list with view/delete.
- **Git Repository** (optional): URL, branch, access token. Shows repo info after connection.
- **Jira Integration**: Cloud/Server tabs, connection form, project picker, issue search with filters, issue list with checkboxes, Generate Tests button, inline results display with checkboxes and steps, direct Import to Suite with optional Test Run creation.

### Team
- KPI cards per tester
- Table: name, role, tests executed, passed, failed, bugs reported, open assigned

## 9.3 Modals

1. **Report New Bug**: title, priority, severity, steps to reproduce, actual/expected result, environment, assign to
2. **New Test Case**: test key, suite, title, description, priority, type, dynamic steps editor
3. **Edit Test Case**: all fields editable, dynamic steps (add/remove/reorder)
4. **New Test Suite**: name, parent suite, icon
5. **New Test Run**: name, environment, build number
6. **Add Integration**: name, type, API URL, API token
7. **Import Tests to Suite**: new suite name or existing suite dropdown, optional test run name
8. **Add Test to Run**: new run or existing run

## 9.4 Key Frontend Behaviors

- **Checkboxes**: Custom div-based checkboxes with `data-checked` attribute (not native HTML checkboxes) to ensure reliable visual state
- **Test Import from AI Lab**: select tests → choose/create suite → import creates test_cases and test_steps via API
- **Test Import from Jira**: same flow but directly in Project page, no navigation needed
- **Test Run Execution**: dropdown per test result (pass/fail/blocked/skipped), step-level tracking, auto-complete run when all done
- **Bug from Failed Step**: pre-fills bug title, description, steps from the failed step context
- **Suite tree**: hierarchical with parent-child, expandable, click to filter tests
- **Auto-refresh**: after import/create operations, relevant lists are reloaded

---

# 10. AUTHENTICATION & AUTHORIZATION

- JWT tokens with 24h expiry
- Stored in `localStorage` as `qa_token`
- Roles: `admin`, `qa_manager`, `tester`, `developer`
- `authenticateToken` middleware on all routes except `/api/auth/login`, `/api/auth/register`, webhooks
- `requireRole(...roles)` for role-restricted endpoints
- `optionalAuth` for endpoints that work with or without auth

---

# 11. MIDDLEWARE

### Auth (`middleware/auth.js`)
- `generateToken(user)`: creates JWT with `{ id, username, role }`, 24h expiry, secret from `process.env.JWT_SECRET` or default
- `authenticateToken`: verifies Bearer token, sets `req.user`
- `requireRole`: checks `req.user.role` against allowed roles
- `optionalAuth`: non-blocking auth check

### Audit (`middleware/audit.js`)
- `auditLog(action, entityType)`: intercepts `res.json()`, logs successful operations to `audit_log` table with user, action, entity, request details, IP

---

# 12. CONFIGURATION

Environment variables:
- `PORT`: Server port (default: 3000)
- `JWT_SECRET`: JWT signing secret (default: hardcoded fallback)
- `GEMINI_API_KEY`: Google Gemini API key (enables AI)
- `GEMINI_MODEL`: Gemini model name (default: `gemini-2.0-flash`)
- `OPENAI_API_KEY`: OpenAI API key (alternative AI)
- `AI_LANGUAGE`: Default AI output language (default: `he`)

---

# 13. CRITICAL BUSINESS RULES

1. **Bug key generation**: `{PROJECT_KEY}-BUG-{sequential_number}` — auto-generated on creation
2. **Test key**: provided by user or auto-generated as `AI-001`, `AI-002`, etc. for AI-imported tests
3. **Suite deletion**: does NOT cascade delete test cases — cases become orphaned
4. **Bug history**: every field change on update is recorded with old/new values
5. **Test run completion**: automatically set to `completed` when all results are not `not_run`
6. **Step-level failure**: if ANY step in a test is marked `failed`, the entire test result is auto-set to `failed`
7. **Active run validation**: before adding a test to a new run, check if it's already in an `in_progress` run
8. **Duplicate suite prevention**: when importing AI-generated tests, check if suite with same name exists before creating new one
9. **Soft delete**: documents, git connections, and jira connections use `is_active=0` instead of actual deletion
10. **Project context in AI**: all active project documents + git README are automatically included in every AI generation request

---

# 14. END-TO-END FLOWS

## Flow 1: Spec → Tests → Run
1. User goes to AI Lab
2. Pastes specification text (Hebrew or English)
3. Clicks Generate → AI creates test cases
4. User selects tests with checkboxes
5. Clicks Import → chooses/creates suite
6. Tests appear in Tests tab
7. User creates Test Run → executes step by step

## Flow 2: Jira → Tests → Run
1. User goes to Project tab → Jira section
2. Connects to Jira (Cloud or Server)
3. Selects project, filters issues
4. Selects User Stories/Epics/Tasks
5. Clicks Generate → AI creates tests from issue content
6. Tests displayed inline with checkboxes and steps
7. User enters suite name → clicks Import
8. Optionally creates Test Run simultaneously
9. Auto-navigates to Tests tab

## Flow 3: External Event → Bug
1. External system sends webhook to `/api/integrations/webhook/:id`
2. Event stored in `integration_events`
3. EventProcessor transforms to bug (if error/failure)
4. Bug appears in Bugs tab with source tag

## Flow 4: Document → AI Context
1. User goes to Project tab
2. Uploads system document (paste or file)
3. Document saved as active knowledge base
4. When generating tests (from AI Lab or Jira), document content is automatically injected into AI prompt

---

# 15. UI/UX GUIDELINES

- Dark theme: dark backgrounds (#0d1117, #161b22, #21262d), light text (#e6edf3), accent blue (#1f6feb)
- All interactive elements have hover states and transitions
- Toast notifications for all actions (auto-dismiss after 4s)
- Hebrew text support: `dir="auto"` on all text inputs/displays
- Loading states: spinner shown during async operations
- Buttons disabled during operations to prevent double-clicks
- Confirmation dialogs for destructive actions (delete)
- Responsive layout with flex/grid
- Charts: doughnut for status distribution, bar for priorities
- Empty states: friendly messages (not blank screens)
- Workflow guides: step-by-step instructions for complex flows
