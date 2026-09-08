const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  verifyToken,
  isOfficer,
  enforceOfficerOffice
} = require('../middleware/auth');
const { getAppointmentContext } = require('../services/appointments');
const { serverError } = require('../utils/errors');

async function generateNationalIdNo(applicationId) {
  const existing = await db.query(
    `SELECT national_id_no
     FROM id_applications
     WHERE application_id = $1`,
    [applicationId]
  );

  if (existing.rows[0]?.national_id_no) {
    return existing.rows[0].national_id_no;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = String(
      Math.floor(10000000 + Math.random() * 90000000)
    );

    const duplicate = await db.query(
      `SELECT 1
       FROM id_applications
       WHERE national_id_no = $1`,
      [candidate]
    );

    if (duplicate.rows.length === 0) {
      return candidate;
    }
  }

  throw new Error('Could not generate a unique national ID number');
}

async function assertOfficerAppointmentAccess(req, res, appointmentId) {
  const context = await getAppointmentContext(appointmentId);

  if (!context) {
    res.status(404).json({
      success: false,
      message: 'Appointment not found'
    });
    return null;
  }

  if (String(context.office_id) !== String(req.user.officeId)) {
    res.status(403).json({
      success: false,
      message: 'Access denied for this appointment.'
    });
    return null;
  }

  return context;
}

async function assertOfficerApplicationAccess(req, res, applicationId) {
  const result = await db.query(
    `SELECT ap.appointment_id, ap.office_id
     FROM appointments ap
     WHERE ap.application_id = $1
     ORDER BY ap.appointment_id
     LIMIT 1`,
    [applicationId]
  );

  if (result.rows.length === 0) {
    res.status(403).json({
      success: false,
      message: 'Access denied. No appointment found for this application.'
    });
    return null;
  }

  if (String(result.rows[0].office_id) !== String(req.user.officeId)) {
    res.status(403).json({
      success: false,
      message: 'Access denied for this application.'
    });
    return null;
  }

  return result.rows[0];
}

async function markBiometricsDone(appointmentId, officerId) {
  const appt = await db.query(
    `SELECT application_id
     FROM appointments
     WHERE appointment_id = $1`,
    [appointmentId]
  );

  if (appt.rows.length === 0) {
    return { notFound: true };
  }

  const applicationId = appt.rows[0].application_id;

  await db.query(
    `UPDATE appointments
     SET status = 'completed'
     WHERE appointment_id = $1`,
    [appointmentId]
  );

  await db.query(
    `UPDATE id_applications
     SET current_status = 'biometrics_done'
     WHERE application_id = $1`,
    [applicationId]
  );

  await db.query(
    `INSERT INTO application_status_log
     (application_id, status, changed_by)
     VALUES ($1, 'biometrics_done', $2)`,
    [applicationId, `officer_${officerId}`]
  );

  return { applicationId };
}

async function markIdReady(applicationId, officerId, nationalIdNo) {
  const idNumber = nationalIdNo || await generateNationalIdNo(applicationId);

  await db.query(
    `UPDATE id_applications
     SET current_status = 'id_ready',
         national_id_no = $1
     WHERE application_id = $2`,
    [idNumber, applicationId]
  );

  await db.query(
    `INSERT INTO application_status_log
     (application_id, status, changed_by)
     VALUES ($1, 'id_ready', $2)`,
    [applicationId, `officer_${officerId}`]
  );

  return { nationalIdNo: idNumber };
}

async function markIdGiven(applicationId, officerId) {
  await db.query(
    `UPDATE id_applications
     SET current_status = 'id_given'
     WHERE application_id = $1`,
    [applicationId]
  );

  await db.query(
    `INSERT INTO application_status_log
     (application_id, status, changed_by)
     VALUES ($1, 'id_given', $2)`,
    [applicationId, `officer_${officerId}`]
  );
}

async function markIdCollected(applicationId, officerId) {
  await db.query(
    `UPDATE id_applications
     SET current_status = 'id_collected'
     WHERE application_id = $1`,
    [applicationId]
  );

  await db.query(
    `UPDATE waiting_card
     SET is_active = FALSE,
         current_status = 'expired',
         expired_at = NOW()
     WHERE application_id = $1`,
    [applicationId]
  );

  await db.query(
    `INSERT INTO application_status_log
     (application_id, status, changed_by)
     VALUES ($1, 'id_collected', $2)`,
    [applicationId, `officer_${officerId}`]
  );
}

