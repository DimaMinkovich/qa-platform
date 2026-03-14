# QA Platform — Architecture Document

## System Overview

Enterprise-grade QA & Bug Management Platform with AI capabilities and universal integration support. Designed to replace and surpass Jira, TestRail, and Azure DevOps for QA workflows.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Web SPA    │  │  Mobile PWA  │  │  CLI / API Consumers   │ │
│  │  (Browser)  │  │  (Future)    │  │  (CI/CD Pipelines)     │ │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬────────────┘ │
└─────────┼────────────────┼──────────────────────┼──────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API GATEWAY                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express.js  │  JWT Auth  │  Rate Limiting  │  CORS      │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│  CORE APIs   │  │  AI SERVICE  │  │  INTEGRATION ENGINE      │
│              │  │              │  │                          │
│ /tests/*     │  │ /ai/generate │  │ /integrations/webhook/*  │
│ /bugs/*      │  │ /ai/detect   │  │                          │
│ /dashboard/* │  │ /ai/risk     │  │ Event Processor          │
│ /auth/*      │  │ /ai/root-    │  │ ┌────────────────────┐   │
│ /teams/*     │  │   cause      │  │ │ GitHub Connector   │   │
│              │  │              │  │ │ GitLab Connector   │   │
│ RBAC Layer   │  │ LLM Adapter  │  │ │ Jenkins Connector  │   │
│ Audit Log    │  │ Heuristic    │  │ │ Sentry Connector   │   │
│              │  │   Fallback   │  │ │ Datadog Connector  │   │
└──────┬───────┘  └──────┬───────┘  │ │ Generic Webhook    │   │
       │                 │          │ └────────────────────┘   │
       ▼                 ▼          └────────────┬─────────────┘
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────────┐   │
│  │  SQLite   │  │  File Store  │  │  Event Queue (Future)   │   │
│  │  (→ PG)   │  │  Attachments │  │  Redis / RabbitMQ       │   │
│  └──────────┘  └──────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Model

### Core Entities

```
Users (1) ──── (N) Team Members (N) ──── (1) Teams
  │
  ├── creates → Projects
  ├── creates → Test Cases
  ├── reports → Bugs
  ├── executes → Test Results
  └── manages → Integrations

Projects (1) ──── (N) Test Suites (hierarchical, self-referencing)
  │                        │
  │                        └── (N) Test Cases ──── (N) Test Steps
  │
  ├── (N) Test Plans ──── (N) Test Plan Cases
  │
  ├── (N) Test Runs ──── (N) Test Results ──── (N) Step Results
  │
  ├── (N) Bugs ──── (N) Bug Comments
  │            └──── (N) Bug History
  │
  └── (N) AI Generated Tests

Integrations (1) ──── (N) Integration Events
```

### Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| users | Authentication & team members | id, username, role, full_name |
| projects | Project/product containers | id, name, key, owner_id |
| test_suites | Hierarchical test organization | id, parent_id, project_id, name |
| test_cases | Individual test definitions | id, suite_id, test_key, title, priority |
| test_steps | Step-by-step test instructions | id, test_case_id, step_number, action |
| test_runs | Test execution sessions | id, project_id, name, environment |
| test_results | Per-case per-run results | id, run_id, test_case_id, outcome |
| bugs | Bug reports (full lifecycle) | id, bug_key, title, status, priority, severity, source |
| bug_history | Complete change audit trail | id, bug_id, field_name, old_value, new_value |
| integrations | External system connections | id, name, type, config, webhook_secret |
| integration_events | Ingested external events | id, event_type, payload, processed_as |
| ai_generated_tests | AI-created test cases | id, source_content, generated_tests |
| audit_log | System-wide activity log | id, user_id, action, entity_type |

## Integration Architecture

### Event Ingestion Pipeline

```
External System ──webhook──→ Webhook Receiver ──→ Event Storage
                                                       │
                                                       ▼
                                                 Event Processor
                                                       │
                              ┌─────────────────┬──────┴──────┬────────────┐
                              ▼                 ▼              ▼            ▼
                         Create Bug      Create Alert     Log Event    Ignore
```

### Supported Connectors

| System | Events Processed | Auto-Created Artifacts |
|--------|-----------------|----------------------|
| GitHub | check_run failure, issues opened | Bugs from CI failures |
| GitLab | Pipeline Hook failed | Bugs from pipeline failures |
| Jenkins | Build FAILURE | Bugs from build failures |
| Sentry | Issue created, error | Bugs from production errors |
| Datadog | Alert triggered | Bugs from performance alerts |
| Generic Webhook | Any structured event | Bugs based on severity |

### Webhook Format (Generic)

```json
POST /api/integrations/webhook/generic
{
  "source": "my-monitoring",
  "event_type": "error",
  "title": "Database connection timeout",
  "description": "Connection pool exhausted after 5000ms",
  "severity": "critical",
  "environment": "production",
  "reference": "https://monitoring.example.com/alert/123"
}
```

## AI Capabilities

### 1. Test Generation from Requirements
- Input: PRD, User Stories, API Specs, Free Text
- Output: Test cases with steps, edge cases, negative tests
- Includes: Traceability matrix linking requirements to tests

### 2. Duplicate Bug Detection
- Algorithm: Jaccard similarity on tokenized title + description
- Returns: Top 5 similar bugs with confidence scores
- Future: Embeddings-based semantic similarity

### 3. Root Cause Analysis
- Analyzes: Environment patterns, component clustering, severity distribution
- Output: Potential root causes, suggested fixes, related bugs
- Future: LLM-powered deep analysis

### 4. Risk Prediction
- Metrics: Recent bug rate, critical open bugs, failure rates per suite
- Output: Overall risk level, high-risk areas, actionable recommendations

## Security Architecture

### RBAC Roles

| Role | Permissions |
|------|-------------|
| admin | Full system access, user management |
| qa_manager | Create/manage tests, bugs, runs, view all reports |
| tester | Execute tests, report bugs, view assigned items |
| developer | View bugs assigned, update bug status |
| viewer | Read-only access to all data |

### Security Measures
- JWT-based authentication (24h expiry)
- Password hashing (bcrypt, 10 rounds)
- Webhook secrets for integration auth
- Complete audit trail for all mutations
- Role-based API endpoint protection

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js | Fast, event-driven, rich ecosystem |
| Framework | Express.js | Mature, flexible, well-documented |
| Database | SQLite (→ PostgreSQL) | Zero-config start, easy migration |
| Auth | JWT + bcrypt | Stateless, scalable |
| AI | Heuristic + LLM adapter | Works without API key, upgradeable |
| Frontend | Vanilla JS SPA | Zero dependencies, fast, portable |
| Charts | Chart.js | Lightweight, beautiful, responsive |

## Scaling Strategy

### Phase 1: Current (SQLite)
- Single server, up to ~50 users
- File-based database, simple deployment

### Phase 2: PostgreSQL + Redis
- Replace SQLite with PostgreSQL for concurrent writes
- Add Redis for caching and session management
- Support ~500 users

### Phase 3: Microservices
- Split into: Auth Service, Test Service, Bug Service, Integration Service, AI Service
- Add message queue (RabbitMQ/Kafka) for event processing
- Container orchestration (Kubernetes)
- Support ~5000+ users

### Phase 4: Enterprise
- Multi-tenant architecture
- Horizontal auto-scaling
- CDN for static assets
- Read replicas for analytics
- Support ~50,000+ users
