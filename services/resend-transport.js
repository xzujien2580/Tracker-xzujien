const nodemailer = require('nodemailer');

function formatAddress(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatAddress);
  if (value && typeof value === 'object') {
    if (value.address) return value.name ? `${value.name} <${value.address}>` : value.address;
    return value.text || '';
  }
  return '';
}

function installResendTransport() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  // Existing auth mail code uses Nodemailer. Replace only its transport so the
  // same messages go to Resend over HTTPS when the API key is configured.
  nodemailer.createTransport = () => ({
    sendMail(message, callback) {
      const send = async () => {
        const payload = {
          from: formatAddress(process.env.RESEND_FROM || message.from || process.env.MAIL_FROM),
          to: formatAddress(message.to),
          subject: String(message.subject || ''),
          text: message.text,
          html: message.html
        };
        if (!payload.from || !payload.to || !payload.subject || (!payload.text && !payload.html)) {
          throw new Error('Resend email requires a verified sender, recipient, subject, and message body.');
        }

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `Resend returned HTTP ${response.status}.`);
        const accepted = Array.isArray(payload.to) ? payload.to : [payload.to];
        return { messageId: result.id, accepted, rejected: [], response: 'Sent with Resend HTTPS API' };
      };

      const pending = send();
      if (typeof callback === 'function') {
        pending.then(info => callback(null, info), error => callback(error));
        return;
      }
      return pending;
    },
    verify(callback) {
      const result = Promise.resolve(true);
      if (typeof callback === 'function') { result.then(value => callback(null, value)); return; }
      return result;
    },
    close() {}
  });

  // The auth route uses these variables to determine whether email delivery is
  // configured. They are sent through the HTTPS adapter above, never SMTP.
  process.env.SMTP_HOST ||= 'resend-api';
  process.env.SMTP_USER ||= 'resend-api';
  process.env.SMTP_PASS ||= apiKey;
}

module.exports = { installResendTransport };
