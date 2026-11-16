# FlashGuard site, Paystack checkout and admin dashboard

Flow: pricing page -> Paystack Checkout (seats, company name, work email) -> Paystack webhook provisions company, creates confirmed admin user with temporary password, and sends welcome email with credentials to login at `dashboard.extension.zenlow.co` -> dashboard (password sign in, company key rotation, security events telemetry, renewal).

## Setup
1. Run `flashguard/supabase.sql`, then `supabase/migrations/001_billing.sql` (or `002_paystack.sql` if upgrading an existing database).
2. Paystack Dashboard:
   - Ensure USD transactions are enabled on your Paystack account (Settings -> Preferences / Payment Methods).
   - Copy your **Secret Key** (`sk_test_...` or `sk_live_...`).
3. Set Supabase secrets:
   ```bash
   supabase secrets set \
     PAYSTACK_SECRET_KEY=sk_... \
     SITE_URL=https://flashguard.extension.zenlow.co \
     DASHBOARD_URL=https://dashboard.extension.zenlow.co \
     RESEND_API_KEY=re_... \
     EMAIL_FROM="FlashGuard <info@zenlow.co>"
   ```
4. Deploy the Edge Functions:
   ```bash
   supabase functions deploy billing --no-verify-jwt
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```
5. Configure Paystack Webhook URL:
   - Go to **Paystack Dashboard -> Settings -> API Keys & Webhooks**.
   - Set the **Live Webhook URL** (or Test Webhook URL) to:
     `https://<YOUR_SUPABASE_PROJECT_ID>.supabase.co/functions/v1/paystack-webhook`
6. Supabase Auth:
   - Set Site URL and Redirect URLs to `https://dashboard.extension.zenlow.co`.
   - In **Authentication -> Providers -> Email**, ensure Email provider is enabled.
7. Configure Frontend:
   - Set `SUPABASE_ID` and `ANON` in `config.js` or directly in HTML.
   - Host the static files (`index.html`, `dashboard.html`, `privacy.html`, `terms.html`, `site.css`) on your web hosting provider (e.g. `dashboard.extension.zenlow.co`).
8. Update placeholder emails in `privacy.html` and `terms.html`.
