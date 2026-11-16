import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL")!;

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(PAYSTACK_SECRET),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const hashHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex === signature;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { event?: string; data?: any };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.event === "charge.success") {
    const data = event.data;
    if (data?.status !== "success") return new Response("ignored");

    const email = data.customer?.email?.toLowerCase();
    if (!email) return new Response("Missing email", { status: 400 });

    const metadata = data.metadata || {};
    const companyName = metadata.company || email;
    const seats = Math.max(5, Number(metadata.seats) || 5);
    const interval = metadata.interval === "year" ? "year" : "month";
    const customerCode = data.customer.customer_code;
    const reference = data.reference;

    const days = interval === "year" ? 365 : 30;

    // Check if company already exists to extend period if already active
    const { data: existing } = await db
      .from("companies")
      .select("id, current_period_end")
      .eq("paystack_customer_code", customerCode)
      .maybeSingle();

    const baseTime = existing?.current_period_end && new Date(existing.current_period_end).getTime() > Date.now()
      ? new Date(existing.current_period_end).getTime()
      : Date.now();
    const currentPeriodEnd = new Date(baseTime + days * 86400000).toISOString();

    const { data: co, error } = await db
      .from("companies")
      .upsert(
        {
          name: companyName,
          paystack_customer_code: customerCode,
          paystack_reference: reference,
          paystack_email: email,
          seats,
          status: "active",
          current_period_end: currentPeriodEnd,
        },
        { onConflict: "paystack_customer_code" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("DB upsert error:", error);
      return new Response(error.message, { status: 500 });
    }

    // Invite the buyer as company IT admin (or generate magic link if already invited)
    let userId = (await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${SITE}/dashboard.html` })).data.user?.id;
    if (!userId) {
      userId = (await db.auth.admin.generateLink({ type: "magiclink", email })).data.user?.id;
    }
    if (userId) {
      await db.from("company_admins").upsert({ user_id: userId, company_id: co.id });
    }
  }

  return new Response("ok", { status: 200 });
});
