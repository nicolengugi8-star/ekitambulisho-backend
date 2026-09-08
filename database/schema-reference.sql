-- Kenya ID System — schema reference (documented from live PostgreSQL, Aug 2026)
-- This file documents the existing database structure used by the backend.
-- It is not an automated migration runner.

-- Core citizen workflow
-- id_applications.current_status values used in code:
-- submitted, chief_approved, chief_rejected, biometrics_done, id_ready, id_given, id_collected

CREATE TABLE IF NOT EXISTS id_applications (
  application_id UUID PRIMARY KEY,
  serial_number VARCHAR NOT NULL,
  first_name VARCHAR NOT NULL,
  middle_name VARCHAR,
  last_name VARCHAR NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR NOT NULL,
  phone_number VARCHAR NOT NULL,
  alternative_contact VARCHAR,
  alternative_name VARCHAR,
  email VARCHAR,
  birth_cert_no VARCHAR NOT NULL,
  birth_cert_scan VARCHAR,
  father_name VARCHAR,
  father_id_no VARCHAR,
  mother_name VARCHAR,
  mother_id_no VARCHAR,
  county_id INTEGER,
  sub_county_id INTEGER,
  ward_id INTEGER,
  sub_location_id INTEGER,
  village VARCHAR,
  current_status VARCHAR,
  national_id_no VARCHAR,
  chief_deadline TIMESTAMP,
  reminder_1_sent BOOLEAN,
  reminder_2_sent BOOLEAN,
  escalated BOOLEAN,
  documents_verified BOOLEAN,
  document_notes TEXT,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_status_log (
  log_id SERIAL PRIMARY KEY,
  application_id UUID REFERENCES id_applications(application_id),
  status VARCHAR NOT NULL,
  changed_by VARCHAR,
  notes TEXT,
  changed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id SERIAL PRIMARY KEY,
  application_id UUID REFERENCES id_applications(application_id),
  office_id INTEGER REFERENCES registration_offices(office_id),
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  queue_number INTEGER NOT NULL,
  status VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS waiting_card (
  card_id UUID PRIMARY KEY,
  application_id UUID REFERENCES id_applications(application_id),
  card_token VARCHAR NOT NULL,
  current_status VARCHAR,
  is_active BOOLEAN,
  expires_at TIMESTAMP,
  verify_count INTEGER,
  created_at TIMESTAMP,
  expired_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registration_offices (
  office_id SERIAL PRIMARY KEY,
  office_name VARCHAR NOT NULL,
  office_type VARCHAR NOT NULL,
  ward_id INTEGER,
  county_id INTEGER,
  phone VARCHAR,
  daily_capacity INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMP
);

-- Admin / staff
CREATE TABLE IF NOT EXISTS admins (
  admin_id SERIAL PRIMARY KEY,
  full_name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  username VARCHAR NOT NULL,
  password_hash VARCHAR NOT NULL,
  admin_level VARCHAR,
  county_id INTEGER,
  is_active BOOLEAN,
  last_login TIMESTAMP,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chiefs (
  chief_id SERIAL PRIMARY KEY,
  full_name VARCHAR NOT NULL,
  phone VARCHAR,
  username VARCHAR NOT NULL,
  password_hash VARCHAR NOT NULL,
  ward_id INTEGER,
  county_id INTEGER,
  must_change_password BOOLEAN,
  is_active BOOLEAN,
  is_available BOOLEAN
);

CREATE TABLE IF NOT EXISTS officers (
  officer_id SERIAL PRIMARY KEY,
  full_name VARCHAR NOT NULL,
  phone VARCHAR,
  username VARCHAR NOT NULL,
  password_hash VARCHAR NOT NULL,
  office_id INTEGER REFERENCES registration_offices(office_id),
  is_active BOOLEAN
);

-- Foreigner workflow
CREATE TABLE IF NOT EXISTS foreigner_applications (
  application_id UUID PRIMARY KEY,
  serial_number VARCHAR NOT NULL,
  document_type VARCHAR NOT NULL,
  first_name VARCHAR NOT NULL,
  middle_name VARCHAR,
  last_name VARCHAR NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR NOT NULL,
  nationality VARCHAR,
  country_of_birth VARCHAR,
  passport_number VARCHAR,
  passport_expiry DATE,
  visa_number VARCHAR,
  visa_type VARCHAR,
  date_entered_kenya DATE,
  county_id INTEGER,
  physical_address VARCHAR,
  years_in_kenya INTEGER,
  reason_for_staying VARCHAR,
  employer_name VARCHAR,
  employer_address VARCHAR,
  job_title VARCHAR,
  employment_start_date DATE,
  organization_name VARCHAR,
  official_position VARCHAR,
  posting_duration VARCHAR,
  unhcr_number VARCHAR,
  refugee_camp VARCHAR,
  unhcr_registration_date DATE,
  phone_number VARCHAR NOT NULL,
  alternative_contact VARCHAR,
  email VARCHAR,
  current_status VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS foreigner_documents (
  application_id UUID,
  doc_type VARCHAR,
  file_path VARCHAR,
  uploaded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_requirements (
  document_type VARCHAR,
  doc_name VARCHAR,
  is_required BOOLEAN,
  file_types VARCHAR,
  max_size_mb INTEGER
);

-- Replacement workflow
CREATE TABLE IF NOT EXISTS id_replacements (
  replacement_id UUID PRIMARY KEY,
  serial_number VARCHAR NOT NULL,
  full_name VARCHAR NOT NULL,
  old_id_number VARCHAR,
  date_of_birth DATE NOT NULL,
  phone_number VARCHAR NOT NULL,
  alternative_contact VARCHAR,
  ward_id INTEGER,
  county_id INTEGER,
  reason VARCHAR NOT NULL,
  police_abstract VARCHAR,
  current_status VARCHAR,
  created_at TIMESTAMP
);

-- Location hierarchy
CREATE TABLE IF NOT EXISTS counties (
  county_id SERIAL PRIMARY KEY,
  county_name VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_counties (
  sub_county_id SERIAL PRIMARY KEY,
  county_id INTEGER REFERENCES counties(county_id),
  sub_county_name VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS wards (
  ward_id SERIAL PRIMARY KEY,
  sub_county_id INTEGER REFERENCES sub_counties(sub_county_id),
  ward_name VARCHAR NOT NULL
);

-- Reporting
CREATE TABLE IF NOT EXISTS chief_performance (
  chief_id INTEGER,
  date DATE,
  received INTEGER,
  approved INTEGER,
  rejected INTEGER,
  overdue INTEGER,
  UNIQUE (chief_id, date)
);

-- Officer portal API alignment (backend routes)
-- GET  /api/officer/appointments/:officeId
-- POST /api/officer/appointments/:appointmentId/biometrics-done
-- POST /api/officer/appointments/:appointmentId/id-ready
-- POST /api/officer/appointments/:appointmentId/id-given
-- POST /api/officer/appointments/:appointmentId/id-collected

-- Admin audit logs are served from application_status_log via:
-- GET /api/admin/audit-logs
