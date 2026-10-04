// Pluggable outbound email for one-time codes.
//
// This is the single integration point for real email. It is OFF by default:
// with no SMTP credentials configured the app runs in dev mode and the OTP is
// shown on screen (clearly labelled), never silently "sent". Provide the env
// vars below — pointing at the sender's own domain (e.g. rojanadhikari20622.com.np)
// — and real delivery turns on with no code change:
//
//   MAIL_ENABLED=1
//   SMTP_HOST=smtp.your-provider.com     # the SMTP server for the domain
//   SMTP_PORT=587                        # 587 (STARTTLS) or 465 (implicit TLS)
//   SMTP_SECURE=0                        # 1 for implicit TLS (port 465)
//   SMTP_USER=postmaster@rojanadhikari20622.com.np
//   SMTP_PASS=••••••••
//   MAIL_FROM="nerd <no-reply@rojanadhikari20622.com.np>"
//
// Zero external dependencies: a minimal SMTP client over Node's built-in net/tls.
const net = require('net');
const tls = require('tls');

const DEFAULT_DOMAIN = 'rojanadhikari20622.com.np';

function configured() {
  return process.env.MAIL_ENABLED === '1' && !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function fromAddress() {
  return process.env.MAIL_FROM || `nerd <no-reply@${process.env.MAIL_DOMAIN || DEFAULT_DOMAIN}>`;
}

// Minimal SMTP conversation: EHLO, optional STARTTLS, AUTH LOGIN, MAIL/RCPT/DATA.
function smtpSend({ host, port, secure, user, pass, from, to, subject, text }) {
  return new Promise((resolve, reject) => {
    let sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '';
    let step = 0;
    const timer = setTimeout(() => { try { sock.destroy(); } catch { /* */ } reject(new Error('SMTP timeout')); }, 15000);
    const fromAddr = (from.match(/<([^>]+)>/) || [, from])[1];
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const write = (line) => sock.write(line + '\r\n');
    const data = [
      `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', '', text.replace(/\n\./g, '\n..'), '.',
    ].join('\r\n');
    // A compact state machine over server replies (3-digit codes).
    const steps = [
      () => write(`EHLO ${process.env.MAIL_DOMAIN || DEFAULT_DOMAIN}`),
      () => { if (!secure && Number(port) === 587) { write('STARTTLS'); } else { steps.splice(2, 1); write('AUTH LOGIN'); } },
      () => { // after STARTTLS: upgrade the socket, re-EHLO, then AUTH
        sock = tls.connect({ socket: sock, host, servername: host }, () => { write(`EHLO ${process.env.MAIL_DOMAIN || DEFAULT_DOMAIN}`); });
        attach(sock);
      },
      () => write('AUTH LOGIN'),
      () => write(b64(user)),
      () => write(b64(pass)),
      () => write(`MAIL FROM:<${fromAddr}>`),
      () => write(`RCPT TO:<${to}>`),
      () => write('DATA'),
      () => sock.write(data + '\r\n'),
      () => { write('QUIT'); clearTimeout(timer); resolve(true); },
    ];
    function onData(chunk) {
      buf += chunk.toString('utf8');
      if (!/\r\n$/.test(buf)) return;
      const code = Number(buf.slice(-5, -2) ? buf.trim().split('\r\n').pop().slice(0, 3) : 0);
      buf = '';
      if (code >= 400) { clearTimeout(timer); try { sock.destroy(); } catch { /* */ } return reject(new Error(`SMTP error ${code}`)); }
      const fn = steps[step++];
      if (fn) try { fn(); } catch (e) { clearTimeout(timer); reject(e); }
    }
    function attach(s) { s.on('data', onData); s.on('error', (e) => { clearTimeout(timer); reject(e); }); }
    attach(sock);
  });
}

// Returns { delivered, dev }: dev=true means no real send happened and the caller
// should surface the code on screen (dev mode). delivered=true means SMTP accepted it.
async function sendOtp(user, code, purpose) {
  if (!configured()) return { delivered: false, dev: true };
  const subject = purpose === 'reset' ? 'Your nerd password reset code' : 'Your nerd sign-in code';
  const text = `Hello ${user.name || ''},\n\nYour one-time ${purpose === 'reset' ? 'password reset' : 'sign-in'} code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.\n\n— nerd`;
  try {
    await smtpSend({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
      from: fromAddress(), to: user.email, subject, text,
    });
    return { delivered: true, dev: false };
  } catch (e) {
    console.error('[mail] OTP send failed:', e.message);
    return { delivered: false, dev: false, error: e.message };
  }
}

module.exports = { sendOtp, configured, fromAddress };
