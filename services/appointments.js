const crypto = require('crypto');

const db = require('../config/database');

const sendSMS = require('./sms');



function queryExecutor(client) {

  return (text, params) => (client || db).query(text, params);

}



function formatAppointmentDate(dateValue) {

  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);

  if (Number.isNaN(d.getTime())) {

    return String(dateValue);

  }

  return d.toLocaleDateString('en-KE', {

    weekday: 'long',

    day: 'numeric',

    month: 'long',

    year: 'numeric'

  });

}



function formatAppointmentTime(timeValue) {

  return String(timeValue).slice(0, 5);

}



function formatOfficeLocation(office) {

  return [office.office_name, office.ward_name, office.county_name]

    .filter(Boolean)

    .join(', ');

}



function buildApplicantAppointmentSms({

  firstName,

  serialNumber,

  appointmentDate,

  appointmentTime,

  queueNumber,

  office

}) {

  const date = formatAppointmentDate(appointmentDate);

  const time = formatAppointmentTime(appointmentTime);

  const location = formatOfficeLocation(office);



  return `Habari ${firstName}!

Ombi lako limeidhinishwa.

Nambari: ${serialNumber}.

Miadi yako: ${date} saa ${time}, foleni ${queueNumber}.

Ofisi: ${location}.`;

}



function buildAlternativeContactAppointmentSms({

  firstName,

  lastName,

  serialNumber,

  appointmentDate,

  appointmentTime,

  queueNumber,

  office

}) {

  const date = formatAppointmentDate(appointmentDate);

  const time = formatAppointmentTime(appointmentTime);

  const location = formatOfficeLocation(office);



  return `Ombi la kitambulisho la ${firstName} ${lastName} limeidhinishwa.

Ref: ${serialNumber}.

Miadi: ${date} saa ${time}, foleni ${queueNumber}.

Ofisi: ${location}.`;

}



async function findRegistrationOffice(wardId, countyId, client = null) {

  const q = queryExecutor(client);



  const wardMatch = await q(

    `SELECT ro.office_id, ro.office_name, ro.daily_capacity,

            w.ward_name, c.county_name

     FROM registration_offices ro

     LEFT JOIN wards w ON ro.ward_id = w.ward_id

     LEFT JOIN counties c ON ro.county_id = c.county_id

     WHERE ro.ward_id = $1

     AND (ro.is_active IS NULL OR ro.is_active = TRUE)

     ORDER BY ro.office_id

     LIMIT 1`,

    [wardId]

  );



  if (wardMatch.rows.length > 0) {

    return wardMatch.rows[0];

  }



  const countyMatch = await q(

    `SELECT ro.office_id, ro.office_name, ro.daily_capacity,

            w.ward_name, c.county_name

     FROM registration_offices ro

     LEFT JOIN wards w ON ro.ward_id = w.ward_id

     LEFT JOIN counties c ON ro.county_id = c.county_id

     WHERE ro.county_id = $1

     AND (ro.is_active IS NULL OR ro.is_active = TRUE)

     ORDER BY ro.office_id

     LIMIT 1`,

    [countyId]

  );



  return countyMatch.rows[0] || null;

}



async function createWaitingCard(applicationId, client = null) {

  const q = queryExecutor(client);

  const cardToken = crypto.randomBytes(16).toString('hex').toUpperCase();



  await q(

    `INSERT INTO waiting_card

     (card_id, application_id, card_token, current_status, is_active, expires_at)

     VALUES ($1, $2, $3, 'active', TRUE, NOW() + INTERVAL '90 days')`,

    [crypto.randomUUID(), applicationId, cardToken]

  );



  return cardToken;

}



