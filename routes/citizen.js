const express = require('express');
const router = express.Router();
const db = require('../config/database');
const sendSMS = require('../services/sms');
const { uploadBirthCert } = require('../middleware/upload');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { buildCitizenStatusApplication } = require('../utils/citizenStatus');

// Generate serial number
async function generateSerial() {
  const year = new Date().getFullYear();
  const countResult = await db.query(
    'SELECT COUNT(*) FROM id_applications'
  );
  const count = parseInt(
    countResult.rows[0].count
  ) + 1;
  return `KE-${year}-${String(count).padStart(5, '0')}`;
}

// POST — Submit citizen application
router.post('/apply', async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      gender,
      phoneNumber,
      alternativeContact,
      alternativeName,
      email,
      birthCertNo,
      fatherName,
      fatherIdNo,
      motherName,
      motherIdNo,
      countyId,
      subCountyId,
      wardId,
      village
    } = req.body;

    // Check duplicate birth certificate
    const certCheck = await db.query(
      `SELECT application_id 
       FROM id_applications
       WHERE birth_cert_no = $1`,
      [birthCertNo]
    );

    if (certCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Application with this birth certificate already exists'
      });
    }

    // Check duplicate phone
    const phoneCheck = await db.query(
      `SELECT application_id 
       FROM id_applications
       WHERE phone_number = $1`,
      [phoneNumber]
    );

    if (phoneCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This phone number already has an application'
      });
    }

    // Generate serial number
    const serialNumber = await generateSerial();

    // Save application
    await db.query(
      `INSERT INTO id_applications
       (serial_number, first_name, middle_name,
        last_name, date_of_birth, gender,
        phone_number, alternative_contact,
        alternative_name, email,
        birth_cert_no, father_name,
        father_id_no, mother_name, mother_id_no,
        county_id, sub_county_id, ward_id,
        village, current_status)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,'submitted')`,
      [serialNumber, firstName, middleName,
       lastName, dateOfBirth, gender,
       phoneNumber, alternativeContact,
       alternativeName, email,
       birthCertNo, fatherName,
       fatherIdNo, motherName, motherIdNo,
       countyId, subCountyId, wardId,
       village]
    );

    // Log status
    await db.query(
      `INSERT INTO application_status_log
       (application_id, status, changed_by)
       SELECT application_id, 
              'submitted', 'citizen'
       FROM id_applications
       WHERE serial_number = $1`,
      [serialNumber]
    );

    // Send SMS to citizen
    await sendSMS(
      phoneNumber,
      `Habari ${firstName}! 
Ombi lako la kitambulisho 
limepokelewa.
Nambari yako: ${serialNumber}.
Subiri idhini ya Mwenyekiti.
`
    );

    // Send SMS to alternative contact
    if (alternativeContact) {
      await sendSMS(
        alternativeContact,
        `Ombi la kitambulisho la 
${firstName} ${lastName} limepokelewa.
Nambari: ${serialNumber}.
`
      );
    }

    res.json({
      success: true,
      serialNumber: serialNumber,
      message: 'Application submitted successfully! SMS confirmation sent.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST — Upload birth certificate
router.post('/upload-birth-cert/:applicationId',
verifyToken, isAdmin,
uploadBirthCert.single('birthCertificate'),
async (req, res) => {
  try {

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const filePath = req.file.path;
    const applicationId = req.params.applicationId;

    // Save file path to database
    await db.query(
      `UPDATE id_applications
       SET birth_cert_scan = $1
       WHERE application_id = $2`,
      [filePath, applicationId]
    );

    res.json({
      success: true,
      message: 'Birth certificate uploaded successfully',
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

// GET — Check application status
router.get('/status/:serialNumber',
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         a.serial_number,
         a.first_name,
         a.last_name,
         a.current_status,
         a.created_at,
         c.county_name,
         w.ward_name,
         ap.appointment_date,
         ap.appointment_time,
         ap.queue_number,
         ap.status AS appointment_status,
         ro.office_name,
         ow.ward_name AS office_ward_name,
         oc.county_name AS office_county_name,
         wc.card_token,
         wc.current_status AS waiting_card_status,
         wc.is_active AS waiting_card_active,
         wc.expires_at AS waiting_card_expires_at
       FROM id_applications a
       JOIN counties c
         ON a.county_id = c.county_id
       JOIN wards w
         ON a.ward_id = w.ward_id
       LEFT JOIN appointments ap
         ON ap.application_id = a.application_id
       LEFT JOIN registration_offices ro
         ON ap.office_id = ro.office_id
       LEFT JOIN wards ow
         ON ro.ward_id = ow.ward_id
       LEFT JOIN counties oc
         ON ro.county_id = oc.county_id
       LEFT JOIN waiting_card wc
         ON wc.application_id = a.application_id
         AND wc.is_active = TRUE
       WHERE a.serial_number = $1`,
      [req.params.serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const application = buildCitizenStatusApplication(result.rows[0]);

    res.json({
      success: true,
      application
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;