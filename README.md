# FlashGuard site, Paystack checkout and admin dashboard

Flow: pricing page -> Paystack Checkout (USD, one-time payment per term, seats, company name, work email) -> Paystack webhook provisions the company and emails the buyer an admin invite -> dashboard (sign-in link, company key, security events, renewal).

## Setup
1. Run `flashguard/supabase.sql`, then `supabase/migrations/001_billing.sql` (or `002_paystack.sql` if upgrading an existing database).
2. Paystack Dashboard:
   - Ensure USD transactions are enabled on your Paystack account (Settings -> Preferences / Payment Methods).
   - Copy your **Secret Key** (`sk_test_...` or `sk_live_...`).
3. Set Supabase secrets:
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_... SITE_URL=https://your-site.com
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
   - Set Site URL and Redirect URLs to your site (`https://your-site.com` and `https://your-site.com/dashboard.html`).
   - Customise the invite/magic link email templates if desired.
7. Configure Frontend:
   - Set `SUPABASE_ID` and `ANON` in `index.html` and `dashboard.html`.
   - Host the static files (`index.html`, `dashboard.html`, `privacy.html`, `terms.html`, `site.css`) anywhere (Vercel, Netlify, Cloudflare Pages, S3/CloudFront, etc.).
8. Update placeholder emails in `privacy.html` and `terms.html`.
