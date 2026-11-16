-- Full setup: extensions, base tables, billing columns, admin accounts and functions.
create extension if not exists pgcrypto;

-- Base companies table
create table if not exists public.companies (
  id serial primary key,
  name text,
  created_at timestamptz default now()
);

-- Billing & key columns
alter table public.companies
  add column if not exists api_key_hash text,
  add column if not exists paystack_customer_code text unique,
  add column if not exists paystack_reference text,
  add column if not exists paystack_email text,
  add column if not exists seats int not null default 0,
  add column if not exists status text not null default 'inactive',   -- 'active' | 'inactive' | 'expired'
  add column if not exists current_period_end timestamptz;

-- Security events reported by the extension
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  company_id integer references public.companies(id) on delete cascade,
  threat_type text not null,
  url text,
  detected_at timestamptz default now()
);
alter table public.security_events enable row level security;

-- Company admins table (links auth.users uuid with companies integer id)
create table if not exists public.company_admins (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id integer not null references public.companies(id) on delete cascade,
  primary key (user_id, company_id)
);
alter table public.company_admins enable row level security;

-- Row Level Security policies
drop policy if exists "admin sees own link" on public.company_admins;
create policy "admin sees own link" on public.company_admins for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin reads own company" on public.companies;
create policy "admin reads own company" on public.companies for select to authenticated
  using (id in (select company_id from public.company_admins where user_id = auth.uid()));

drop policy if exists "admin reads own events" on public.security_events;
create policy "admin reads own events" on public.security_events for select to authenticated
  using (company_id in (select company_id from public.company_admins where user_id = auth.uid()));

-- Extension ingestion only works while the period has not expired.
create or replace function public.fg_company_from_header()
returns integer language sql stable security definer set search_path = public, extensions as $$
  select id from public.companies
  where status in ('active','trialing')
    and (current_period_end is null or current_period_end > now())
    and api_key_hash = encode(digest(coalesce(current_setting('request.headers', true)::json->>'x-company-key',''), 'sha256'), 'hex')
$$;

-- Admin generates/rotates the key; plaintext is returned once, only the hash is stored.
create or replace function public.rotate_company_key()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare cid integer; k text;
begin
  select company_id into cid from public.company_admins where user_id = auth.uid() limit 1;
  if cid is null then raise exception 'not an admin'; end if;
  k := 'fg_' || encode(gen_random_bytes(24), 'hex');
  update public.companies set api_key_hash = encode(digest(k, 'sha256'), 'hex') where id = cid;
  return k;
end $$;
revoke all on function public.rotate_company_key() from public, anon;
grant execute on function public.rotate_company_key() to authenticated;
