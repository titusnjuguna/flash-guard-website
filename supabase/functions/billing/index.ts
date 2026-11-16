// Deploy: supabase functions deploy billing --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL")!; // e.g. https://flashguard.example.com

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin || SITE || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const json = (b: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  const body = await req.json().catch(() => ({}));

  if (body.action === "checkout") {
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return json({ error: "Work email is required" }, 400, origin);

    const seats = Math.min(5000, Math.max(5, Math.floor(Number(body.seats)) || 5));
    const isYearly = body.interval === "year";
    const company = (body.company || "").trim() || email;

    // USD per seat: $5/month, $50/year
    const usdPerSeat = isYearly ? 50 : 5;
    const totalUSD = seats * usdPerSeat;

    // Exchange rate: default 130 KES per 1 USD (configurable in Supabase secrets)
    const usdToKesRate = Number(Deno.env.get("USD_TO_KES_RATE")) || 130;
    const totalKES = Math.round(totalUSD * usdToKesRate);

    // Paystack amounts in KES are in lowest unit (1 KES = 100 subunits/cents)
    const amountInKESSmallestUnit = totalKES * 100;

    const payload = {
      email,
      amount: amountInKESSmallestUnit,
      currency: "KES",
      callback_url: `${SITE || origin || "http://localhost:3000"}/dashboard.html`,
      metadata: {
        company,
        seats,
        interval: isYearly ? "year" : "month",
        usd_amount: totalUSD,
        exchange_rate: usdToKesRate,
        custom_fields: [
          { display_name: "Original (USD)", variable_name: "usd_amount", value: `$${totalUSD}` },
          { display_name: "Company Name", variable_name: "company", value: company },
          { display_name: "Seats", variable_name: "seats", value: seats },
          { display_name: "Billing Term", variable_name: "interval", value: isYearly ? "1 Year" : "1 Month" }
        ],
      },
    };

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.status || !data.data?.authorization_url) {
      return json({ error: data.message || "Failed to initialize payment with Paystack" }, 400, origin);
    }

    return json({ url: data.data.authorization_url }, 200, origin);
  }

  if (body.action === "portal") {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: "unauthorized" }, 401, origin);

    // For non-recurring purchases, portal directs back to pricing to renew or add seats
    return json({ url: `${SITE || origin || "http://localhost:3000"}/#pricing` }, 200, origin);
  }

  return json({ error: "bad request" }, 400, origin);
});
