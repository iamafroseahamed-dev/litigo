-- ════════════════════════════════════════════════════════════════════════════
--  eCourts SUBSCRIBER (monetary) pricing
--  Deductions now use amount_per_call (subscriber rate in ₹) instead of credit
--  units. `organizations.available_credits` is treated as a ₹ Balance.
--  Run in the Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Audit / enforce subscriber pricing (₹ amount_per_call).
insert into public.ecourts_api_pricing (endpoint_name, credits_per_call, amount_per_call) values
    ('CASE_DETAIL',   1, 0.50),
    ('CASE_SEARCH',   1, 0.20),
    ('CAUSE_LIST',    1, 1.00),
    ('ORDER_PDF',     1, 1.25),
    ('ORDER_PDF_AI',  1, 2.50),
    ('ORDER_PDF_MD',  1, 1.75),
    ('CASE_REFRESH',  1, 0.05)
on conflict (endpoint_name) do update
    set credits_per_call = excluded.credits_per_call,
        amount_per_call  = excluded.amount_per_call;

-- 2. Deduct the subscriber amount (amount_per_call), not 1 credit unit.
--    Records credits_used = the ₹ amount charged for that call.
create or replace function public.record_ecourts_usage(
    p_org uuid,
    p_case uuid,
    p_endpoint text,
    p_request_id text,
    p_cnr text
) returns numeric
language plpgsql
as $$
declare
    v_amount numeric;
    v_remaining numeric;
begin
    select coalesce(amount_per_call, 0) into v_amount
    from public.ecourts_api_pricing where endpoint_name = p_endpoint;
    if v_amount is null then v_amount := 0; end if;

    insert into public.ecourts_api_usage (organization_id, case_id, endpoint_name, credits_used, request_id, cnr_number)
    values (p_org, p_case, p_endpoint, v_amount, p_request_id, p_cnr);

    if p_org is not null then
        update public.organizations
            set available_credits = coalesce(available_credits, 0) - v_amount
            where id = p_org
            returning available_credits into v_remaining;
    end if;

    return v_remaining;
end;
$$;

grant execute on function public.record_ecourts_usage(uuid, uuid, text, text, text) to anon, authenticated;

-- 3. Backfill historical usage rows: credits_used = the subscriber amount charged.
update public.ecourts_api_usage u
    set credits_used = p.amount_per_call
    from public.ecourts_api_pricing p
    where u.endpoint_name = p.endpoint_name;

-- 4. Recalculate historical balances:
--    available_credits = starting trial_credits − Σ(subscriber amount charged).
update public.organizations o
    set available_credits = coalesce(o.trial_credits, 100) - coalesce((
        select sum(coalesce(p.amount_per_call, 0))
        from public.ecourts_api_usage u
        join public.ecourts_api_pricing p on p.endpoint_name = u.endpoint_name
        where u.organization_id = o.id
    ), 0);
