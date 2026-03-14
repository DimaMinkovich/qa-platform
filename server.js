const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  await initializeDatabase();
  console.log('Database initialized');

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/tests', require('./routes/tests'));
  app.use('/api/bugs', require('./routes/bugs'));
  app.use('/api/integrations', require('./routes/integrations'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/ai', require('./routes/ai'));

  app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() }));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`\n  QA Platform running at http://localhost:${PORT}\n`);
    console.log('  Default credentials:');
    console.log('    admin / password123');
    console.log('    qa_lead / password123');
    console.log('    tester1 / password123\n');
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
