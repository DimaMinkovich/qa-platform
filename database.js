const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'qa-platform.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper to mimic better-sqlite3 API
function prepare(sql) {
  return {
    run(...params) { db.run(sql, params); saveDb(); },
    get(...params) { const stmt = db.prepare(sql); stmt.bind(params); if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; } stmt.free(); return undefined; },
    all(...params) { const results = []; const stmt = db.prepare(sql); stmt.bind(params); while (stmt.step()) results.push(stmt.getAsObject()); stmt.free(); return results; }
  };
}

async function initializeDatabase() {
  const database = await getDb();

  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tester', avatar_url TEXT, is_active INTEGER DEFAULT 1,
      last_login TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, lead_id TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS team_members (team_id TEXT, user_id TEXT, joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (team_id, user_id))`);
  database.run(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT UNIQUE NOT NULL, description TEXT, status TEXT DEFAULT 'active', owner_id TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_suites (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, description TEXT, icon TEXT DEFAULT '📁', sort_order INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_cases (id TEXT PRIMARY KEY, suite_id TEXT NOT NULL, test_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT, preconditions TEXT, priority INTEGER DEFAULT 2, test_type TEXT DEFAULT 'manual', is_critical INTEGER DEFAULT 0, estimated_time_minutes INTEGER, tags TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_steps (id TEXT PRIMARY KEY, test_case_id TEXT NOT NULL, step_number INTEGER NOT NULL, action TEXT NOT NULL, expected_result TEXT, test_data TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'draft', start_date TEXT, end_date TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_plan_cases (plan_id TEXT, test_case_id TEXT, PRIMARY KEY (plan_id, test_case_id))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, plan_id TEXT, project_id TEXT NOT NULL, name TEXT NOT NULL, environment TEXT DEFAULT 'staging', build_number TEXT, status TEXT DEFAULT 'in_progress', assigned_to TEXT, started_at TEXT, completed_at TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_results (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, test_case_id TEXT NOT NULL, outcome TEXT DEFAULT 'not_run', duration_seconds INTEGER, executed_by TEXT, executed_at TEXT, comment TEXT, attachments TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS test_step_results (id TEXT PRIMARY KEY, result_id TEXT NOT NULL, step_id TEXT NOT NULL, outcome TEXT DEFAULT 'not_run', actual_result TEXT, comment TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS bugs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, bug_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT, steps_to_reproduce TEXT, actual_result TEXT, expected_result TEXT, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'medium', severity TEXT DEFAULT 'major', environment TEXT, browser TEXT, os TEXT, version TEXT, assigned_to TEXT, reported_by TEXT, test_result_id TEXT, source TEXT DEFAULT 'manual', source_system TEXT, source_ref TEXT, tags TEXT, attachments TEXT, ai_duplicate_score REAL, ai_root_cause TEXT, ai_suggested_fix TEXT, resolution TEXT, resolved_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS bug_comments (id TEXT PRIMARY KEY, bug_id TEXT NOT NULL, user_id TEXT, content TEXT NOT NULL, is_system INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS bug_history (id TEXT PRIMARY KEY, bug_id TEXT NOT NULL, user_id TEXT, field_name TEXT NOT NULL, old_value TEXT, new_value TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL, is_active INTEGER DEFAULT 1, last_sync TEXT, events_received INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS integration_events (id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, event_type TEXT NOT NULL, source_system TEXT NOT NULL, source_ref TEXT, payload TEXT NOT NULL, status TEXT DEFAULT 'pending', processed_as TEXT, result_id TEXT, error_message TEXT, received_at TEXT DEFAULT (datetime('now')), processed_at TEXT)`);
  database.run(`CREATE TABLE IF NOT EXISTS ai_generated_tests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_content TEXT NOT NULL, generated_tests TEXT NOT NULL, traceability_matrix TEXT, model_used TEXT, confidence_score REAL, status TEXT DEFAULT 'draft', created_by TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, details TEXT, ip_address TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  database.run(`CREATE TABLE IF NOT EXISTS dashboard_metrics (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, metric_type TEXT NOT NULL, metric_data TEXT NOT NULL, calculated_at TEXT DEFAULT (datetime('now')))`);

  // Indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_tc_suite ON test_cases(suite_id)',
    'CREATE INDEX IF NOT EXISTS idx_tr_run ON test_results(run_id)',
    'CREATE INDEX IF NOT EXISTS idx_tr_case ON test_results(test_case_id)',
    'CREATE INDEX IF NOT EXISTS idx_bugs_proj ON bugs(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_bugs_st ON bugs(status)',
    'CREATE INDEX IF NOT EXISTS idx_ie_int ON integration_events(integration_id)',
    'CREATE INDEX IF NOT EXISTS idx_bh_bug ON bug_history(bug_id)',
  ];
  indexes.forEach(idx => database.run(idx));

  // Seed data if empty
  const userCount = prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) seedData();

  saveDb();
  return database;
}

function seedData() {
  const adminId = uuidv4(), qaManagerId = uuidv4(), tester1Id = uuidv4(), tester2Id = uuidv4(), devId = uuidv4();
  const hash = bcrypt.hashSync('password123', 10);

  const ins = (sql, params) => db.run(sql, params);

  ins('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [adminId, 'admin', 'admin@qaplatform.io', hash, 'System Admin', 'admin', null, 1, null]);
  ins('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [qaManagerId, 'qa_lead', 'qalead@qaplatform.io', hash, 'Sarah Cohen', 'qa_manager', null, 1, null]);
  ins('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [tester1Id, 'tester1', 'tester1@qaplatform.io', hash, 'David Levi', 'tester', null, 1, null]);
  ins('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [tester2Id, 'tester2', 'tester2@qaplatform.io', hash, 'Maya Katz', 'tester', null, 1, null]);
  ins('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [devId, 'developer', 'dev@qaplatform.io', hash, 'Avi Shapiro', 'developer', null, 1, null]);

  const teamId = uuidv4();
  ins('INSERT INTO teams VALUES (?,?,?,?,datetime("now"))', [teamId, 'QA Team Alpha', 'Main QA team', qaManagerId]);
  [qaManagerId, tester1Id, tester2Id].forEach(uid => ins('INSERT INTO team_members VALUES (?,?,datetime("now"))', [teamId, uid]));

  const projectId = uuidv4();
  ins('INSERT INTO projects VALUES (?,?,?,?,?,?,datetime("now"),datetime("now"))', [projectId, 'Monitoring Platform', 'MON', 'Social media monitoring platform', 'active', qaManagerId]);

  const suiteAuth = uuidv4(), suiteMon = uuidv4(), suiteDash = uuidv4();
  const insSuite = (id, pid, parent, name, icon, order) => ins('INSERT INTO test_suites VALUES (?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [id, pid, parent, name, null, icon, order, qaManagerId]);
  insSuite(suiteAuth, projectId, null, 'Authentication', '🔐', 1);
  insSuite(suiteMon, projectId, null, 'Monitoring', '📊', 2);
  insSuite(suiteDash, projectId, null, 'Dashboard & Stats', '📈', 3);

  const subLogin = uuidv4(), subPosts = uuidv4(), subMainDash = uuidv4();
  insSuite(subLogin, projectId, suiteAuth, 'Login Flow', '🔑', 1);
  insSuite(subPosts, projectId, suiteMon, 'Posts Management', '📝', 1);
  insSuite(subMainDash, projectId, suiteDash, 'Main Dashboard', '📉', 1);

  const testCases = [
    [subLogin, 'AUTH-001', 'Valid Login', 'Verify login with valid credentials', 1, 1, [['Enter valid username', 'Username accepted'], ['Enter valid password', 'Password masked'], ['Click Login', 'Redirected to dashboard']]],
    [subLogin, 'AUTH-002', 'Invalid Password', 'Verify error on invalid password', 1, 1, [['Enter valid username', 'Accepted'], ['Enter wrong password', 'Masked'], ['Click Login', 'Error message shown']]],
    [subLogin, 'AUTH-003', 'Empty Fields', 'Verify validation for empty fields', 2, 0, [['Leave fields empty', 'Fields highlighted'], ['Click Login', 'Validation error']]],
    [subLogin, 'AUTH-004', 'Remember Me', 'Verify remember me checkbox', 3, 0, [['Check remember me', 'Checked'], ['Login', 'Session persists after browser close']]],
    [subPosts, 'MON-001', 'Load Posts List', 'Verify posts load on navigation', 1, 1, [['Navigate to Monitoring', 'Page loads'], ['Wait for data', 'Spinner shown'], ['Verify posts', 'List rendered']]],
    [subPosts, 'MON-002', 'Filter Posts by Date', 'Verify date filter', 2, 0, [['Open date picker', 'Calendar shown'], ['Select range', 'Highlighted'], ['Apply', 'Posts filtered']]],
    [subPosts, 'MON-003', 'Search Posts', 'Verify search', 2, 0, [['Enter search term', 'Autocomplete'], ['Submit', 'Filtered'], ['Clear', 'All shown']]],
    [subPosts, 'MON-004', 'Process Post', 'Verify post processing', 1, 1, [['Select post', 'Selected'], ['Click Process', 'Processing starts'], ['Verify status change', 'Status updated']]],
    [subMainDash, 'STAT-001', 'Dashboard Load', 'Verify dashboard loads', 1, 1, [['Navigate to dashboard', 'Page loads'], ['Verify KPIs', 'Cards displayed'], ['Verify charts', 'Charts rendered']]],
    [subMainDash, 'STAT-002', 'KPI Accuracy', 'Verify KPI numbers are accurate', 2, 0, [['Check posts count', 'Matches database'], ['Check processed count', 'Accurate']]],
  ];

  testCases.forEach(([suite, key, title, desc, priority, critical, steps]) => {
    const caseId = uuidv4();
    ins('INSERT INTO test_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [caseId, suite, key, title, desc, null, priority, 'manual', critical, null, null, qaManagerId]);
    steps.forEach(([action, expected], i) => {
      ins('INSERT INTO test_steps VALUES (?,?,?,?,?,?,datetime("now"))', [uuidv4(), caseId, i + 1, action, expected, null]);
    });
  });

  // Seed bugs
  ins('INSERT INTO bugs (id,project_id,bug_key,title,description,steps_to_reproduce,status,priority,severity,environment,reported_by,assigned_to,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [uuidv4(), projectId, 'MON-BUG-001', 'Login button unresponsive on mobile', 'The login button does not respond to tap events on iOS Safari', '1. Open app on iPhone\n2. Enter credentials\n3. Tap Login\n4. Nothing happens', 'open', 'high', 'critical', 'iOS Safari 17', tester1Id, devId, 'manual']);
  ins('INSERT INTO bugs (id,project_id,bug_key,title,description,steps_to_reproduce,status,priority,severity,environment,reported_by,assigned_to,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [uuidv4(), projectId, 'MON-BUG-002', 'Dashboard charts not loading', 'Pie charts show blank on first load', '1. Login\n2. Navigate to Dashboard\n3. Observe empty charts', 'in_progress', 'medium', 'major', 'Chrome 120', tester2Id, devId, 'manual']);
  ins('INSERT INTO bugs (id,project_id,bug_key,title,description,steps_to_reproduce,status,priority,severity,environment,reported_by,assigned_to,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))', [uuidv4(), projectId, 'MON-BUG-003', 'Memory leak in posts list', 'Memory usage increases continuously when scrolling posts', '1. Open monitoring\n2. Scroll through posts\n3. Check memory in DevTools', 'assigned', 'critical', 'blocker', 'All browsers', qaManagerId, devId, 'manual']);
}

module.exports = { getDb, initializeDatabase, prepare, saveDb };
