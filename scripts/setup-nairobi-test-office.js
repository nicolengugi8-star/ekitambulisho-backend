require('dotenv').config();
const db = require('../config/database');
const bcrypt = require('bcrypt');

const COUNTY_ID = 47;
const WARD_ID = 1222;
const OFFICE_NAME = 'Kitisuru Registration Office';
const OFFICE_TYPE = 'ward_office';
const OFFICE_PHONE = '0700000471';
const DAILY_CAPACITY = 50;

const OFFICER_USERNAME = 'nairobi_officer1';
const OFFICER_FULL_NAME = 'Nairobi Officer One';
const OFFICER_PHONE = '0700000472';
const OFFICER_PASSWORD = process.env.TEST_OFFICER_PASSWORD;

if (!OFFICER_PASSWORD) {
  console.error('Set TEST_OFFICER_PASSWORD in .env before running this script.');
  process.exit(1);
}

async function main() {
  const client = await db.connect();
  const report = {
    office: { status: null, office_id: null, office_name: null, ward_id: null, county_id: null },
    officer: { status: null, officer_id: null, username: null, office_id: null }
  };

  try {
    await client.query('BEGIN');

    const existingOffice = await client.query(
      `SELECT office_id, office_name, ward_id, county_id, is_active
       FROM registration_offices
       WHERE county_id = $1
         AND ward_id = $2
         AND (is_active IS NULL OR is_active = TRUE)
       ORDER BY office_id
       LIMIT 1`,
      [COUNTY_ID, WARD_ID]
    );

    let officeId;

    if (existingOffice.rows.length > 0) {
      const o = existingOffice.rows[0];
      officeId = o.office_id;
      report.office = {
        status: 'already existed',
        office_id: o.office_id,
        office_name: o.office_name,
        ward_id: o.ward_id,
        county_id: o.county_id
      };
      console.log('=== OFFICE: ALREADY EXISTS ===');
      console.log(JSON.stringify(report.office, null, 2));
    } else {
      const insertOffice = await client.query(
        `INSERT INTO registration_offices
         (office_name, office_type, ward_id, county_id, phone, daily_capacity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING office_id, office_name, ward_id, county_id`,
        [OFFICE_NAME, OFFICE_TYPE, WARD_ID, COUNTY_ID, OFFICE_PHONE, DAILY_CAPACITY]
      );
      const o = insertOffice.rows[0];
      officeId = o.office_id;
      report.office = {
        status: 'created',
        office_id: o.office_id,
        office_name: o.office_name,
        ward_id: o.ward_id,
        county_id: o.county_id
      };
      console.log('=== OFFICE: CREATED ===');
      console.log(JSON.stringify(report.office, null, 2));
    }

    const existingOfficer = await client.query(
      `SELECT officer_id, username, office_id, is_active
       FROM officers
       WHERE username = $1
       LIMIT 1`,
      [OFFICER_USERNAME]
    );

    if (existingOfficer.rows.length > 0) {
      const off = existingOfficer.rows[0];
      report.officer = {
        status: 'already existed',
        officer_id: off.officer_id,
        username: off.username,
        office_id: off.office_id
      };
      console.log('=== OFFICER: ALREADY EXISTS ===');
      console.log(JSON.stringify(report.officer, null, 2));
    } else {
      const hashedPassword = await bcrypt.hash(OFFICER_PASSWORD, 10);
      const insertOfficer = await client.query(
        `INSERT INTO officers
         (full_name, phone, username, password_hash, office_id, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING officer_id, username, office_id`,
        [OFFICER_FULL_NAME, OFFICER_PHONE, OFFICER_USERNAME, hashedPassword, officeId]
      );
      const off = insertOfficer.rows[0];
      report.officer = {
        status: 'created',
        officer_id: off.officer_id,
        username: off.username,
        office_id: off.office_id
      };
      console.log('=== OFFICER: CREATED ===');
      console.log(JSON.stringify(report.officer, null, 2));
    }

    await client.query('COMMIT');

    const verifyOffice = await client.query(
      `SELECT ro.office_id, ro.office_name, ro.office_type, ro.ward_id, ro.county_id,
              ro.phone, ro.daily_capacity, ro.is_active,
              w.ward_name, c.county_name
       FROM registration_offices ro
       LEFT JOIN wards w ON ro.ward_id = w.ward_id
       LEFT JOIN counties c ON ro.county_id = c.county_id
       WHERE ro.office_id = $1`,
      [officeId]
    );
    console.log('=== VERIFY OFFICE ===');
    console.log(JSON.stringify(verifyOffice.rows[0], null, 2));

    const verifyOfficer = await client.query(
      `SELECT o.officer_id, o.full_name, o.username, o.phone, o.office_id, o.is_active,
              ro.office_name
       FROM officers o
       LEFT JOIN registration_offices ro ON o.office_id = ro.office_id
       WHERE o.username = $1`,
      [OFFICER_USERNAME]
    );
    console.log('=== VERIFY OFFICER ===');
    console.log(JSON.stringify(verifyOfficer.rows[0], null, 2));

    console.log('=== SUMMARY ===');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
