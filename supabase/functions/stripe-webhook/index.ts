// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Stripe events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateSecurePassword,
  getOrCreateAdminUser,
  sendCredentialsEmail,
  DEFAULT_DASHBOARD_URL,
} from "../_shared/credentials.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") || "";
const DASHBOARD_URL = Deno.env.get("DASHBOARD_URL") || DEFAULT_DASHBOARD_URL;

const fields = (sub: Stripe.Subscription) => ({
  stripe_subscription_id: sub.id,
  seats: sub.items.data[0]?.quantity ?? 0,
  status: sub.status, // trialing | active | past_due | canceled | unpaid ...
  current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
});

Deno.serve(async (req) => {
  let ev: Stripe.Event;
  try {
    ev = await stripe.webhooks.constructEventAsync(
      await req.text(), req.headers.get("stripe-signature")!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (ev.type === "checkout.session.completed") {
    const s = ev.data.object as Stripe.Checkout.Session;
    if (s.mode !== "subscription") return new Response("ignored");
    const email = s.customer_details!.email!;
    const name = s.custom_fields?.find((f) => f.key === "company")?.text?.value ?? email;
    const sub = await stripe.subscriptions.retrieve(s.subscription as string);

    // Upsert keeps Stripe retries idempotent.
    const { data: co, error } = await db.from("companies")
      .upsert({ name, stripe_customer_id: s.customer as string, ...fields(sub) }, { onConflict: "stripe_customer_id" })
      .select("id").single();
    if (error) return new Response(error.message, { status: 500 }); // Stripe retries

    // Provision admin user account with temporary password & send welcome credentials email
    const tempPassword = generateSecurePassword();
    try {
      const userId = await getOrCreateAdminUser(db, email, tempPassword, name);
      if (userId) {
        await db.from("company_admins").upsert(
          { user_id: userId, company_id: co.id },
          { onConflict: "user_id,company_id" }
        );
      }

      const seats = sub.items.data[0]?.quantity ?? 1;
      await sendCredentialsEmail({
        to: email,
        password: tempPassword,
        companyName: name,
        seats,
        dashboardUrl: DASHBOARD_URL,
      });
    } catch (provisionErr: any) {
      console.error("Error provisioning user or sending email:", provisionErr);
    }
  }

  if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
    const sub = ev.data.object as Stripe.Subscription;
    await db.from("companies").update(fields(sub)).eq("stripe_customer_id", sub.customer as string);
  }
  return new Response("ok");
});