async function scheduleAppointmentAfterApproval(applicationId, options = {}) {

  const { client = null, skipSms = false } = options;

  const q = queryExecutor(client);



  const appResult = await q(

    `SELECT application_id, ward_id, county_id, serial_number,

            first_name, phone_number

     FROM id_applications

     WHERE application_id = $1`,

    [applicationId]

  );



  if (appResult.rows.length === 0) {

    throw new Error('Application not found');

  }



  const app = appResult.rows[0];



  const existingAppointment = await q(

    `SELECT appointment_id, appointment_date, appointment_time,

            queue_number, office_id

     FROM appointments

     WHERE application_id = $1

     LIMIT 1`,

    [applicationId]

  );



  const existingCard = await q(

    `SELECT card_id

     FROM waiting_card

     WHERE application_id = $1

     AND is_active = TRUE

     LIMIT 1`,

    [applicationId]

  );



  if (existingAppointment.rows.length > 0 && existingCard.rows.length > 0) {

    return {

      alreadyScheduled: true,

      appointmentId: existingAppointment.rows[0].appointment_id

    };

  }



  let appointment;

  let office;



  if (existingAppointment.rows.length > 0) {

    appointment = existingAppointment.rows[0];

    office = await findRegistrationOffice(app.ward_id, app.county_id, client);

    if (!office) {

      const officeLookup = await q(

        `SELECT ro.office_id, ro.office_name, ro.daily_capacity,

                w.ward_name, c.county_name

         FROM registration_offices ro

         LEFT JOIN wards w ON ro.ward_id = w.ward_id

         LEFT JOIN counties c ON ro.county_id = c.county_id

         WHERE ro.office_id = $1`,

        [appointment.office_id]

      );

      office = officeLookup.rows[0] || null;

    }



    await createWaitingCard(applicationId, client);



    if (!skipSms && office) {

      await sendSMS(

        app.phone_number,

        buildApplicantAppointmentSms({

          firstName: app.first_name,

          serialNumber: app.serial_number,

          appointmentDate: appointment.appointment_date,

          appointmentTime: appointment.appointment_time,

          queueNumber: appointment.queue_number,

          office

        })

      );

    }



    return {

      scheduled: true,

      repaired: true,

      appointmentId: appointment.appointment_id,

      appointmentDate: appointment.appointment_date,

      appointmentTime: appointment.appointment_time,

      queueNumber: appointment.queue_number,

      officeId: appointment.office_id,

      officeName: office?.office_name,

      officeLocation: office ? formatOfficeLocation(office) : null,

      office

    };

  }



  office = await findRegistrationOffice(app.ward_id, app.county_id, client);

  if (!office) {

    console.log(

      `No registration office found for application ${applicationId} (ward ${app.ward_id})`

    );

    return { scheduled: false, reason: 'no_office' };

  }



  const queueResult = await q(

    `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue

     FROM appointments

     WHERE office_id = $1

     AND appointment_date = CURRENT_DATE`,

    [office.office_id]

  );



  const queueNumber = parseInt(queueResult.rows[0].next_queue, 10);

  const baseMinutes = 9 * 60 + (queueNumber - 1) * 15;

  const hours = Math.floor(baseMinutes / 60);

  const minutes = baseMinutes % 60;

  const appointmentTime =

    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;



  const appointmentInsert = await q(

    `INSERT INTO appointments

     (application_id, office_id, appointment_date,

      appointment_time, queue_number, status)

     VALUES ($1, $2, CURRENT_DATE, $3, $4, 'scheduled')

     RETURNING appointment_id, appointment_date, appointment_time, queue_number, office_id`,

    [applicationId, office.office_id, appointmentTime, queueNumber]

  );



  appointment = appointmentInsert.rows[0];

  await createWaitingCard(applicationId, client);



  if (!skipSms) {

    await sendSMS(

      app.phone_number,

      buildApplicantAppointmentSms({

        firstName: app.first_name,

        serialNumber: app.serial_number,

        appointmentDate: appointment.appointment_date,

        appointmentTime: appointment.appointment_time,

        queueNumber: appointment.queue_number,

        office

      })

    );

  }



  return {

    scheduled: true,

    appointmentId: appointment.appointment_id,

    appointmentDate: appointment.appointment_date,

    appointmentTime: appointment.appointment_time,

    queueNumber: appointment.queue_number,

    officeId: appointment.office_id,

    officeName: office.office_name,

    officeLocation: formatOfficeLocation(office),

    office

  };

}



async function scheduleOrphanedChiefApprovedApplications() {

  const orphans = await db.query(

    `SELECT a.application_id

     FROM id_applications a

     LEFT JOIN appointments ap ON ap.application_id = a.application_id

     WHERE a.current_status = 'chief_approved'

     AND ap.appointment_id IS NULL

     ORDER BY a.application_id`

  );



  let scheduled = 0;

  let skipped = 0;

  let failed = 0;



  for (const row of orphans.rows) {

    try {

      const result = await scheduleAppointmentAfterApproval(row.application_id);

      if (result.scheduled || result.alreadyScheduled) {

        scheduled += 1;

      } else {

        skipped += 1;

      }

    } catch (error) {

      failed += 1;

      console.log(

        `Orphan scheduling failed for application ${row.application_id}:`,

        error.message

      );

    }

  }



  return {

    total: orphans.rows.length,

    scheduled,

    skipped,

    failed

  };

}



async function getAppointmentContext(appointmentId) {

  const result = await db.query(

    `SELECT

       ap.appointment_id,

       ap.application_id,

       ap.office_id,

       ap.status AS appointment_status,

       a.current_status,

       a.serial_number,

       a.first_name,

       a.last_name

     FROM appointments ap

     JOIN id_applications a

       ON ap.application_id = a.application_id

     WHERE ap.appointment_id = $1`,

    [appointmentId]

  );



  return result.rows[0] || null;

}



module.exports = {

  scheduleAppointmentAfterApproval,

  scheduleOrphanedChiefApprovedApplications,

  findRegistrationOffice,

  getAppointmentContext,

  buildApplicantAppointmentSms,

  buildAlternativeContactAppointmentSms

};

