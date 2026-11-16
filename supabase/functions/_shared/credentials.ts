import { SupabaseClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

export const DEFAULT_DASHBOARD_URL = "https://dashboard.extension.zenlow.co";

/**
 * Generates a cryptographically strong, 14-character password
 * avoiding easily confused characters (like 0/O, 1/l/I).
 */
export function generateSecurePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;

  const getRandom = (charset: string) => {
    const arr = new Uint8Array(1);
    crypto.getRandomValues(arr);
    return charset[arr[0] % charset.length];
  };

  const pwd = [
    getRandom(upper),
    getRandom(upper),
    getRandom(lower),
    getRandom(lower),
    getRandom(lower),
    getRandom(digits),
    getRandom(digits),
    getRandom(special),
  ];

  const remaining = new Uint8Array(6);
  crypto.getRandomValues(remaining);
  for (let i = 0; i < 6; i++) {
    pwd.push(all[remaining[i] % all.length]);
  }

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const rand = new Uint8Array(1);
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join("");
}

/**
 * Creates the user in Supabase Auth with email pre-confirmed and password set,
 * or updates their password if the user already exists.
 */
export async function getOrCreateAdminUser(
  db: SupabaseClient,
  email: string,
  password: string,
  companyName: string
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Try creating a new confirmed user
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { company_name: companyName },
  });

  if (created?.user?.id) {
    return created.user.id;
  }

  // 2. User exists: retrieve user ID
  let userId: string | undefined;

  // Attempt using generateLink to obtain the user object without sending an email
  try {
    const linkRes = await db.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
    });
    if (linkRes.data?.user?.id) {
      userId = linkRes.data.user.id;
    }
  } catch (err) {
    console.warn("generateLink lookup failed, falling back to listUsers:", err);
  }

  // Fallback: list users and find by email
  if (!userId) {
    const { data: listData } = await db.auth.admin.listUsers({ perPage: 1000 });
    const match = listData?.users?.find(
      (u: any) => u.email?.toLowerCase() === normalizedEmail
    );
    if (match) userId = match.id;
  }

  if (userId) {
    const { error: updateError } = await db.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateError) {
      console.error("Failed to update existing user password:", updateError);
    }
    return userId;
  }

  throw new Error(createError?.message || "Could not provision admin user in Supabase Auth");
}

export interface CredentialsEmailParams {
  to: string;
  password: string;
  companyName: string;
  seats: number;
  dashboardUrl?: string;
}

/**
 * Sends credentials email to the user with their password and dashboard login link.
 * Supports Resend, SendGrid, or logs to console for debugging.
 */
