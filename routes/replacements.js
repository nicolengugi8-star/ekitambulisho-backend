const express = require('express');
const router = express.Router();
const db = require('../config/database');
const sendSMS = require('../services/sms');
const { uploadPoliceAbstract } = require('../middleware/upload');
const { verifyToken, isAdmin } = require('../middleware/auth');

// POST — Submit lost ID replacement
router.post('/apply', async (req, res) => {
  try {
    const {
      fullName,
      oldIdNumber,
      dateOfBirth,
      phoneNumber,
      alternativeContact,
      wardId,
      countyId,
      reason,
      policeAbstract
    } = req.body;

    // Check police abstract for lost and stolen
    if ((reason === 'lost' || reason === 'stolen')
        && !policeAbstract) {
      return res.status(400).json({
        success: false,
        message: `Police abstract is required 
                  for ${reason} ID. 
                  Please visit your nearest 
                  police station to get an 
                  OB number first.`
      });
    }

    // Generate serial number
    const year = new Date().getFullYear();
    const countResult = await db.query(
      `SELECT COUNT(*) FROM id_replacements`
    );
    const count = parseInt(
      countResult.rows[0].count
    ) + 1;
    const serialNumber =
      `LR-${year}-${String(count).padStart(5, '0')}`;

    // Check if old ID exists in system
    let matchedApplication = null;
    if (oldIdNumber) {
      const idCheck = await db.query(
        `SELECT
           application_id,
           first_name,
           last_name,
           date_of_birth,
           county_id,
           ward_id
         FROM id_applications
         WHERE national_id_no = $1`,
        [oldIdNumber]
      );

      if (idCheck.rows.length > 0) {
        matchedApplication = idCheck.rows[0];
      }
    }

    // Save replacement application
    const insertResult = await db.query(
      `INSERT INTO id_replacements
       (serial_number, full_name,
        old_id_number, date_of_birth,
        phone_number, alternative_contact,
        ward_id, county_id,
        reason, police_abstract,
        current_status)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        'submitted')
       RETURNING replacement_id`,
      [serialNumber, fullName,
       oldIdNumber, dateOfBirth,
       phoneNumber, alternativeContact,
       wardId, countyId,
       reason, policeAbstract]
    );

    const replacementId = insertResult.rows[0].replacement_id;

    // Send SMS confirmation
    await sendSMS(
      phoneNumber,
      `Habari ${fullName}!
Ombi lako la kitambulisho 
kipya limepokelewa.
Nambari yako: ${serialNumber}.
Sababu: ${reason}.
`
    );

    // Send to alternative contact
    if (alternativeContact) {
      await sendSMS(
        alternativeContact,
        `Ombi la kitambulisho kipya 
la ${fullName} limepokelewa.
Nambari: ${serialNumber}.
`
      );
    }

    res.json({
      success: true,
      serialNumber: serialNumber,
      replacementId: replacementId,
      message: 'Replacement application submitted!',
      existingRecord: matchedApplication ? {
        found: true,
        message: 'Your previous record found in system'
      } : {
        found: false,
        message: 'No previous record found'
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Unable to submit replacement application. Please try again.'
    });
  }
});

// POST — Upload police abstract
router.post('/upload-abstract/:replacementId',
uploadPoliceAbstract.single('policeAbstract'),
async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const filePath = req.file.path;
    const replacementId = req.params.replacementId;

    // Save file path to database
    await db.query(
      `UPDATE id_replacements
       SET police_abstract = $1
       WHERE replacement_id = $2`,
      [filePath, replacementId]
    );

    res.json({
      success: true,
      message: 'Police abstract uploaded successfully',
      filePath: filePath,
      fileName: req.file.filename,
      fileSize: req.file.size
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET — Check replacement status
router.get('/status/:serialNumber',
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         r.serial_number,
         r.full_name,
         r.old_id_number,
         r.reason,
         r.police_abstract,
         r.current_status,
         r.created_at,
         w.ward_name,
         c.county_name
       FROM id_replacements r
       LEFT JOIN wards w
         ON r.ward_id = w.ward_id
       LEFT JOIN counties c
         ON r.county_id = c.county_id
       WHERE r.serial_number = $1`,
      [req.params.serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      application: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET — Verify old ID exists in system
router.get('/verify-id/:idNumber',
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         first_name,
         last_name,
         date_of_birth,
         county_id,
         ward_id,
         national_id_no
       FROM id_applications
       WHERE national_id_no = $1
       AND current_status = 'id_collected'`,
      [req.params.idNumber]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: 'ID number not found in system'
      });
    }

    res.json({
      success: true,
      found: true,
      message: 'ID found in system',
      data: {
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name,
        countyId: result.rows[0].county_id,
        wardId: result.rows[0].ward_id
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET — All replacements
router.get('/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         r.serial_number,
         r.full_name,
         r.old_id_number,
         r.reason,
         r.police_abstract,
         r.phone_number,
         r.current_status,
         r.created_at,
         c.county_name,
         w.ward_name
       FROM id_replacements r
       LEFT JOIN counties c
         ON r.county_id = c.county_id
       LEFT JOIN wards w
         ON r.ward_id = w.ward_id
       ORDER BY r.created_at DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      replacements: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST — Update replacement status
router.post('/update-status/:replacementId',
verifyToken, isAdmin,
async (req, res) => {
  try {
    const { status, updatedBy } = req.body;

    // Get replacement details for SMS
    const repResult = await db.query(
      `SELECT full_name, phone_number,
              alternative_contact,
              serial_number
       FROM id_replacements
       WHERE replacement_id = $1`,
      [req.params.replacementId]
    );

    if (repResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Replacement not found'
      });
    }

    const rep = repResult.rows[0];

    // Update status
    await db.query(
      `UPDATE id_replacements
       SET current_status = $1
       WHERE replacement_id = $2`,
      [status, req.params.replacementId]
    );

    // Send SMS based on new status
    let smsMessage = '';

    if (status === 'approved') {
      smsMessage =
        `Habari ${rep.full_name}!
Ombi lako la kitambulisho kipya
limeidhinishwa.
Nambari: ${rep.serial_number}.
Utaarifiwa tarehe ya miadi.
`;
    } else if (status === 'id_ready') {
      smsMessage =
        `Habari ${rep.full_name}!
Kitambulisho chako kipya kiko tayari!
Nambari: ${rep.serial_number}.
Kuja kukichukua ofisini.
`;
    } else if (status === 'rejected') {
      smsMessage =
        `Habari ${rep.full_name}!
Ombi lako limekataliwa.
Nambari: ${rep.serial_number}.
Wasiliana na ofisi kwa maelezo.
`;
    }

    if (smsMessage) {
      await sendSMS(rep.phone_number, smsMessage);

      if (rep.alternative_contact) {
        await sendSMS(
          rep.alternative_contact,
          smsMessage
        );
      }
    }

    res.json({
      success: true,
      message: 'Status updated and SMS sent!'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;