// POST — Officer Login (public)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const result = await db.query(
      `SELECT *
       FROM officers
       WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const officer = result.rows[0];

    if (officer.is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'This officer account is inactive'
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      officer.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const token = jwt.sign(
      {
        id: officer.officer_id,
        username: officer.username,
        role: 'officer',
        officeId: officer.office_id
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES || '8h'
      }
    );

    res.json({
      success: true,
      message: 'Officer login successful',
      token: token,
      officer: {
        officerId: officer.officer_id,
        username: officer.username,
        fullName: officer.full_name,
        officeId: officer.office_id,
        role: 'officer'
      }
    });
  } catch (error) {
    console.error('Officer login error:', error);
    serverError(res, error, 'Server error during officer login');
  }
});

// GET — Today's appointments
router.get(
  '/appointments/:officeId',
  verifyToken,
  isOfficer,
  enforceOfficerOffice,
  async (req, res) => {
    try {
      const result = await db.query(
        `SELECT
           ap.appointment_id,
           ap.application_id,
           ap.appointment_date,
           ap.appointment_time,
           ap.queue_number,
           ap.status,
           a.serial_number,
           a.first_name,
           a.last_name,
           a.phone_number,
           a.current_status,
           w.ward_name,
           sc.sub_county_name,
           c.county_name,
           ro.office_name AS station_name
         FROM appointments ap
         JOIN id_applications a
           ON ap.application_id = a.application_id
         LEFT JOIN wards w
           ON a.ward_id = w.ward_id
         LEFT JOIN sub_counties sc
           ON a.sub_county_id = sc.sub_county_id
         LEFT JOIN counties c
           ON a.county_id = c.county_id
         LEFT JOIN registration_offices ro
           ON ap.office_id = ro.office_id
         WHERE ap.office_id = $1
         AND ap.appointment_date = CURRENT_DATE
         ORDER BY ap.queue_number ASC`,
        [req.params.officeId]
      );

      res.json({
        success: true,
        appointments: result.rows,
        total: result.rows.length
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

// POST — Biometric integration point (appointment-scoped, frontend-compatible)
router.post(
  '/appointments/:appointmentId/biometrics-done',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const context = await assertOfficerAppointmentAccess(
        req,
        res,
        req.params.appointmentId
      );
      if (!context) return;

      const result = await markBiometricsDone(
        req.params.appointmentId,
        req.user.id
      );

      if (result.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found'
        });
      }

      res.json({
        success: true,
        message: 'Biometrics recorded successfully'
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

// POST — Mark ID ready (appointment-scoped, frontend-compatible)
router.post(
  '/appointments/:appointmentId/id-ready',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const context = await assertOfficerAppointmentAccess(
        req,
        res,
        req.params.appointmentId
      );
      if (!context) return;

      if (context.current_status !== 'biometrics_done') {
        return res.status(400).json({
          success: false,
          message: 'Biometrics must be completed before marking ID ready'
        });
      }

      const { nationalIdNo } = req.body || {};
      const result = await markIdReady(
        context.application_id,
        req.user.id,
        nationalIdNo
      );

      res.json({
        success: true,
        message: 'ID marked as ready for collection',
        nationalIdNo: result.nationalIdNo
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

// POST — Confirm physical ID handover (required by officer portal workflow)
router.post(
  '/appointments/:appointmentId/id-given',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const context = await assertOfficerAppointmentAccess(
        req,
        res,
        req.params.appointmentId
      );
      if (!context) return;

      if (context.current_status !== 'id_ready') {
        return res.status(400).json({
          success: false,
          message: 'ID must be marked ready before confirming handover'
        });
      }

      await markIdGiven(context.application_id, req.user.id);

      res.json({
        success: true,
        message: 'ID handover confirmed'
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

// POST — Mark ID collected (appointment-scoped, frontend-compatible)
router.post(
  '/appointments/:appointmentId/id-collected',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const context = await assertOfficerAppointmentAccess(
        req,
        res,
        req.params.appointmentId
      );
      if (!context) return;

      if (context.current_status !== 'id_given') {
        return res.status(400).json({
          success: false,
          message: 'ID must be handed over before marking collected'
        });
      }

      await markIdCollected(context.application_id, req.user.id);

      res.json({
        success: true,
        message: 'ID collected successfully. Process complete!'
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

// Legacy integration routes (application-scoped)
router.post(
  '/biometrics-done/:appointmentId',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const context = await assertOfficerAppointmentAccess(
        req,
        res,
        req.params.appointmentId
      );
      if (!context) return;

      await markBiometricsDone(req.params.appointmentId, req.user.id);

      res.json({
        success: true,
        message: 'Biometrics captured successfully'
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

router.post(
  '/id-ready/:applicationId',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const access = await assertOfficerApplicationAccess(
        req,
        res,
        req.params.applicationId
      );
      if (!access) return;

      const { nationalIdNo } = req.body || {};
      const result = await markIdReady(
        req.params.applicationId,
        req.user.id,
        nationalIdNo
      );

      res.json({
        success: true,
        message: 'ID marked as ready for collection',
        nationalIdNo: result.nationalIdNo
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

router.post(
  '/id-collected/:applicationId',
  verifyToken,
  isOfficer,
  async (req, res) => {
    try {
      const access = await assertOfficerApplicationAccess(
        req,
        res,
        req.params.applicationId
      );
      if (!access) return;

      await markIdCollected(req.params.applicationId, req.user.id);

      res.json({
        success: true,
        message: 'ID collected successfully. Process complete!'
      });
    } catch (error) {
      serverError(res, error);
    }
  }
);

module.exports = router;
