const cron = require('node-cron');
const db = require('../config/database');
const sendSMS = require('./sms');
const {
  scheduleOrphanedChiefApprovedApplications
} = require('./appointments');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const KENYA_TZ = 'Africa/Nairobi';

// ⏰ 8AM — Morning briefing to chiefs
cron.schedule('0 8 * * *', async () => {
  try {
    console.log('Running 8AM morning briefing...');

    const result = await db.query(
      `SELECT 
         c.chief_id,
         c.full_name,
         c.phone,
         COUNT(a.application_id) as pending_count
       FROM chiefs c
       JOIN id_applications a 
         ON c.ward_id = a.ward_id
       WHERE a.current_status = 'submitted'
       GROUP BY c.chief_id, 
                c.full_name, 
                c.phone
       HAVING COUNT(a.application_id) > 0`
    );

    for (const chief of result.rows) {
      await sendSMS(
        chief.phone,
        `Habari ${chief.full_name}!
Asubuhi njema. Una maombi 
${chief.pending_count} yanayosubiri 
idhini yako leo.
Tafadhali kagua mfumo.
`
      );
      console.log(
        `✅ Morning SMS sent to ${chief.full_name}`
      );
    }

    console.log(
      `✅ 8AM briefing complete. 
       Notified ${result.rows.length} chiefs`
    );

  } catch (error) {
    console.log('❌ 8AM job failed:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ 3PM — Deadline reminder
cron.schedule('0 15 * * *', async () => {
  try {
    console.log('Running 3PM reminder...');

    const result = await db.query(
      `SELECT
         c.chief_id,
         c.full_name,
         c.phone,
         COUNT(a.application_id) as overdue_count
       FROM chiefs c
       JOIN id_applications a
         ON c.ward_id = a.ward_id
       WHERE a.current_status = 'submitted'
       AND a.created_at < NOW() - INTERVAL '6 hours'
       GROUP BY c.chief_id,
                c.full_name,
                c.phone
       HAVING COUNT(a.application_id) > 0`
    );

    for (const chief of result.rows) {
      await sendSMS(
        chief.phone,
        `Kumbusho Chief ${chief.full_name}!
Una maombi ${chief.overdue_count} 
yanayosubiri idhini yako.
Tafadhali kagua mfumo haraka.
`
      );
      console.log(
        `✅ 3PM reminder sent to ${chief.full_name}`
      );
    }

    console.log(
      `✅ 3PM reminder complete.
       Reminded ${result.rows.length} chiefs`
    );

  } catch (error) {
    console.log('❌ 3PM job failed:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ 5PM — Flag overdue applications
cron.schedule('0 17 * * *', async () => {
  try {
    console.log('Running 5PM overdue check...');

    await db.query(
      `UPDATE id_applications
       SET escalated = TRUE
       WHERE current_status = 'submitted'
       AND created_at < NOW() - INTERVAL '24 hours'
       AND escalated = FALSE`
    );

    const flagged = await db.query(
      `SELECT COUNT(*) as total
       FROM id_applications
       WHERE escalated = TRUE
       AND current_status = 'submitted'`
    );

    console.log(
      `✅ 5PM check complete.
       ${flagged.rows[0].total} applications flagged`
    );

  } catch (error) {
    console.log('❌ 5PM job failed:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ Midnight — Daily statistics
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running midnight statistics...');

    const chiefs = await db.query(
      `SELECT chief_id FROM chiefs
       WHERE is_active = TRUE`
    );

    for (const chief of chiefs.rows) {

      const stats = await db.query(
        `SELECT
           COUNT(CASE WHEN current_status = 'submitted' 
                 THEN 1 END) as received,
           COUNT(CASE WHEN current_status = 'chief_approved' 
                 THEN 1 END) as approved,
           COUNT(CASE WHEN current_status = 'chief_rejected' 
                 THEN 1 END) as rejected,
           COUNT(CASE WHEN escalated = TRUE 
                 THEN 1 END) as overdue
         FROM id_applications
         WHERE ward_id = (
           SELECT ward_id FROM chiefs 
           WHERE chief_id = $1
         )
         AND DATE(created_at) = CURRENT_DATE`,
        [chief.chief_id]
      );

      const s = stats.rows[0];

      await db.query(
        `INSERT INTO chief_performance
         (chief_id, date, received,
          approved, rejected, overdue)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
         ON CONFLICT (chief_id, date) 
         DO UPDATE SET
           received = $2,
           approved = $3,
           rejected = $4,
           overdue = $5`,
        [chief.chief_id,
         s.received, s.approved,
         s.rejected, s.overdue]
      );
    }

    console.log(
      `✅ Midnight stats complete for
       ${chiefs.rows.length} chiefs`
    );

  } catch (error) {
    console.log('❌ Midnight job failed:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ Hourly — Backfill chief_approved applications missing appointments
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running orphaned chief_approved scheduling backfill...');
    const result = await scheduleOrphanedChiefApprovedApplications();
    console.log(
      `✅ Orphan backfill complete. total=${result.total} scheduled=${result.scheduled} skipped=${result.skipped} failed=${result.failed}`
    );
  } catch (error) {
    console.log('❌ Orphan backfill failed:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ 2AM — Database backup
cron.schedule('0 2 * * *', async () => {
  try {
    console.log('Starting database backup...');

    const backupDir = path.join(
      __dirname, '../backups'
    );

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const date = new Date()
      .toISOString()
      .slice(0, 10);
    const filename = `backup-${date}.sql`;
    const filepath = path.join(backupDir, filename);

    const dbUser = process.env.DB_USER || 'postgres';
    const dbName = process.env.DB_NAME || 'Kenya_ID_System';
    const command =
      `pg_dump -U ${dbUser} -d ${dbName} -f "${filepath}"`;

    exec(command, (error) => {
      if (error) {
        console.log('❌ Backup failed:', 
          error.message);
        return;
      }
      console.log(`✅ Backup saved: ${filename}`);
    });

  } catch (error) {
    console.log('❌ Backup error:', error.message);
  }
}, { timezone: KENYA_TZ });

// ⏰ 2:30AM — Delete old backups
cron.schedule('30 2 * * *', async () => {
  try {
    console.log('Cleaning old backups...');

    const backupDir = path.join(
      __dirname, '../backups'
    );

    if (!fs.existsSync(backupDir)) return;

    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(
          path.join(backupDir, f)
        ).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(7);

    toDelete.forEach(file => {
      fs.unlinkSync(file.path);
      console.log(
        `🗑️ Deleted old backup: ${file.name}`
      );
    });

    console.log(
      `✅ Kept ${Math.min(files.length, 7)} 
       recent backups`
    );

  } catch (error) {
    console.log('❌ Cleanup error:', error.message);
  }
}, { timezone: KENYA_TZ });



module.exports = {
  start: () => {
    console.log('✅ All cron jobs started!');
    console.log('📅 Schedule:');
    console.log('   8AM  → Chief morning briefing');
    console.log('   3PM  → Deadline reminders');
    console.log('   5PM  → Flag overdue applications');
    console.log('   Hourly → Schedule orphaned chief_approved applications');
    console.log('   12AM → Daily statistics');
    console.log('   2AM  → Database backup');
    console.log('   2:30AM → Cleanup old backups');
  }
};