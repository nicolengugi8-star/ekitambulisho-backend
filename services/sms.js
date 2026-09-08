require('dotenv').config();

const AfricasTalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

const sms = AfricasTalking.SMS;

// Convert 07... to +254...
function formatPhone(phone) {
  if (!phone) return null;
  phone = phone.toString().trim();
  if (phone.startsWith('0')) {
    return '+254' + phone.substring(1);
  }
  if (phone.startsWith('254')) {
    return '+' + phone;
  }
  return phone;
}

function isSmsDisabled() {
  return String(process.env.SMS_DISABLED || '').toLowerCase() === 'true';
}

async function sendSMS(phoneNumber, message) {
  try {
    const formattedPhone = formatPhone(phoneNumber);

    if (!formattedPhone) {
      console.log('❌ No phone number provided');
      return { success: false };
    }

    if (isSmsDisabled()) {
      console.log('ℹ️ SMS skipped (SMS_DISABLED=true):', formattedPhone);
      return { success: true, skipped: true };
    }

    const result = await sms.send({
      to: [formattedPhone],
      message: message
    });

    console.log('✅ SMS sent to:', formattedPhone);
    console.log('Result:', JSON.stringify(result));
    return { success: true, result };

  } catch (error) {
    console.log('❌ SMS failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = sendSMS;
module.exports.isSmsDisabled = isSmsDisabled;