export async function sendCredentialsEmail(params: CredentialsEmailParams): Promise<{ success: boolean; error?: string }> {
  const { to, password, companyName, seats } = params;
  const dashboardUrl = params.dashboardUrl || Deno.env.get("DASHBOARD_URL") || DEFAULT_DASHBOARD_URL;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const sendgridKey = Deno.env.get("SENDGRID_API_KEY");
  const fromEmail = Deno.env.get("EMAIL_FROM") || "FlashGuard <info@zenlow.co>";

  const subject = "Your FlashGuard Admin Login Credentials";

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:24px 0;background-color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;background-color:#0f172a;border-radius:12px;border:1px solid rgba(255,255,255,0.1);overflow:hidden;">
    <tr>
      <td style="padding:28px 32px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <span style="font-size:20px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px;">
          <span style="color:#f59e0b;">⚡</span> FlashGuard <span style="font-size:14px;font-weight:normal;color:#94a3b8;margin-left:4px;">admin</span>
        </span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#f8fafc;">Welcome to FlashGuard</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#94a3b8;">
          Your payment was successful and your subscription for <strong style="color:#f8fafc;">${companyName}</strong> (${seats} seats) is now active.
        </p>

        <div style="background-color:#1e293b;border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 14px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#f59e0b;">
            Your Admin Credentials
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#94a3b8;width:110px;">Dashboard:</td>
              <td style="padding:6px 0;"><a href="${dashboardUrl}" style="color:#38bdf8;text-decoration:none;word-break:break-all;font-weight:600;">${dashboardUrl}</a></td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#94a3b8;">Email:</td>
              <td style="padding:6px 0;color:#f8fafc;font-family:monospace;">${to}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#94a3b8;">Password:</td>
              <td style="padding:6px 0;">
                <code style="background:rgba(0,0,0,0.5);padding:4px 10px;border-radius:4px;font-family:monospace;font-size:15px;font-weight:bold;color:#fbbf24;border:1px solid rgba(245,158,11,0.25);">${password}</code>
              </td>
            </tr>
          </table>
        </div>

        <div style="text-align:center;margin-bottom:28px;">
          <a href="${dashboardUrl}" style="display:inline-block;background-color:#f59e0b;color:#0f172a;font-weight:700;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:8px;">
            Log in to Dashboard
          </a>
        </div>

        <h3 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.5px;">Next steps:</h3>
        <ol style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.6;color:#94a3b8;">
          <li style="margin-bottom:6px;">Sign in at <a href="${dashboardUrl}" style="color:#38bdf8;">${dashboardUrl}</a> using your email and password above.</li>
          <li style="margin-bottom:6px;">Click <strong>Generate company key</strong> in Section 1.</li>
          <li>Deploy FlashGuard extension across your browsers using Chrome, Edge, or Firefox policies.</li>
        </ol>

        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
          You can change your password anytime after logging in. If you have questions, our team is here to assist.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background-color:#0b0f19;border-top:1px solid rgba(255,255,255,0.05);text-align:center;font-size:12px;color:#64748b;">
        FlashGuard by Zenlow • <a href="mailto:info@zenlow.co" style="color:#94a3b8;text-decoration:none;">info@zenlow.co</a>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
Welcome to FlashGuard!

Your payment was successful and your subscription for ${companyName} (${seats} seats) is now active.

Your Admin Credentials:
------------------------------------------
Dashboard: ${dashboardUrl}
Login Email: ${to}
Password:  ${password}
------------------------------------------

Next steps:
1. Log in at ${dashboardUrl} using your email and password.
2. Generate your Company API Key in the dashboard.
3. Deploy the extension across your organization.

Need help? Contact us at info@zenlow.co
`.trim();

  // Try Resend API
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          html: htmlContent,
          text: textContent,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Resend API error:", errText);
        return { success: false, error: errText };
      }

      console.log(`Credentials email sent to ${to} via Resend`);
      return { success: true };
    } catch (err: any) {
      console.error("Resend request failed:", err);
      return { success: false, error: err.message };
    }
  }

  // Try SendGrid API
  if (sendgridKey) {
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: fromEmail.includes("<") ? fromEmail.replace(/.*<([^>]+)>.*/, "$1") : fromEmail },
          subject,
          content: [
            { type: "text/plain", value: textContent },
            { type: "text/html", value: htmlContent },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("SendGrid API error:", errText);
        return { success: false, error: errText };
      }

      console.log(`Credentials email sent to ${to} via SendGrid`);
      return { success: true };
    } catch (err: any) {
      console.error("SendGrid request failed:", err);
      return { success: false, error: err.message };
    }
  }

  // Fallback log when no email provider API key is configured
  console.warn(
    `[EMAIL NOT SENT - No RESEND_API_KEY or SENDGRID_API_KEY found]\n` +
    `To: ${to}\n` +
    `Dashboard: ${dashboardUrl}\n` +
    `Temporary Password: ${password}\n` +
    `To enable automated email delivery, run: supabase secrets set RESEND_API_KEY=re_...`
  );

  return {
    success: false,
    error: "No email provider configured. Please set RESEND_API_KEY in Supabase secrets.",
  };
}
