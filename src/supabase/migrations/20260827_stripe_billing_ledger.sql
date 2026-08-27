begin;

create extension if not exists pgcrypto;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  object_id text,
  stripe_customer_id text,
  offer_key text,
  livemode boolean not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 1,
  payload jsonb,
  error text,
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_webhook_status_idx
  on public.stripe_webhook_events(status, event_created_at desc);
create index if not exists stripe_webhook_customer_idx
  on public.stripe_webhook_events(stripe_customer_id, event_created_at desc);

create table if not exists public.stripe_billing_customers (
  stripe_customer_id text primary key,
  email text,
  name text,
  offer_key text,
  billing_status text,
  billing_country text,
  manual_review_required boolean not null default false,
  checkout_session_id text,
  subscription_id text,
  latest_invoice_id text,
  currency text,
  amount_paid bigint,
  paid_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  source_event_id text references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stripe_billing_customers_email_idx
  on public.stripe_billing_customers(lower(email)) where email is not null;

create table if not exists public.stripe_checkout_acceptances (
  checkout_session_id text primary key,
  request_id text,
  stripe_customer_id text references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  offer_key text,
  email text,
  company_name text,
  terms_version text,
  accepted_at timestamptz,
  b2b_attested boolean not null default false,
  electronic_invoice_consented boolean not null default false,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  stripe_customer_id text not null references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  entitlement_key text not null,
  email text,
  status text not null
    check (status in ('paid', 'manual_review', 'past_due', 'paused', 'canceled', 'refunded', 'disputed')),
  blocking_reason text,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz not null,
  source_priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_customer_id, entitlement_key)
);

create index if not exists stripe_entitlements_status_idx
  on public.stripe_billing_entitlements(status, updated_at desc);
create index if not exists stripe_entitlements_email_idx
  on public.stripe_billing_entitlements(lower(email)) where email is not null;

