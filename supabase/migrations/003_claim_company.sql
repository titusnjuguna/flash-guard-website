-- Automatically links an authenticated user (such as from Google OAuth)
-- to any company that was purchased with their matching email address.
create or replace function public.claim_company_by_email()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  u_email text;
  cid integer;
begin
  select lower(email) into u_email from auth.users where id = auth.uid();
  if u_email is not null and u_email <> '' then
    for cid in select id from public.companies where lower(paystack_email) = u_email loop
      insert into public.company_admins (user_id, company_id)
      values (auth.uid(), cid)
      on conflict (user_id, company_id) do nothing;
    end loop;
  end if;
end;
$$;

revoke all on function public.claim_company_by_email() from public, anon;
grant execute on function public.claim_company_by_email() to authenticated;
