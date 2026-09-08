const express = require('express');
const router = express.Router();
const db = require('../config/database');
const sendSMS = require('../services/sms');
const { uploadForeignerDocs } = require('../middleware/upload');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Generate serial number based on document type
async function generateForeignerSerial(documentType) {
  const year = new Date().getFullYear();
  const countResult = await db.query(
    `SELECT COUNT(*) FROM foreigner_applications
     WHERE document_type = $1`,
    [documentType]
  );
  const count = parseInt(
    countResult.rows[0].count
  ) + 1;

  let prefix;
  switch(documentType) {
    case 'alien_card':
      prefix = 'AC';
      break;
    case 'work_permit':
      prefix = 'WP';
      break;
    case 'class_g':
      prefix = 'CG';
      break;
    case 'refugee_id':
      prefix = 'RF';
      break;
    default:
      prefix = 'FN';
  }

  return `${prefix}-${year}-${String(count).padStart(5, '0')}`;
}

// POST — Submit foreigner application
router.post('/apply', async (req, res) => {
  try {
    const {
      documentType,
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      gender,
      nationality,
      countryOfBirth,
      passportNumber,
      passportExpiry,
      visaNumber,
      visaType,
      dateEnteredKenya,
      countyId,
      physicalAddress,
      yearsInKenya,
      reasonForStaying,
      employerName,
      employerAddress,
      jobTitle,
      employmentStartDate,
      organizationName,
      officialPosition,
      postingDuration,
      unhcrNumber,
      refugeeCamp,
      unhcrRegistrationDate,
      phoneNumber,
      alternativeContact,
      email
    } = req.body;

    // Check duplicate passport
    if (passportNumber) {
      const dupCheck = await db.query(
        `SELECT application_id
         FROM foreigner_applications
         WHERE passport_number = $1`,
        [passportNumber]
      );

      if (dupCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Application with this passport number already exists'
        });
      }
    }

    // Generate serial number
    const serialNumber = await generateForeignerSerial(documentType);

    // Save application
    await db.query(
      `INSERT INTO foreigner_applications
       (serial_number, document_type,
        first_name, middle_name, last_name,
        date_of_birth, gender,
        nationality, country_of_birth,
        passport_number, passport_expiry,
        visa_number, visa_type,
        date_entered_kenya,
        county_id, physical_address,
        years_in_kenya, reason_for_staying,
        employer_name, employer_address,
        job_title, employment_start_date,
        organization_name, official_position,
        posting_duration,
        unhcr_number, refugee_camp,
        unhcr_registration_date,
        phone_number, alternative_contact,
        email, current_status)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,
        $27,$28,$29,$30,$31,'submitted')`,
      [serialNumber, documentType,
       firstName, middleName, lastName,
       dateOfBirth, gender,
       nationality, countryOfBirth,
       passportNumber, passportExpiry,
       visaNumber, visaType,
       dateEnteredKenya,
       countyId, physicalAddress,
       yearsInKenya, reasonForStaying,
       employerName, employerAddress,
       jobTitle, employmentStartDate,
       organizationName, officialPosition,
       postingDuration,
       unhcrNumber, refugeeCamp,
       unhcrRegistrationDate,
       phoneNumber, alternativeContact,
       email]
    );

    // Send SMS confirmation
    await sendSMS(
      phoneNumber,
      `Hello ${firstName}!
Your application has been received.
Reference: ${serialNumber}.
Document type: ${documentType}.
We will contact you soon.
`
    );

    // Send to alternative contact
    if (alternativeContact) {
      await sendSMS(
        alternativeContact,
        `Application for ${firstName} 
${lastName} received.
Ref: ${serialNumber}.
`
      );
    }

    res.json({
      success: true,
      serialNumber: serialNumber,
      message: 'Application submitted successfully!'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST — Upload foreigner document
router.post('/upload-document/:applicationId',
uploadForeignerDocs.single('document'),
async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { docType } = req.body;
    const filePath = req.file.path;
    const applicationId = req.params.applicationId;

    // Save to foreigner_documents table
    await db.query(
      `INSERT INTO foreigner_documents
       (application_id, doc_type, file_path)
       VALUES ($1, $2, $3)`,
      [applicationId, docType, filePath]
    );

    res.json({
      success: true,
      message: 'Document uploaded successfully',
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

// GET — Check foreigner application status
router.get('/status/:serialNumber',
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         f.serial_number,
         f.document_type,
         f.first_name,
         f.last_name,
         f.nationality,
         f.passport_number,
         f.phone_number,
         f.current_status,
         f.created_at,
         c.county_name
       FROM foreigner_applications f
       LEFT JOIN counties c
         ON f.county_id = c.county_id
       WHERE f.serial_number = $1`,
      [req.params.serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Get uploaded documents
    const docs = await db.query(
      `SELECT doc_type, file_path, uploaded_at
       FROM foreigner_documents
       WHERE application_id = (
         SELECT application_id
         FROM foreigner_applications
         WHERE serial_number = $1
       )`,
      [req.params.serialNumber]
    );

    res.json({
      success: true,
      application: result.rows[0],
      documents: docs.rows
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET — Get required documents by type
router.get('/requirements/:documentType',
async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         doc_name,
         is_required,
         file_types,
         max_size_mb
       FROM document_requirements
       WHERE document_type = $1
       ORDER BY is_required DESC`,
      [req.params.documentType]
    );

    res.json({
      success: true,
      requirements: result.rows
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET — All foreigner applications
router.get('/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         f.serial_number,
         f.document_type,
         f.first_name,
         f.last_name,
         f.nationality,
         f.passport_number,
         f.phone_number,
         f.current_status,
         f.created_at,
         c.county_name
       FROM foreigner_applications f
       LEFT JOIN counties c
         ON f.county_id = c.county_id
       ORDER BY f.created_at DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      applications: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST — Update foreigner status
router.post('/update-status/:applicationId',
verifyToken, isAdmin,
async (req, res) => {
  try {
    const { status, updatedBy } = req.body;

    // Get application details for SMS
    const appResult = await db.query(
      `SELECT first_name, last_name,
              phone_number,
              alternative_contact,
              serial_number,
              document_type
       FROM foreigner_applications
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

    // Update status
    await db.query(
      `UPDATE foreigner_applications
       SET current_status = $1
       WHERE application_id = $2`,
      [status, req.params.applicationId]
    );

    // Send SMS based on status
    let smsMessage = '';

    if (status === 'approved') {
      smsMessage =
        `Hello ${app.first_name}!
Your ${app.document_type} application
has been approved.
Ref: ${app.serial_number}.
You will be contacted for
your appointment soon.
`;
    } else if (status === 'rejected') {
      smsMessage =
        `Hello ${app.first_name}!
Your ${app.document_type} application
has been rejected.
Ref: ${app.serial_number}.
Please contact the office
for more information.
`;
    } else if (status === 'additional_documents') {
      smsMessage =
        `Hello ${app.first_name}!
Additional documents required
for your application.
Ref: ${app.serial_number}.
Please visit the office.
`;
    }

    if (smsMessage) {
      await sendSMS(app.phone_number, smsMessage);

      if (app.alternative_contact) {
        await sendSMS(
          app.alternative_contact,
          smsMessage
        );
      }
    }

    res.json({
      success: true,
      message: 'Status updated successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;