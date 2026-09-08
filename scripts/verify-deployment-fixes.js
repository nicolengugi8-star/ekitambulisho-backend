require('dotenv').config();
const db = require('../config/database');
const {
  scheduleOrphanedChiefApprovedApplications,
  findRegistrationOffice
} = require('../services/appointments');

async function main() {
  const orphansBefore = await db.query(
    `SELECT a.application_id, a.serial_number, a.ward_id, a.county_id
     FROM id_applications a
     LEFT JOIN appointments ap ON ap.application_id = a.application_id
     WHERE a.current_status = 'chief_approved'
     AND ap.appointment_id IS NULL
     ORDER BY a.application_id`
  );

  console.log('=== ORPHANS BEFORE ===');
  console.log(JSON.stringify(orphansBefore.rows, null, 2));

  for (const row of orphansBefore.rows) {
    const office = await findRegistrationOffice(row.ward_id, row.county_id);
    console.log(
      `application ${row.application_id} (${row.serial_number}) office:`,
      office ? office.office_name : 'none'
    );
  }

  const backfill = await scheduleOrphanedChiefApprovedApplications();
  console.log('=== BACKFILL RESULT ===');
  console.log(JSON.stringify(backfill, null, 2));

  const orphansAfter = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM id_applications a
     LEFT JOIN appointments ap ON ap.application_id = a.application_id
     WHERE a.current_status = 'chief_approved'
     AND ap.appointment_id IS NULL`
  );

  console.log('=== ORPHANS AFTER ===');
  console.log(orphansAfter.rows[0].count);

  await db.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await db.end();
  process.exit(1);
});
