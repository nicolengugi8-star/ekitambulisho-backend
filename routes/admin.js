const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { getCountyScope } = require('../utils/adminScope');
const { serverError } = require('../utils/errors');

function generateRandomPassword() {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    'abcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += characters.charAt(
      Math.floor(Math.random() * characters.length)
    );
  }
  return password;
}

// POST — Admin login (public)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await db.query(
      `SELECT a.*, c.county_name
       FROM admins a
       LEFT JOIN counties c ON a.county_id = c.county_id
       WHERE a.username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const admin = result.rows[0];

    if (admin.is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'This admin account is inactive'
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const token = jwt.sign(
      {
        id: admin.admin_id,
        username: admin.username,
        role: 'admin',
        adminLevel: admin.admin_level,
        countyId: admin.county_id,
        countyName: admin.county_name || null
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      admin: {
        adminId: admin.admin_id,
        fullName: admin.full_name,
        adminLevel: admin.admin_level,
        countyId: admin.county_id,
        countyName: admin.county_name || null
      }
    });
  } catch (error) {
    serverError(res, error);
  }
});

// GET — System overview stats
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const countyId = getCountyScope(req.user);
    const params = [];
    let whereClause = '';

    if (countyId != null) {
      params.push(countyId);
      whereClause = ' WHERE county_id = $1';
    }

    const total = await db.query(
      `SELECT COUNT(*) FROM id_applications${whereClause}`,
      params
    );
    const pending = await db.query(
      `SELECT COUNT(*) FROM id_applications
       ${whereClause}${whereClause ? ' AND' : ' WHERE'} current_status = 'submitted'`,
      params
    );
    const approved = await db.query(
      `SELECT COUNT(*) FROM id_applications
       ${whereClause}${whereClause ? ' AND' : ' WHERE'} current_status = 'chief_approved'`,
      params
    );
    const collected = await db.query(
      `SELECT COUNT(*) FROM id_applications
       ${whereClause}${whereClause ? ' AND' : ' WHERE'} current_status = 'id_collected'`,
      params
    );

    res.json({
      success: true,
      stats: {
        total: total.rows[0].count,
        pending: pending.rows[0].count,
        approved: approved.rows[0].count,
        collected: collected.rows[0].count
      }
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Add new chief
router.post('/add-chief', verifyToken, isAdmin, async (req, res) => {
  try {
    const {
      fullName,
      phone,
      username,
      password,
      wardId,
      countyId
    } = req.body;

    const scopedCountyId = getCountyScope(req.user);
    const finalCountyId = scopedCountyId != null ? scopedCountyId : countyId;

    if (scopedCountyId != null && String(countyId) !== String(scopedCountyId)) {
      return res.status(403).json({
        success: false,
        message: 'County admins can only add chiefs within their county'
      });
    }

    const finalPassword = password || generateRandomPassword();
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    await db.query(
      `INSERT INTO chiefs
       (full_name, phone, username,
        password_hash, ward_id, county_id,
        must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [fullName, phone, username,
       hashedPassword, wardId, finalCountyId]
    );

    res.json({
      success: true,
      message: 'Chief added successfully',
      tempPassword: finalPassword
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Add new officer
router.post('/add-officer', verifyToken, isAdmin, async (req, res) => {
  try {
    const {
      fullName,
      phone,
      username,
      password,
      officeId
    } = req.body;

    const scopedCountyId = getCountyScope(req.user);
    if (scopedCountyId != null) {
      const officeCheck = await db.query(
        `SELECT county_id
         FROM registration_offices
         WHERE office_id = $1`,
        [officeId]
      );

      if (
        officeCheck.rows.length === 0 ||
        String(officeCheck.rows[0].county_id) !== String(scopedCountyId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'County admins can only add officers within their county'
        });
      }
    }

    const finalPassword = password || generateRandomPassword();
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    await db.query(
      `INSERT INTO officers
       (full_name, phone, username,
        password_hash, office_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [fullName, phone, username,
       hashedPassword, officeId]
    );

    res.json({
      success: true,
      message: 'Officer added successfully',
      tempPassword: finalPassword
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Reset chief password
router.post('/reset-chief-password/:chiefId',
verifyToken, isAdmin, async (req, res) => {
  try {
    const scopedCountyId = getCountyScope(req.user);

    if (scopedCountyId != null) {
      const chiefCheck = await db.query(
        `SELECT county_id FROM chiefs WHERE chief_id = $1`,
        [req.params.chiefId]
      );

      if (
        chiefCheck.rows.length === 0 ||
        String(chiefCheck.rows[0].county_id) !== String(scopedCountyId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this chief'
        });
      }
    }

    const newTempPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(newTempPassword, 10);

    await db.query(
      `UPDATE chiefs
       SET password_hash = $1,
           must_change_password = TRUE
       WHERE chief_id = $2`,
      [hashedPassword, req.params.chiefId]
    );

    res.json({
      success: true,
      message: 'Password reset successfully',
      newTempPassword: newTempPassword
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Add registration office
router.post('/add-office', verifyToken, isAdmin, async (req, res) => {
  try {
    const {
      officeName,
      officeType,
      wardId,
      countyId,
      phone,
      dailyCapacity
    } = req.body;

    const scopedCountyId = getCountyScope(req.user);
    const finalCountyId = scopedCountyId != null ? scopedCountyId : countyId;

    if (scopedCountyId != null && String(countyId) !== String(scopedCountyId)) {
      return res.status(403).json({
        success: false,
        message: 'County admins can only add offices within their county'
      });
    }

    await db.query(
      `INSERT INTO registration_offices
       (office_name, office_type,
        ward_id, county_id,
        phone, daily_capacity)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [officeName, officeType,
       wardId, finalCountyId,
       phone, dailyCapacity]
    );

    res.json({
      success: true,
      message: 'Office added successfully'
    });
  } catch (error) {
    serverError(res, error);
  }
});

// GET — All applications
router.get('/applications', verifyToken, isAdmin, async (req, res) => {
  try {
    const countyId = getCountyScope(req.user);
    const params = [];
    let countyFilter = '';

    if (countyId != null) {
      params.push(countyId);
      countyFilter = ` AND a.county_id = $${params.length}`;
    }

    const result = await db.query(
      `SELECT
         a.serial_number,
         a.first_name,
         a.last_name,
         a.phone_number,
         a.current_status,
         a.created_at,
         c.county_name,
         w.ward_name
       FROM id_applications a
       JOIN counties c
         ON a.county_id = c.county_id
       JOIN wards w
         ON a.ward_id = w.ward_id
       WHERE 1=1${countyFilter}
       ORDER BY a.created_at DESC
       LIMIT 100`,
      params
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

// GET — All chiefs
router.get('/chiefs', verifyToken, isAdmin, async (req, res) => {
  try {
    const countyId = getCountyScope(req.user);
    const params = [];
    let countyFilter = '';

    if (countyId != null) {
      params.push(countyId);
      countyFilter = ` WHERE c.county_id = $${params.length}`;
    }

    const result = await db.query(
      `SELECT
         c.chief_id,
         c.full_name,
         c.phone,
         c.is_active,
         c.is_available,
         w.ward_name,
         co.county_name
       FROM chiefs c
       JOIN wards w ON c.ward_id = w.ward_id
       JOIN counties co ON c.county_id = co.county_id
       ${countyFilter}
       ORDER BY c.full_name`,
      params
    );

    res.json({
      success: true,
      chiefs: result.rows
    });
  } catch (error) {
    serverError(res, error);
  }
});

// GET — Audit logs from application_status_log
router.get('/audit-logs', verifyToken, isAdmin, async (req, res) => {
  try {
    const countyId = getCountyScope(req.user);
    const params = [];
    let countyFilter = '';

    if (countyId != null) {
      params.push(countyId);
      countyFilter = ` AND a.county_id = $${params.length}`;
    }

    const result = await db.query(
      `SELECT
         l.log_id AS id,
         l.changed_at AS timestamp,
         l.changed_by AS user,
         l.status AS action,
         COALESCE(l.notes, a.serial_number) AS details,
         a.serial_number
       FROM application_status_log l
       LEFT JOIN id_applications a
         ON l.application_id = a.application_id
       WHERE 1=1${countyFilter}
       ORDER BY l.changed_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      success: true,
      logs: result.rows,
      auditLogs: result.rows
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Deactivate chief
router.post('/deactivate-chief/:chiefId',
verifyToken, isAdmin, async (req, res) => {
  try {
    const scopedCountyId = getCountyScope(req.user);

    if (scopedCountyId != null) {
      const chiefCheck = await db.query(
        `SELECT county_id FROM chiefs WHERE chief_id = $1`,
        [req.params.chiefId]
      );

      if (
        chiefCheck.rows.length === 0 ||
        String(chiefCheck.rows[0].county_id) !== String(scopedCountyId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this chief'
        });
      }
    }

    await db.query(
      `UPDATE chiefs
       SET is_active = FALSE
       WHERE chief_id = $1`,
      [req.params.chiefId]
    );

    res.json({
      success: true,
      message: 'Chief deactivated successfully'
    });
  } catch (error) {
    serverError(res, error);
  }
});

// POST — Activate chief
router.post('/activate-chief/:chiefId',
verifyToken, isAdmin, async (req, res) => {
  try {
    const scopedCountyId = getCountyScope(req.user);

    if (scopedCountyId != null) {
      const chiefCheck = await db.query(
        `SELECT county_id FROM chiefs WHERE chief_id = $1`,
        [req.params.chiefId]
      );

      if (
        chiefCheck.rows.length === 0 ||
        String(chiefCheck.rows[0].county_id) !== String(scopedCountyId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this chief'
        });
      }
    }

    await db.query(
      `UPDATE chiefs
       SET is_active = TRUE
       WHERE chief_id = $1`,
      [req.params.chiefId]
    );

    res.json({
      success: true,
      message: 'Chief activated successfully'
    });
  } catch (error) {
    serverError(res, error);
  }
});

module.exports = router;
