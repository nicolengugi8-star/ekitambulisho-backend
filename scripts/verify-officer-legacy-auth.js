require('dotenv').config();
const axios = require('axios');
const db = require('../config/database');

const API_BASE = process.env.API_BASE || 'http://localhost:5000';

async function loginOfficer(username, password) {
  const response = await axios.post(`${API_BASE}/api/officer/login`, {
    username,
    password
  });
  return response.data.token;
}

async function main() {
  const apps = await db.query(
    `SELECT a.application_id, ap.office_id, o.username
     FROM id_applications a
     JOIN appointments ap ON ap.application_id = a.application_id
     JOIN officers o ON o.office_id = ap.office_id
     WHERE a.current_status IN ('chief_approved', 'biometrics_done', 'id_ready', 'id_given')
     ORDER BY a.application_id
     LIMIT 5`
  );

  if (apps.rows.length === 0) {
    console.log('No applications with appointments found for auth test.');
    await db.end();
    return;
  }

  const targetApp = apps.rows[0];
  const wrongOfficer = await db.query(
    `SELECT username
     FROM officers
     WHERE office_id <> $1
     AND is_active = TRUE
     LIMIT 1`,
    [targetApp.office_id]
  );

  if (wrongOfficer.rows.length === 0) {
    console.log('Need at least two offices with officers to test cross-office denial.');
    await db.end();
    return;
  }

  const wrongUsername = wrongOfficer.rows[0].username;
  const wrongPassword = process.env.TEST_OFFICER_PASSWORD;

  if (!wrongPassword) {
    console.log('Set TEST_OFFICER_PASSWORD in .env to run live auth test.');
    await db.end();
    return;
  }

  let serverUp = false;
  try {
    await axios.get(`${API_BASE}/api/locations/counties`, { timeout: 3000 });
    serverUp = true;
  } catch (error) {
    console.log('Server not running; skipping live HTTP auth test.');
  }

  if (!serverUp) {
    await db.end();
    return;
  }

  const token = await loginOfficer(wrongUsername, wrongPassword);
  const headers = { Authorization: `Bearer ${token}` };

  const response = await axios.post(
    `${API_BASE}/api/officer/id-ready/${targetApp.application_id}`,
    {},
    { headers, validateStatus: () => true }
  );

  console.log('=== LEGACY ROUTE AUTH TEST ===');
  console.log(JSON.stringify({
    target_application_id: targetApp.application_id,
    target_office_id: targetApp.office_id,
    acting_officer: wrongUsername,
    status: response.status,
    body: response.data
  }, null, 2));

  await db.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await db.end();
  process.exit(1);
});
