require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../config/database');

const USERNAME = 'nairobi_officer1';
const NEW_PASSWORD = process.env.TEST_OFFICER_PASSWORD;

if (!NEW_PASSWORD) {
  console.error('Set TEST_OFFICER_PASSWORD in .env before running this script.');
  process.exit(1);
}

async function main() {
  const existing = await db.query(
    `SELECT officer_id, username, full_name, phone, office_id, is_active
     FROM officers
     WHERE username = $1`,
    [USERNAME]
  );

  if (existing.rows.length === 0) {
    throw new Error(`Officer "${USERNAME}" not found`);
  }

  const officer = existing.rows[0];
  const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

  await db.query(
    `UPDATE officers
     SET password_hash = $1
     WHERE officer_id = $2`,
    [hashedPassword, officer.officer_id]
  );

  const updated = await db.query(
    `SELECT officer_id, username, password_hash
     FROM officers
     WHERE officer_id = $1`,
    [officer.officer_id]
  );

  const isMatch = await bcrypt.compare(NEW_PASSWORD, updated.rows[0].password_hash);
  if (!isMatch) {
    throw new Error('Password hash verification failed after update');
  }

  console.log('=== PASSWORD RESET ===');
  console.log(JSON.stringify({
    officer_id: officer.officer_id,
    username: officer.username,
    full_name: officer.full_name,
    phone: officer.phone,
    office_id: officer.office_id,
    is_active: officer.is_active,
    password_updated: true,
    bcrypt_verify: true
  }, null, 2));

  await db.end();
}

main().catch(async (error) => {
  console.error('Reset failed:', error.message);
  await db.end();
  process.exit(1);
});
