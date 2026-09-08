function buildCitizenStatusApplication(row) {
  return {
    serial_number: row.serial_number,
    first_name: row.first_name,
    last_name: row.last_name,
    current_status: row.current_status,
    created_at: row.created_at,
    county_name: row.county_name,
    ward_name: row.ward_name,
    appointment: row.appointment_date
      ? {
          appointment_date: row.appointment_date,
          appointment_time: row.appointment_time,
          queue_number: row.queue_number,
          status: row.appointment_status,
          office_name: row.office_name,
          office_ward_name: row.office_ward_name,
          office_county_name: row.office_county_name
        }
      : null,
    waiting_card: row.card_token
      ? {
          card_token: row.card_token,
          current_status: row.waiting_card_status,
          is_active: row.waiting_card_active,
          expires_at: row.waiting_card_expires_at
        }
      : null
  };
}

module.exports = { buildCitizenStatusApplication };
