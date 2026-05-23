import { Resend } from 'resend';

let resendInstance: Resend | null = null;

/**
 * Lazily gets or initializes the Resend client using the RESEND_API_KEY environment variable.
 */
export function getResend(): Resend {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('Warning: RESEND_API_KEY is not set in environment variables.');
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

// Helper to determine the "from" address based on environment
const getFromAddress = (): string => {
  const envFrom = process.env.RESEND_FROM_EMAIL;
  if (envFrom) {
    return envFrom;
  }
  // Fallback default
  return 'Apna Ustad <onboarding@resend.dev>';
};

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
  idempotencyKey?: string;
}

/**
 * Core sendEmail wrapper that interfaces directly with the Resend SDK.
 * Follows the { data, error } returned response structure, uses camelCase parameters,
 * and handles network-level errors gracefully.
 */
export async function sendEmail(options: SendEmailOptions) {
  const from = getFromAddress();
  const { to, subject, html, text, replyTo, idempotencyKey } = options;

  // Build parameters map in strict camelCase as required by Resend Node.js SDK
  const params: any = {
    from,
    to,
    subject,
    html,
  };

  if (text) {
    params.text = text;
  }

  if (replyTo) {
    params.replyTo = replyTo;
  }

  if (idempotencyKey) {
    params.idempotencyKey = idempotencyKey;
  }

  // Network-level try-catch block for API failures (SDK doesn't throw on standard errors, it returns them)
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send(params);

    if (error) {
      console.error('Resend email sending error returned from SDK:', error);
      return { data: null, error };
    }

    console.log('Resend email sent successfully:', data);
    return { data, error: null };
  } catch (networkError: any) {
    console.error('Resend email sending encountered a network-level error:', networkError);
    return {
      data: null,
      error: {
        name: networkError.name || 'NetworkError',
        message: networkError.message || 'Failed to send request to Resend API.',
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APNA USTAD — COSMIC EMAIL DESIGN SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
// App Colors: Background #050510 | Cyan #00F5FF | Purple #BF5AF2 | Gold #C9A84C
// Logo CDN: https://ik.imagekit.io/2cavxfiex/app-assets/apnaustad_logo_yhkfXtyz0.jpeg
// ─────────────────────────────────────────────────────────────────────────────

const LOGO_URL = 'https://ik.imagekit.io/2cavxfiex/app-assets/apnaustad_logo_yhkfXtyz0.jpeg';

/**
 * Shared cosmic email shell — wraps all templates in the dark branded layout.
 * Renders: outer deep-navy page → card → top gradient header → content slot → footer.
 */
function cosmicShell({
  headerGradient,
  headerBadgeBorder,
  headerBadgeGlow,
  statusLabel,
  statusLabelColor,
  title,
  content,
  footerNote,
}: {
  headerGradient: string;
  headerBadgeBorder: string;
  headerBadgeGlow: string;
  statusLabel: string;
  statusLabelColor: string;
  title: string;
  content: string;
  footerNote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Apna Ustad</title>
</head>
<body style="margin:0;padding:0;background-color:#030310;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <!-- Page wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#030310;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Email card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:24px;overflow:hidden;border:1px solid rgba(0,245,255,0.12);box-shadow:0 0 60px rgba(0,245,255,0.06),0 30px 60px rgba(0,0,0,0.6);">

          <!-- ── HEADER ── -->
          <tr>
            <td style="background:${headerGradient};padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <!-- Star-field decoration row -->
                <tr>
                  <td style="padding:28px 32px 0 32px;text-align:right;">
                    <span style="font-size:8px;color:rgba(255,255,255,0.25);letter-spacing:3px;text-transform:uppercase;font-weight:700;">APNA USTAD · EXPERT SERVICES</span>
                  </td>
                </tr>
                <!-- Logo + Title -->
                <tr>
                  <td style="padding:16px 32px 32px 32px;text-align:center;">
                    <!-- Logo badge with glow ring -->
                    <div style="display:inline-block;position:relative;margin-bottom:20px;">
                      <div style="width:88px;height:88px;border-radius:22px;border:2px solid ${headerBadgeBorder};box-shadow:0 0 24px ${headerBadgeGlow},0 0 0 6px rgba(255,255,255,0.04);overflow:hidden;display:inline-block;">
                        <img src="${LOGO_URL}" alt="Apna Ustad" width="88" height="88" style="display:block;width:88px;height:88px;object-fit:cover;" />
                      </div>
                    </div>
                    <br/>
                    <!-- Status pill -->
                    <div style="display:inline-block;background:rgba(0,0,0,0.25);border:1px solid ${headerBadgeBorder};border-radius:999px;padding:4px 14px;margin-bottom:14px;">
                      <span style="font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:${statusLabelColor};">${statusLabel}</span>
                    </div>
                    <br/>
                    <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">${title}</h1>
                  </td>
                </tr>
                <!-- Separator line -->
                <tr>
                  <td style="padding:0;">
                    <div style="height:1px;background:linear-gradient(90deg,transparent,${headerBadgeBorder},transparent);opacity:0.6;"></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td style="background-color:#0A0A1F;padding:36px 40px;">
              ${content}
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="background-color:#050510;border-top:1px solid rgba(0,245,255,0.08);padding:24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <img src="${LOGO_URL}" alt="Apna Ustad" width="32" height="32" style="display:inline-block;border-radius:8px;opacity:0.7;vertical-align:middle;margin-right:8px;" />
                    <span style="font-size:13px;font-weight:700;color:#00F5FF;letter-spacing:1px;vertical-align:middle;">APNA USTAD</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:10px;">
                    <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:0.5px;">${footerNote}</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:8px;">
                    <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:2px;text-transform:uppercase;">The Service Galaxy · sardarhussain.me</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

/** Shared body text style for dark background */
const bodyText = 'font-size:15px;color:rgba(255,255,255,0.8);line-height:1.7;margin:0 0 16px 0;';
const mutedText = 'font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6;margin:0;';
const labelStyle = 'font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#00F5FF;margin:0 0 8px 0;';

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 1 — USER SUPPORT CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a confirmation email to the user who submitted a support request.
 */
export async function sendSupportRequestConfirmation(
  userEmail: string,
  userName: string,
  topic: string,
  message: string,
  requestId: string
) {
  const subject = `✅ Support Request Received — Apna Ustad`;

  // Ticket ID character boxes — same style as OTP digit tiles (cyan)
  const confirmIdChars = requestId.split('').map(c =>
    `<td style="padding:0 3px;"><div style="min-width:20px;height:32px;line-height:32px;text-align:center;font-size:13px;font-weight:900;color:#00F5FF;background:rgba(0,245,255,0.06);border:1px solid rgba(0,245,255,0.25);border-radius:8px;padding:0 7px;font-family:'SF Mono','Fira Code',monospace;">${c}</div></td>`
  ).join('');

  const content = `
    <p style="${bodyText}">Hello <strong style="color:#ffffff;">${userName}</strong>,</p>
    <p style="${bodyText}">Your support request has entered our queue. Our expert team is reviewing it and will respond shortly. You are in good hands.</p>

    <!-- Ticket ID display — character tiles like OTP -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="border-radius:16px;overflow:hidden;background:linear-gradient(135deg,rgba(0,245,255,0.08),rgba(191,90,242,0.06));border:1px solid rgba(0,245,255,0.2);padding:22px 28px;display:inline-table;">
            <tr><td align="center"><p style="margin:0 0 12px 0;font-size:10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:rgba(0,245,255,0.6);">Ticket ID</p></td></tr>
            <tr><td align="center"><table cellpadding="0" cellspacing="0" border="0"><tr>${confirmIdChars}</tr></table></td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Topic + Message card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-radius:16px;overflow:hidden;border:1px solid rgba(0,245,255,0.12);background:rgba(0,245,255,0.03);">
      <tr>
        <td style="padding:18px 24px;border-bottom:1px solid rgba(0,245,255,0.08);">
          <p style="margin:0 0 4px 0;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(0,245,255,0.5);">Topic</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:rgba(255,255,255,0.9);">${topic}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 24px;">
          <p style="margin:0 0 10px 0;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(0,245,255,0.5);">Your Message</p>
          <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.65);line-height:1.7;font-style:italic;padding:14px;background:rgba(0,0,0,0.3);border-radius:10px;border-left:3px solid #00F5FF;">"${message}"</p>
        </td>
      </tr>
    </table>

    <!-- Response timeline -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px 0;border-radius:12px;background:rgba(0,245,255,0.05);border:1px solid rgba(0,245,255,0.1);">
      <tr>
        <td style="padding:16px 20px;">
          <p style="${labelStyle}">⏱ Expected Response Time</p>
          <p style="margin:0;font-size:22px;font-weight:900;color:#00F5FF;">Within 24 Hours</p>
          <p style="margin:6px 0 0 0;font-size:12px;color:rgba(255,255,255,0.4);">Track updates in your Apna Ustad app</p>
        </td>
      </tr>
    </table>

    <p style="margin-top:20px;${mutedText}">If your issue is urgent, please open the Apna Ustad app and navigate to Support to follow up directly.</p>
  `;

  const html = cosmicShell({
    headerGradient: 'linear-gradient(160deg, #0A0A2E 0%, #0D1B4B 50%, #050510 100%)',
    headerBadgeBorder: 'rgba(0,245,255,0.5)',
    headerBadgeGlow: 'rgba(0,245,255,0.3)',
    statusLabel: '✦ Request Confirmed',
    statusLabelColor: '#00F5FF',
    title: 'We\'ve Got Your Back',
    content,
    footerNote: 'This is an automated notification. Please do not reply to this email.',
  });

  return sendEmail({
    to: userEmail,
    subject,
    html,
    idempotencyKey: `support-confirm/${requestId}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 2 — ADMIN NEW TICKET ALERT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends an email notification to the Admin of new support requests.
 */
export async function sendSupportRequestAdminAlert(
  userName: string,
  userEmail: string,
  topic: string,
  message: string,
  requestId: string
) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@apnaustad.com';
  const subject = `🚨 New Support Ticket · ${topic}`;

  // Ticket ID character boxes — same style as OTP digit tiles (purple for admin)
  const adminIdChars = requestId.split('').map(c =>
    `<td style="padding:0 3px;"><div style="min-width:20px;height:32px;line-height:32px;text-align:center;font-size:13px;font-weight:900;color:#BF5AF2;background:rgba(191,90,242,0.06);border:1px solid rgba(191,90,242,0.25);border-radius:8px;padding:0 7px;font-family:'SF Mono','Fira Code',monospace;">${c}</div></td>`
  ).join('');

  const content = `
    <p style="${bodyText}">A new support inquiry has been submitted through the Apna Ustad platform. Review the details below and respond promptly.</p>

    <!-- Alert badge -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;border-radius:12px;background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.3);">
      <tr>
        <td style="padding:14px 20px;">
          <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#FF3B30;">⚡ Action Required — New Ticket</p>
        </td>
      </tr>
    </table>

    <!-- Ticket ID display — character tiles like OTP (purple) -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="border-radius:16px;overflow:hidden;background:linear-gradient(135deg,rgba(191,90,242,0.08),rgba(0,245,255,0.04));border:1px solid rgba(191,90,242,0.2);padding:22px 28px;display:inline-table;">
            <tr><td align="center"><p style="margin:0 0 12px 0;font-size:10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:rgba(191,90,242,0.7);">Ticket ID</p></td></tr>
            <tr><td align="center"><table cellpadding="0" cellspacing="0" border="0"><tr>${adminIdChars}</tr></table></td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- User info card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-radius:16px;overflow:hidden;border:1px solid rgba(191,90,242,0.15);background:rgba(191,90,242,0.03);">
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid rgba(191,90,242,0.1);">
          <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#BF5AF2;">User Information</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:7px 0;width:30%;font-size:11px;color:rgba(255,255,255,0.4);font-weight:700;letter-spacing:0.8px;text-transform:uppercase;vertical-align:top;">Name</td>
              <td style="padding:7px 0;font-size:14px;color:rgba(255,255,255,0.9);font-weight:600;">${userName}</td>
            </tr>
            <tr>
              <td style="padding:7px 0;font-size:11px;color:rgba(255,255,255,0.4);font-weight:700;letter-spacing:0.8px;text-transform:uppercase;vertical-align:top;">Email</td>
              <td style="padding:7px 0;"><a href="mailto:${userEmail}" style="font-size:14px;color:#00F5FF;text-decoration:none;font-weight:600;">${userEmail || 'Not Provided'}</a></td>
            </tr>
            <tr>
              <td style="padding:7px 0;font-size:11px;color:rgba(255,255,255,0.4);font-weight:700;letter-spacing:0.8px;text-transform:uppercase;vertical-align:top;">Topic</td>
              <td style="padding:7px 0;font-size:14px;color:rgba(255,255,255,0.9);font-weight:600;">${topic}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Message block -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:14px;overflow:hidden;border:1px solid rgba(255,59,48,0.2);">
      <tr>
        <td style="background:rgba(255,59,48,0.06);padding:14px 24px;border-bottom:1px solid rgba(255,59,48,0.12);">
          <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#FF3B30;">📨 User Message</p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;background:rgba(0,0,0,0.2);">
          <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);line-height:1.7;font-style:italic;padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;border-left:3px solid #FF3B30;">"${message}"</p>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0 0;${mutedText}">Log into the admin panel to respond to this ticket. Prompt responses improve user trust.</p>
  `;

  const html = cosmicShell({
    headerGradient: 'linear-gradient(160deg, #1A0508 0%, #2D0B0E 50%, #050510 100%)',
    headerBadgeBorder: 'rgba(255,59,48,0.5)',
    headerBadgeGlow: 'rgba(255,59,48,0.25)',
    statusLabel: '🚨 Admin Alert',
    statusLabelColor: '#FF6B6B',
    title: 'New Support Ticket',
    content,
    footerNote: 'Apna Ustad Admin Notification System',
  });

  return sendEmail({
    to: adminEmail,
    subject,
    html,
    idempotencyKey: `support-admin-alert/${requestId}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 3 — USER SUPPORT REPLY NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a notification email to the user when the admin replies to their support request.
 */
export async function sendSupportReplyNotification(
  userEmail: string,
  userName: string,
  originalMessage: string,
  adminReply: string,
  replyId: string
) {
  const subject = `💬 Our Team Has Replied — Apna Ustad`;

  const content = `
    <p style="${bodyText}">Hello <strong style="color:#ffffff;">${userName}</strong>,</p>
    <p style="${bodyText}">Great news — the Apna Ustad support team has reviewed your ticket and posted a response. Check it out below.</p>

    <!-- Support response — hero card matching OTP digit display card style -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,rgba(52,199,89,0.08),rgba(0,245,255,0.04));border:1px solid rgba(52,199,89,0.2);">
            <tr>
              <td style="padding:14px 24px;border-bottom:1px solid rgba(52,199,89,0.12);">
                <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:rgba(52,199,89,0.7);">✦ Support Team Response</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.9);line-height:1.75;font-weight:500;">${adminReply}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Original message context -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid rgba(255,255,255,0.05);">
          <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.25);">Your Original Message</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.7;font-style:italic;padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;border-left:3px solid rgba(255,255,255,0.1);">"${originalMessage}"</p>
        </td>
      </tr>
    </table>

    <!-- CTA prompt -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:12px;background:linear-gradient(135deg,rgba(0,245,255,0.06),rgba(191,90,242,0.06));border:1px solid rgba(0,245,255,0.1);">
      <tr>
        <td style="padding:18px 24px;">
          <p style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:rgba(255,255,255,0.7);">Need to follow up?</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.4);">Open your Apna Ustad app → Support → Your Ticket to continue the conversation.</p>
        </td>
      </tr>
    </table>
  `;

  const html = cosmicShell({
    headerGradient: 'linear-gradient(160deg, #051A0D 0%, #092914 50%, #050510 100%)',
    headerBadgeBorder: 'rgba(52,199,89,0.5)',
    headerBadgeGlow: 'rgba(52,199,89,0.25)',
    statusLabel: '✓ Ticket Updated',
    statusLabelColor: '#34C759',
    title: 'Support Has Replied',
    content,
    footerNote: 'This is an automated notification. Please do not reply to this email.',
  });

  return sendEmail({
    to: userEmail,
    subject,
    html,
    idempotencyKey: `support-reply/${replyId}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 4 — REGISTRATION OTP VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a registration OTP email to the user.
 */
export async function sendOTPEmail(
  userEmail: string,
  otpCode: string
) {
  const subject = `Apna Ustad - Your Verification Code`;

  // Split OTP digits for individual styling
  const digits = otpCode.split('').map(d =>
    `<td style="padding:0 5px;"><div style="width:44px;height:56px;line-height:56px;text-align:center;font-size:28px;font-weight:900;color:#00F5FF;background:rgba(0,245,255,0.06);border:1px solid rgba(0,245,255,0.25);border-radius:12px;font-family:'SF Mono','Fira Code',monospace;">${d}</div></td>`
  ).join('');

  const content = `
    <p style="${bodyText}">Hello, welcome to the <strong style="color:#ffffff;">Apna Ustad</strong> galaxy.</p>
    <p style="${bodyText}">Use the verification code below to confirm your email and launch your journey. This code expires in <strong style="color:#00F5FF;">10 minutes</strong>.</p>

    <!-- OTP digit display -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="border-radius:16px;overflow:hidden;background:linear-gradient(135deg,rgba(0,245,255,0.08),rgba(191,90,242,0.08));border:1px solid rgba(0,245,255,0.2);padding:28px 32px;display:inline-table;">
            <tr>
              <td align="center">
                <p style="margin:0 0 16px 0;font-size:10px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:rgba(0,245,255,0.6);">Verification Code</p>
              </td>
            </tr>
            <tr>
              <td align="center">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>${digits}</tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:18px;">
                <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1px;">⏱ &nbsp;EXPIRES IN 10 MINUTES</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>


    <!-- Security notice -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;border-radius:12px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#C9A84C;">🔒 Security Notice</p>
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6;">Never share this code with anyone. Apna Ustad will never ask for your verification code via phone or chat.</p>
        </td>
      </tr>
    </table>

    <p style="margin-top:20px;${mutedText}">Didn't request this? You can safely ignore this email. Your account will not be created without completing verification.</p>
  `;

  const html = cosmicShell({
    headerGradient: 'linear-gradient(160deg, #06060F 0%, #0A0A2E 40%, #12072A 100%)',
    headerBadgeBorder: 'rgba(0,245,255,0.5)',
    headerBadgeGlow: 'rgba(0,245,255,0.3)',
    statusLabel: '⬡ Identity Verification',
    statusLabelColor: '#00F5FF',
    title: 'Verify Your Account',
    content,
    footerNote: 'This is an automated security email. Do not reply.',
  });

  return sendEmail({
    to: userEmail,
    subject,
    html,
    idempotencyKey: `email-otp/${userEmail}/${otpCode}`,
  });
}