create table if not exists public.stripe_billing_subscriptions (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  status text,
  price_id text,
  product_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  latest_invoice_id text,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_billing_invoices (
  stripe_invoice_id text primary key,
  stripe_customer_id text not null references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  stripe_subscription_id text,
  status text,
  paid boolean not null default false,
  amount_paid bigint,
  amount_due bigint,
  amount_remaining bigint,
  subtotal bigint,
  total bigint,
  currency text,
  billing_reason text,
  attempt_count integer,
  next_payment_attempt timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  hosted_invoice_url text,
  invoice_pdf text,
  payment_intent_id text,
  charge_id text,
  price_id text,
  product_id text,
  offer_key text,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_invoices_customer_idx
  on public.stripe_billing_invoices(stripe_customer_id, source_event_created_at desc);

create table if not exists public.stripe_billing_adjustments (
  adjustment_key text primary key,
  stripe_object_id text,
  object_type text not null,
  stripe_customer_id text references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  stripe_invoice_id text,
  stripe_subscription_id text,
  payment_intent_id text,
  charge_id text,
  status text,
  amount bigint,
  currency text,
  reason text,
  full_adjustment boolean not null default false,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_adjustments_customer_idx
  on public.stripe_billing_adjustments(stripe_customer_id, source_event_created_at desc);

create table if not exists public.stripe_billing_tax_ids (
  stripe_tax_id text primary key,
  stripe_customer_id text not null references public.stripe_billing_customers(stripe_customer_id) on delete restrict,
  type text,
  value_last4 text,
  country text,
  validation_status text,
  verification_name text,
  source_event_id text not null references public.stripe_webhook_events(event_id) on delete restrict,
  source_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_billing_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  action_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'dead_letter')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_outbox_claim_idx
  on public.stripe_billing_outbox(status, next_attempt_at, created_at);

create or replace function public.growtheko_billing_priority(status_value text)
returns integer
language sql
immutable
as $$
  select case status_value
    when 'paid' then 50
    when 'past_due' then 70
    when 'manual_review' then 80
    when 'paused' then 90
    when 'canceled' then 95
    when 'refunded' then 100
    when 'disputed' then 110
    else 0
  end
$$;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_object_id text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  insert into public.stripe_webhook_events (
    event_id, event_type, event_created_at, object_id, livemode, status
  ) values (
    p_event_id, p_event_type, p_event_created_at, p_object_id, p_livemode, 'processing'
  )
  on conflict (event_id) do nothing;

  if found then
    return jsonb_build_object('claimed', true, 'status', 'processing');
  end if;

  update public.stripe_webhook_events
  set status = 'processing', attempts = attempts + 1, claimed_at = now(), error = null, updated_at = now()
  where event_id = p_event_id and status = 'failed'
  returning status into current_status;

  if found then
    return jsonb_build_object('claimed', true, 'status', current_status);
  end if;

  select status into current_status
  from public.stripe_webhook_events
  where event_id = p_event_id;

  return jsonb_build_object('claimed', false, 'status', coalesce(current_status, 'unknown'));
end
$$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
  p_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('processed', 'failed', 'ignored') then
    raise exception 'Invalid Stripe event finish status';
  end if;

  update public.stripe_webhook_events
  set status = p_status,
      error = left(p_error, 500),
      processed_at = case when p_status in ('processed', 'ignored') then now() else null end,
      updated_at = now()
  where event_id = p_event_id;

  if not found then raise exception 'Stripe event was not claimed'; end if;
  return jsonb_build_object('finished', true, 'status', p_status);
end
$$;

create or replace function public.apply_stripe_billing_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text := p_event->>'event_id';
  v_event_type text := p_event->>'event_type';
  v_event_at timestamptz := (p_event->>'created_at')::timestamptz;
  customer jsonb := p_event->'customer';
  acceptance jsonb := p_event->'acceptance';
  subscription jsonb := p_event->'subscription';
  invoice jsonb := p_event->'invoice';
  adjustment jsonb := p_event->'adjustment';
  tax_id jsonb := p_event->'tax_id';
  v_customer_id text := coalesce(customer->>'stripe_customer_id', p_event->>'authorized_customer_id');
  v_offer_key text := coalesce(p_event->>'authorized_offer_key', customer->>'tier', invoice->>'tier');
  entitlement_status text := nullif(p_event->>'entitlement_status', '');
  incoming_priority integer;
  first_paid boolean := false;
  entitlement_applied boolean := false;
  unresolved_dispute boolean := false;
  outbox_payload jsonb;
begin
  if v_event_id is null or v_event_type is null or v_event_at is null then
    raise exception 'Malformed normalized Stripe event';
  end if;

  update public.stripe_webhook_events
  set payload = p_event,
      stripe_customer_id = v_customer_id,
      offer_key = v_offer_key,
      updated_at = now()
  where stripe_webhook_events.event_id = v_event_id
    and status = 'processing';
  if not found then raise exception 'Stripe event is not actively claimed'; end if;

  if v_customer_id is not null then
    insert into public.stripe_billing_customers (
      stripe_customer_id, email, name, offer_key, billing_status, billing_country,
      manual_review_required, checkout_session_id, subscription_id, latest_invoice_id,
      currency, amount_paid, paid_at, current_period_start, current_period_end,
      cancel_at_period_end, source_event_id, source_event_created_at
    ) values (
      v_customer_id, nullif(lower(customer->>'email'), ''), customer->>'name', v_offer_key,
      customer->>'billing_status', customer->>'billing_country',
      coalesce((customer->>'manual_review_required')::boolean, false),
      customer->>'checkout_session_id', customer->>'subscription_id', customer->>'latest_invoice_id',
      upper(customer->>'currency'), (customer->>'amount_paid')::bigint,
      (customer->>'paid_at')::timestamptz, (customer->>'current_period_start')::timestamptz,
      (customer->>'current_period_end')::timestamptz,
      coalesce((customer->>'cancel_at_period_end')::boolean, false), v_event_id, v_event_at
    )
    on conflict (stripe_customer_id) do update set
      email = coalesce(excluded.email, stripe_billing_customers.email),
      name = coalesce(excluded.name, stripe_billing_customers.name),
      offer_key = coalesce(excluded.offer_key, stripe_billing_customers.offer_key),
      billing_status = coalesce(excluded.billing_status, stripe_billing_customers.billing_status),
      billing_country = coalesce(excluded.billing_country, stripe_billing_customers.billing_country),
      manual_review_required = excluded.manual_review_required or stripe_billing_customers.manual_review_required,
      checkout_session_id = coalesce(excluded.checkout_session_id, stripe_billing_customers.checkout_session_id),
      subscription_id = coalesce(excluded.subscription_id, stripe_billing_customers.subscription_id),
      latest_invoice_id = coalesce(excluded.latest_invoice_id, stripe_billing_customers.latest_invoice_id),
      currency = coalesce(excluded.currency, stripe_billing_customers.currency),
      amount_paid = coalesce(excluded.amount_paid, stripe_billing_customers.amount_paid),
      paid_at = coalesce(excluded.paid_at, stripe_billing_customers.paid_at),
      current_period_start = coalesce(excluded.current_period_start, stripe_billing_customers.current_period_start),
      current_period_end = coalesce(excluded.current_period_end, stripe_billing_customers.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      updated_at = now()
    where stripe_billing_customers.source_event_created_at is null
       or excluded.source_event_created_at >= stripe_billing_customers.source_event_created_at;
  end if;

  if acceptance is not null and acceptance <> 'null'::jsonb then
    insert into public.stripe_checkout_acceptances (
      checkout_session_id, request_id, stripe_customer_id, offer_key, email, company_name,
      terms_version, accepted_at, b2b_attested, electronic_invoice_consented, source_event_id
    ) values (
      acceptance->>'checkout_session_id', acceptance->>'request_id', acceptance->>'stripe_customer_id',
      acceptance->>'offer_key', nullif(lower(acceptance->>'email'), ''), acceptance->>'company_name',
      acceptance->>'terms_version', (acceptance->>'accepted_at')::timestamptz,
      coalesce((acceptance->>'b2b_attested')::boolean, false),
      coalesce((acceptance->>'electronic_invoice_consented')::boolean, false), v_event_id
    )
    on conflict (checkout_session_id) do update set
      request_id = excluded.request_id,
      terms_version = excluded.terms_version,
      accepted_at = excluded.accepted_at,
      b2b_attested = excluded.b2b_attested,
      electronic_invoice_consented = excluded.electronic_invoice_consented,
      source_event_id = excluded.source_event_id,
      updated_at = now();
  end if;

  if subscription is not null and subscription <> 'null'::jsonb then
    insert into public.stripe_billing_subscriptions (
      stripe_subscription_id, stripe_customer_id, status, price_id, product_id,
      current_period_start, current_period_end, cancel_at_period_end, canceled_at,
      latest_invoice_id, source_event_id, source_event_created_at
    ) values (
      subscription->>'stripe_subscription_id', subscription->>'stripe_customer_id', subscription->>'status',
      subscription->>'price_id', subscription->>'product_id',
      (subscription->>'current_period_start')::timestamptz, (subscription->>'current_period_end')::timestamptz,
      coalesce((subscription->>'cancel_at_period_end')::boolean, false),
      (subscription->>'canceled_at')::timestamptz, subscription->>'latest_invoice_id', v_event_id, v_event_at
    )
    on conflict (stripe_subscription_id) do update set
      status = excluded.status,
      price_id = coalesce(excluded.price_id, stripe_billing_subscriptions.price_id),
      product_id = coalesce(excluded.product_id, stripe_billing_subscriptions.product_id),
      current_period_start = coalesce(excluded.current_period_start, stripe_billing_subscriptions.current_period_start),
      current_period_end = coalesce(excluded.current_period_end, stripe_billing_subscriptions.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = coalesce(excluded.canceled_at, stripe_billing_subscriptions.canceled_at),
      latest_invoice_id = coalesce(excluded.latest_invoice_id, stripe_billing_subscriptions.latest_invoice_id),
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      updated_at = now()
    where excluded.source_event_created_at >= stripe_billing_subscriptions.source_event_created_at;
  end if;

  if invoice is not null and invoice <> 'null'::jsonb then
    insert into public.stripe_billing_invoices (
      stripe_invoice_id, stripe_customer_id, stripe_subscription_id, status, paid,
      amount_paid, amount_due, amount_remaining, subtotal, total, currency,
      billing_reason, attempt_count, next_payment_attempt, period_start, period_end,
      paid_at, hosted_invoice_url, invoice_pdf, payment_intent_id, charge_id,
      price_id, product_id, offer_key, source_event_id, source_event_created_at
    ) values (
      invoice->>'stripe_invoice_id', invoice->>'stripe_customer_id', invoice->>'stripe_subscription_id',
      invoice->>'status', coalesce((invoice->>'paid')::boolean, false),
      (invoice->>'amount_paid')::bigint, (invoice->>'amount_due')::bigint,
      (invoice->>'amount_remaining')::bigint, (invoice->>'subtotal')::bigint,
      (invoice->>'total')::bigint, upper(invoice->>'currency'), invoice->>'billing_reason',
      (invoice->>'attempt_count')::integer, (invoice->>'next_payment_attempt')::timestamptz,
      (invoice->>'period_start')::timestamptz, (invoice->>'period_end')::timestamptz,
      (invoice->>'paid_at')::timestamptz, invoice->>'hosted_invoice_url', invoice->>'invoice_pdf',
      invoice->>'payment_intent_id', invoice->>'charge_id', invoice->>'price_id',
      invoice->>'product_id', coalesce(invoice->>'tier', v_offer_key), v_event_id, v_event_at
    )
    on conflict (stripe_invoice_id) do update set
      status = excluded.status,
      paid = excluded.paid,
      amount_paid = excluded.amount_paid,
      amount_due = excluded.amount_due,
      amount_remaining = excluded.amount_remaining,
      attempt_count = excluded.attempt_count,
      next_payment_attempt = excluded.next_payment_attempt,
      paid_at = coalesce(excluded.paid_at, stripe_billing_invoices.paid_at),
      hosted_invoice_url = coalesce(excluded.hosted_invoice_url, stripe_billing_invoices.hosted_invoice_url),
      invoice_pdf = coalesce(excluded.invoice_pdf, stripe_billing_invoices.invoice_pdf),
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      updated_at = now()
    where excluded.source_event_created_at >= stripe_billing_invoices.source_event_created_at;
  end if;

  if adjustment is not null and adjustment <> 'null'::jsonb then
    insert into public.stripe_billing_adjustments (
      adjustment_key, stripe_object_id, object_type, stripe_customer_id, stripe_invoice_id,
      stripe_subscription_id, payment_intent_id, charge_id, status, amount, currency,
      reason, full_adjustment, source_event_id, source_event_created_at
    ) values (
      adjustment->>'adjustment_key', adjustment->>'stripe_object_id', adjustment->>'object_type',
      adjustment->>'stripe_customer_id', adjustment->>'stripe_invoice_id', adjustment->>'stripe_subscription_id',
      adjustment->>'payment_intent_id', adjustment->>'charge_id', adjustment->>'status',
      (adjustment->>'amount')::bigint, upper(adjustment->>'currency'), adjustment->>'reason',
      coalesce((adjustment->>'full_adjustment')::boolean, false), v_event_id, v_event_at
    )
    on conflict (adjustment_key) do update set
      status = excluded.status,
      amount = excluded.amount,
      reason = excluded.reason,
      full_adjustment = excluded.full_adjustment,
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      updated_at = now()
    where excluded.source_event_created_at >= stripe_billing_adjustments.source_event_created_at;
  end if;

  if tax_id is not null and tax_id <> 'null'::jsonb then
    insert into public.stripe_billing_tax_ids (
      stripe_tax_id, stripe_customer_id, type, value_last4, country,
      validation_status, verification_name, source_event_id, source_event_created_at
    ) values (
      tax_id->>'stripe_tax_id', tax_id->>'stripe_customer_id', tax_id->>'type', tax_id->>'value_last4',
      tax_id->>'country', tax_id->>'validation_status', tax_id->>'verification_name', v_event_id, v_event_at
    )
    on conflict (stripe_tax_id) do update set
      validation_status = excluded.validation_status,
      verification_name = excluded.verification_name,
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      updated_at = now()
    where excluded.source_event_created_at >= stripe_billing_tax_ids.source_event_created_at;
  end if;

  if entitlement_status is not null and v_customer_id is not null and v_offer_key is not null then
    if entitlement_status = 'paid' then
      select exists (
        select 1 from public.stripe_billing_adjustments a
        where a.stripe_customer_id = v_customer_id
          and a.object_type = 'dispute'
          and lower(coalesce(a.status, '')) not in ('won', 'lost', 'closed', 'funds_reinstated')
      ) into unresolved_dispute;
      if unresolved_dispute then entitlement_status := 'disputed'; end if;
    end if;

    incoming_priority := public.growtheko_billing_priority(entitlement_status);
    select not exists (
      select 1 from public.stripe_billing_entitlements
      where stripe_customer_id = v_customer_id and entitlement_key = v_offer_key and status = 'paid'
    ) into first_paid;

    insert into public.stripe_billing_entitlements (
      stripe_customer_id, entitlement_key, email, status, blocking_reason,
      source_event_id, source_event_created_at, source_priority
    ) values (
      v_customer_id, v_offer_key, nullif(lower(customer->>'email'), ''), entitlement_status,
      case when entitlement_status = 'disputed' then 'unresolved_dispute' else null end,
      v_event_id, v_event_at, incoming_priority
    )
    on conflict (stripe_customer_id, entitlement_key) do update set
      email = coalesce(excluded.email, stripe_billing_entitlements.email),
      status = excluded.status,
      blocking_reason = excluded.blocking_reason,
      source_event_id = excluded.source_event_id,
      source_event_created_at = excluded.source_event_created_at,
      source_priority = excluded.source_priority,
      updated_at = now()
    where excluded.source_event_created_at > stripe_billing_entitlements.source_event_created_at
       or (
         excluded.source_event_created_at = stripe_billing_entitlements.source_event_created_at
         and excluded.source_priority >= stripe_billing_entitlements.source_priority
       );
    entitlement_applied := found;
  end if;

  outbox_payload := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', v_event_type,
    'customer', customer,
    'subscription', subscription,
    'invoice', invoice,
    'adjustment', adjustment,
    'stripe_customer_id', v_customer_id,
    'email', customer->>'email',
    'name', customer->>'name',
    'tier', v_offer_key,
    'billing_country', customer->>'billing_country',
    'onboarding_url', 'https://growtheko.com/onboard'
  );

  if entitlement_status = 'paid' and first_paid and entitlement_applied then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('onboarding:' || v_customer_id || ':' || v_offer_key, 'customer_onboarding', outbox_payload)
    on conflict (dedupe_key) do nothing;
  end if;

  if v_event_type = 'invoice.paid' then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('notice:invoice_paid:' || v_event_id, 'invoice_paid', outbox_payload)
    on conflict (dedupe_key) do nothing;
  elsif v_event_type = 'invoice.payment_failed' then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('notice:payment_failed:' || v_event_id, 'payment_failed', outbox_payload)
    on conflict (dedupe_key) do nothing;
  elsif v_event_type = 'customer.subscription.deleted' then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('notice:subscription_canceled:' || v_event_id, 'subscription_canceled', outbox_payload)
    on conflict (dedupe_key) do nothing;
  elsif adjustment is not null and adjustment <> 'null'::jsonb then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('notice:billing_adjustment:' || v_event_id, 'billing_adjustment', outbox_payload)
    on conflict (dedupe_key) do nothing;
  end if;

  if coalesce((customer->>'manual_review_required')::boolean, false) then
    insert into public.stripe_billing_outbox(dedupe_key, action_type, payload)
    values ('notice:manual_billing_review:' || v_event_id, 'manual_billing_review', outbox_payload)
    on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'applied', true,
    'event_id', v_event_id,
    'customer_id', v_customer_id,
    'offer_key', v_offer_key,
    'entitlement_status', entitlement_status
  );
end
$$;

create or replace function public.claim_stripe_billing_outbox()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.stripe_billing_outbox%rowtype;
begin
  select * into claimed
  from public.stripe_billing_outbox
  where status = 'pending'
    and next_attempt_at <= now()
    and attempts < 8
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then return jsonb_build_object('claimed', false); end if;

  update public.stripe_billing_outbox
  set status = 'processing', attempts = attempts + 1, claimed_at = now(), updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return jsonb_build_object('claimed', true, 'job', to_jsonb(claimed));
end
$$;

create or replace function public.finish_stripe_billing_outbox(
  p_dedupe_key text,
  p_status text,
  p_error text default null,
  p_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.stripe_billing_outbox%rowtype;
  final_status text;
begin
  select * into job
  from public.stripe_billing_outbox
  where dedupe_key = p_dedupe_key
  for update;
  if job.id is null then raise exception 'Billing outbox job does not exist'; end if;

  if p_status = 'completed' then
    final_status := 'completed';
    update public.stripe_billing_outbox
    set status = final_status, completed_at = now(), error = null,
        result = p_result, updated_at = now()
    where id = job.id;
  elsif p_status = 'failed' then
    final_status := case when job.attempts >= 8 then 'dead_letter' else 'pending' end;
    update public.stripe_billing_outbox
    set status = final_status,
        next_attempt_at = now() + make_interval(secs => least(86400, 60 * (2 ^ greatest(job.attempts - 1, 0)))),
        error = left(p_error, 500), result = null, updated_at = now()
    where id = job.id;
  else
    raise exception 'Invalid billing outbox finish status';
  end if;

  return jsonb_build_object('finished', true, 'status', final_status);
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stripe_webhook_events', 'stripe_billing_customers', 'stripe_checkout_acceptances',
    'stripe_billing_entitlements', 'stripe_billing_subscriptions', 'stripe_billing_invoices',
    'stripe_billing_adjustments', 'stripe_billing_tax_ids', 'stripe_billing_outbox'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end
$$;

revoke all on function public.growtheko_billing_priority(text) from public, anon, authenticated;
revoke all on function public.claim_stripe_webhook_event(text, text, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, text, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_billing_event(jsonb) from public, anon, authenticated;
revoke all on function public.claim_stripe_billing_outbox() from public, anon, authenticated;
revoke all on function public.finish_stripe_billing_outbox(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.growtheko_billing_priority(text) to service_role;
grant execute on function public.claim_stripe_webhook_event(text, text, timestamptz, text, boolean) to service_role;
grant execute on function public.finish_stripe_webhook_event(text, text, text) to service_role;
grant execute on function public.apply_stripe_billing_event(jsonb) to service_role;
grant execute on function public.claim_stripe_billing_outbox() to service_role;
grant execute on function public.finish_stripe_billing_outbox(text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
