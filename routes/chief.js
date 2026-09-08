const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  verifyToken,
  isChief,
  enforceChiefWard
} = require('../middleware/auth');
const sendSMS = require('../services/sms');
const {
  scheduleAppointmentAfterApproval,
  findRegistrationOffice,
  buildApplicantAppointmentSms,
  buildAlternativeContactAppointmentSms
} = require('../services/appointments');
const { serverError } = require('../utils/errors');

async function assertChiefOwnsApplication(req, res, applicationId) {
  const appResult = await db.query(
    `SELECT ward_id
     FROM id_applications
     WHERE application_id = $1`,
    [applicationId]
  );

  if (appResult.rows.length === 0) {
    res.status(404).json({
      success: false,
      message: 'Application not found'
    });
    return false;
  }

  if (String(appResult.rows[0].ward_id) !== String(req.user.wardId)) {
    res.status(403).json({
      success: false,
      message: 'Access denied. This application is not in your ward.'
    });
    return false;
  }

  return true;
}

// POST — Chief login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await db.query(
      `SELECT * FROM chiefs WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const chief = result.rows[0];

    if (chief.is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'This chief account is inactive'
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      chief.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const token = jwt.sign(
      {
        id: chief.chief_id,
        username: chief.username,
        role: 'chief',
        wardId: chief.ward_id
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      mustChangePassword: chief.must_change_password,
      chief: {
        chiefId: chief.chief_id,
        fullName: chief.full_name,
        wardId: chief.ward_id
      }
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Chief changes password
router.post('/change-password', verifyToken, isChief,
async (req, res) => {
  try {
    const { newPassword } = req.body;
    const chiefId = req.user.id;

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      `UPDATE chiefs
       SET password_hash = $1,
           must_change_password = FALSE
       WHERE chief_id = $2`,
      [hashedPassword, chiefId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    serverError(res, error);
  }
});

// GET — Pending applications for chief
router.get('/pending/:wardId', verifyToken, isChief, enforceChiefWard,
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         a.application_id,
         a.serial_number,
         a.first_name,
         a.last_name,
         a.date_of_birth,
         a.phone_number,
         a.birth_cert_no,
         a.created_at,
         c.county_name,
         w.ward_name
       FROM id_applications a
       JOIN counties c ON a.county_id = c.county_id
       JOIN wards w ON a.ward_id = w.ward_id
       WHERE a.ward_id = $1
       AND a.current_status = 'submitted'
       ORDER BY a.created_at ASC`,
      [req.params.wardId]
    );

    res.json({
      success: true,
      applications: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Chief approves application
router.post('/approve/:applicationId', verifyToken, isChief,
async (req, res) => {
  const client = await db.connect();

  try {
    const chiefId = req.user.id;
    const applicationId = req.params.applicationId;
    const ownsApplication = await assertChiefOwnsApplication(
      req,
      res,
      applicationId
    );
    if (!ownsApplication) return;

    await client.query('BEGIN');

    const appResult = await client.query(
      `SELECT
         a.application_id,
         a.current_status,
         a.ward_id,
         a.county_id,
         a.first_name,
         a.last_name,
         a.phone_number,
         a.alternative_contact,
         a.serial_number
       FROM id_applications a
       WHERE a.application_id = $1
       FOR UPDATE`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const app = appResult.rows[0];

    if (app.current_status !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Application cannot be approved from status "${app.current_status}"`
      });
    }

    const office = await findRegistrationOffice(
      app.ward_id,
      app.county_id,
      client
    );

    if (!office) {
      await client.query(
        `UPDATE id_applications
         SET current_status = 'chief_approved'
         WHERE application_id = $1`,
        [applicationId]
      );

      await client.query(
        `INSERT INTO application_status_log
         (application_id, status, changed_by)
         VALUES ($1, 'chief_approved', $2)`,
        [applicationId, `chief_${chiefId}`]
      );

      await client.query('COMMIT');

      await sendSMS(
        app.phone_number,
        `Habari ${app.first_name}! 
Ombi lako la kitambulisho 
limeidhinishwa na Mwenyekiti. 
Nambari: ${app.serial_number}. 
Utapata taarifa ya miadi hivi karibuni.
`
      );

      if (app.alternative_contact) {
        await sendSMS(
          app.alternative_contact,
          `Ombi la kitambulisho la 
${app.first_name} ${app.last_name} 
limeidhinishwa. 
Ref: ${app.serial_number}
`
        );
      }

      return res.json({
        success: true,
        message: 'Application approved and SMS sent!',
        scheduling: { scheduled: false, reason: 'no_office' }
      });
    }

    await client.query(
      `UPDATE id_applications
       SET current_status = 'chief_approved'
       WHERE application_id = $1`,
      [applicationId]
    );

    await client.query(
      `INSERT INTO application_status_log
       (application_id, status, changed_by)
       VALUES ($1, 'chief_approved', $2)`,
      [applicationId, `chief_${chiefId}`]
    );

    const scheduling = await scheduleAppointmentAfterApproval(
      applicationId,
      { client, skipSms: true }
    );

    if (!scheduling.scheduled) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        success: false,
        message: 'Approval failed because appointment scheduling did not complete.',
        scheduling
      });
    }

    await client.query('COMMIT');

    await sendSMS(
      app.phone_number,
      buildApplicantAppointmentSms({
        firstName: app.first_name,
        serialNumber: app.serial_number,
        appointmentDate: scheduling.appointmentDate,
        appointmentTime: scheduling.appointmentTime,
        queueNumber: scheduling.queueNumber,
        office: scheduling.office
      })
    );

    if (app.alternative_contact) {
      await sendSMS(
        app.alternative_contact,
        buildAlternativeContactAppointmentSms({
          firstName: app.first_name,
          lastName: app.last_name,
          serialNumber: app.serial_number,
          appointmentDate: scheduling.appointmentDate,
          appointmentTime: scheduling.appointmentTime,
          queueNumber: scheduling.queueNumber,
          office: scheduling.office
        })
      );
    }

    res.json({
      success: true,
      message: 'Application approved and appointment scheduled.',
      scheduling
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // ignore rollback errors
    }
    serverError(res, error);
  } finally {
    client.release();
  }
});

// POST — Chief rejects application
router.post('/reject/:applicationId', verifyToken, isChief,
async (req, res) => {
  try {
    const chiefId = req.user.id;
    const { reason } = req.body;
    const ownsApplication = await assertChiefOwnsApplication(
      req,
      res,
      req.params.applicationId
    );
    if (!ownsApplication) return;

    const appResult = await db.query(
      `SELECT first_name, phone_number,
              alternative_contact, serial_number
       FROM id_applications
       WHERE application_id = $1`,
      [req.params.applicationId]
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const app = appResult.rows[0];

    await db.query(
      `UPDATE id_applications
       SET current_status = 'chief_rejected'
       WHERE application_id = $1`,
      [req.params.applicationId]
    );

    await db.query(
      `INSERT INTO application_status_log
       (application_id, status, changed_by, notes)
       VALUES ($1, 'chief_rejected', $2, $3)`,
      [
        req.params.applicationId,
        `chief_${chiefId}`,
        reason || 'Rejected by chief'
      ]
    );

    await sendSMS(
      app.phone_number,
      `Habari ${app.first_name}! 
Ombi lako la kitambulisho 
limekataliwa na Mwenyekiti. 
Sababu: ${reason || 'Rejected by chief'}. 
Wasiliana na ofisi ya Mwenyekiti 
kwa maelezo zaidi.
`
    );

    res.json({
      success: true,
      message: 'Application rejected and SMS sent'
    });
  } catch (error) {
    serverError(res, error);
  }
});

module.exports = router;
