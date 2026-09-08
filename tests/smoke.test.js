const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseCorsOrigins } = require('../utils/cors');
const {
  buildCitizenStatusApplication
} = require('../utils/citizenStatus');

test('parseCorsOrigins uses localhost default when unset', () => {
  assert.deepEqual(parseCorsOrigins(undefined), ['http://localhost:3000']);
  assert.deepEqual(parseCorsOrigins(''), ['http://localhost:3000']);
});

test('parseCorsOrigins supports comma-separated values', () => {
  assert.deepEqual(
    parseCorsOrigins('http://localhost:3000, https://app.example.com '),
    ['http://localhost:3000', 'https://app.example.com']
  );
});

test('buildCitizenStatusApplication excludes sensitive fields', () => {
  const application = buildCitizenStatusApplication({
    serial_number: 'KE-2026-00001',
    first_name: 'Jane',
    last_name: 'Doe',
    phone_number: '0712345678',
    national_id_no: '12345678',
    birth_cert_scan: './uploads/birth-certificates/secret.pdf',
    current_status: 'chief_approved',
    created_at: '2026-01-01T00:00:00.000Z',
    county_name: 'Nairobi',
    ward_name: 'Kitisuru',
    appointment_date: '2026-01-02',
    appointment_time: '09:00:00',
    queue_number: 1,
    appointment_status: 'scheduled',
    office_name: 'Kitisuru Registration Office',
    office_ward_name: 'Kitisuru',
    office_county_name: 'Nairobi',
    card_token: 'ABCD1234',
    waiting_card_status: 'active',
    waiting_card_active: true,
    waiting_card_expires_at: '2026-04-01T00:00:00.000Z'
  });

  assert.equal(application.serial_number, 'KE-2026-00001');
  assert.equal(application.current_status, 'chief_approved');
  assert.ok(application.appointment);
  assert.ok(application.waiting_card);
  assert.equal('phone_number' in application, false);
  assert.equal('national_id_no' in application, false);
  assert.equal('birth_cert_scan' in application, false);
});

test('sendSMS skips Africa\'s Talking when SMS_DISABLED=true', async () => {
  const previous = process.env.SMS_DISABLED;
  process.env.SMS_DISABLED = 'true';

  delete require.cache[require.resolve('../services/sms')];
  const sendSMS = require('../services/sms');

  const result = await sendSMS('0712345678', 'Test message');
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);

  process.env.SMS_DISABLED = previous;
  delete require.cache[require.resolve('../services/sms')];
});

function readRouteSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('replacement admin routes require verifyToken and isAdmin', () => {
  const source = readRouteSource('routes/replacements.js');
  assert.match(source, /router\.get\('\/all', verifyToken, isAdmin/);
  assert.match(
    source,
    /router\.post\('\/update-status\/:replacementId',\s*\nverifyToken, isAdmin,/
  );
});

test('foreigner admin routes require verifyToken and isAdmin', () => {
  const source = readRouteSource('routes/foreigners.js');
  assert.match(source, /router\.get\('\/all', verifyToken, isAdmin/);
  assert.match(
    source,
    /router\.post\('\/update-status\/:applicationId',\s*\nverifyToken, isAdmin,/
  );
});

test('birth certificate upload requires admin auth', () => {
  const source = readRouteSource('routes/citizen.js');
  assert.match(
    source,
    /router\.post\('\/upload-birth-cert\/:applicationId',\s*\nverifyToken, isAdmin,/
  );
});

test('.env is ignored by git', () => {
  const backendGitignore = fs.readFileSync(
    path.join(__dirname, '..', '.gitignore'),
    'utf8'
  );
  assert.match(backendGitignore, /^\.env$/m);

  const frontendGitignore = fs.readFileSync(
    path.join(__dirname, '..', '..', 'ekitambulisho-frontend', '.gitignore'),
    'utf8'
  );
  assert.match(frontendGitignore, /^\.env$/m);
});
