-- Migration to add Paystack columns to existing companies table

alter table public.companies
  add column if not exists paystack_customer_code text unique,
  add column if not exists paystack_reference text,
  add column if not exists paystack_email text;

create or replace function public.fg_company_from_header()
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select id from public.companies
  where status in ('active','trialing')
    and (current_period_end is null or current_period_end > now())
    and api_key_hash = encode(digest(coalesce(current_setting('request.headers', true)::json->>'x-company-key',''), 'sha256'), 'hex')
$$;
