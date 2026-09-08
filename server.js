const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/database');
const cronJobs = require('./services/cron');

const locationRoutes = require('./routes/locations');
const citizenRoutes = require('./routes/citizen');
const chiefRoutes = require('./routes/chief');
const officerRoutes = require('./routes/officer');
const adminRoutes = require('./routes/admin');
const foreignerRoutes = require('./routes/foreigners');
const replacementRoutes = require('./routes/replacements');

const { parseCorsOrigins } = require('./utils/cors');

const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);

const app = express();
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json());

app.use('/api/locations', locationRoutes);
app.use('/api/citizen', citizenRoutes);
app.use('/api/chief', chiefRoutes);
app.use('/api/officer', officerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/foreigner', foreignerRoutes);
app.use('/api/replacement', replacementRoutes);

app.get('/', (req, res) => {
  res.json({
    system: '',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      locations: '/api/locations',
      citizen: '/api/citizen',
      chief: '/api/chief',
      officer: '/api/officer',
      admin: '/api/admin',
      foreigner: '/api/foreigner',
      replacement: '/api/replacement'
    }
  });
});

const PORT = process.env.PORT || 3000;

function logStartupConfig() {
  const dbConfigured = Boolean(
    process.env.DATABASE_URL ||
    (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER)
  );

  console.log('Startup configuration:');
  console.log(`  PORT=${PORT}`);
  console.log(`  database configured=${dbConfigured}`);
  console.log(`  JWT_SECRET set=${Boolean(process.env.JWT_SECRET)}`);
  console.log(`  SMS_DISABLED=${process.env.SMS_DISABLED || 'false'}`);
  console.log(`  CORS_ORIGIN=${process.env.CORS_ORIGIN ? 'set' : 'default localhost:3000'}`);
}

if (require.main === module) {
  logStartupConfig();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('e-Kitambulisho Server Started!');
    console.log(`Running on port: ${PORT}`);
    console.log('================================');

    // START CRON JOBS HERE
    cronJobs.start();
  });
}

module.exports = { app };