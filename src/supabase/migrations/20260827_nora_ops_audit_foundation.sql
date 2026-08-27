begin;

create extension if not exists pgcrypto;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  customer_id uuid references public.customers(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  offer_key text not null default 'unassigned',
  source_offer_key text,
  offer_source text not null default 'unresolved'
    check (offer_source in ('ecosystem_entry', 'growtheko_offer', 'unresolved')),
  stage text not null default 'lead'
    check (stage in (
      'lead', 'purchased', 'access', 'activated', 'first_win',
      'expansion_diagnosed', 'qualified', 'offer_approved', 'paid',
      'onboarding', 'delivery', 'proof', 'retention_expansion',
      'attention', 'paused', 'closed_lost'
    )),
  status text not null default 'open'
    check (status in ('open', 'active', 'converted', 'paused', 'closed_won', 'closed_lost')),
  amount_recorded numeric,
  amount_unit text not null default 'unknown'
    check (amount_unit in ('major', 'minor', 'unknown')),
  currency text,
  review_required boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  paid_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or application_id is not null)
);

create unique index if not exists opportunities_application_unique
  on public.opportunities(application_id)
  where application_id is not null;
create index if not exists opportunities_customer_idx on public.opportunities(customer_id);
create index if not exists opportunities_offer_stage_idx on public.opportunities(offer_key, stage, status);
create index if not exists opportunities_updated_idx on public.opportunities(updated_at desc);

create table if not exists public.ops_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  actor_type text not null default 'system'
    check (actor_type in ('customer', 'nora', 'robin', 'system', 'webhook', 'integration')),
  actor_id text,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  customer_id uuid references public.customers(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  source_table text not null,
  source_record_id text,
  channel text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ops_audit_customer_idx on public.ops_audit_events(customer_id, occurred_at desc);
create index if not exists ops_audit_application_idx on public.ops_audit_events(application_id, occurred_at desc);
create index if not exists ops_audit_opportunity_idx on public.ops_audit_events(opportunity_id, occurred_at desc);
create index if not exists ops_audit_event_type_idx on public.ops_audit_events(event_type, occurred_at desc);

create table if not exists public.ops_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_key text not null unique,
  task_id text,
  customer_id uuid references public.customers(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  status text not null default 'open'
    check (status in ('open', 'approved', 'held', 'rejected', 'executed', 'superseded')),
  gate text not null,
  question text not null,
  recommendation text,
  verified_facts jsonb not null default '[]'::jsonb,
  requested_by text not null default 'nora',
  requested_at timestamptz not null default now(),
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  execution_event_id uuid references public.ops_audit_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_decisions_open_idx
  on public.ops_decisions(status, requested_at desc);
create index if not exists ops_decisions_customer_idx
  on public.ops_decisions(customer_id, requested_at desc);
create index if not exists ops_decisions_opportunity_idx
  on public.ops_decisions(opportunity_id, requested_at desc);

create or replace function public.growtheko_offer_key(value text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(value, ''))
    when 'digital_estate' then 'digital_estate'
    when 'digital_estate_founder_7' then 'digital_estate'
    when 'digital_estate_standard_97' then 'digital_estate'
    when 'monthly_97' then 'membership'
    when 'membership' then 'membership'
    when 'onetime_1997' then 'audit'
    when 'audit' then 'audit'
    when 'roadmap_1997' then 'audit'
    when 'done_with_you_4997' then 'sprint'
    when 'sprint' then 'sprint'
    when 'done_for_you_14997' then 'architect'
    when 'architect' then 'architect'
    when '' then 'unassigned'
    else 'legacy_review'
  end
$$;

create or replace function public.growtheko_offer_source(value text)
returns text
language sql
immutable
as $$
  select case
    when public.growtheko_offer_key(value) = 'digital_estate' then 'ecosystem_entry'
    when public.growtheko_offer_key(value) in ('membership', 'audit', 'sprint', 'architect') then 'growtheko_offer'
    else 'unresolved'
  end
$$;

insert into public.opportunities (
  source_key, customer_id, application_id, offer_key, source_offer_key,
  offer_source, stage, status, review_required, evidence, opened_at, paid_at
)
select
  'application:' || a.id::text,
  matched_customer.id,
  a.id,
  public.growtheko_offer_key(a.selected_tier),
  nullif(lower(a.selected_tier), ''),
  public.growtheko_offer_source(a.selected_tier),
  case
    when lower(coalesce(a.status, '')) in ('lost', 'rejected', 'closed_lost') then 'closed_lost'
    when a.paid_at is not null or lower(coalesce(a.stage, '')) in ('paid', 'sold') then 'paid'
    when lower(coalesce(a.stage, '')) = 'active' then 'delivery'
    when lower(coalesce(a.call_status, '')) in ('booked', 'scheduled', 'confirmed')
      or lower(coalesce(a.stage, '')) in ('booked', 'qualified') then 'qualified'
    when lower(coalesce(a.stage, '')) = 'applied' then 'lead'
    else 'lead'
  end,
  case
    when lower(coalesce(a.status, '')) in ('lost', 'rejected', 'closed_lost') then 'closed_lost'
    when matched_customer.id is not null then 'converted'
    else 'open'
  end,
  public.growtheko_offer_key(a.selected_tier) = 'legacy_review',
  jsonb_build_object(
    'backfill', true,
    'source_status', a.status,
    'source_stage', a.stage,
    'call_status', a.call_status
  ),
  coalesce(a.submitted_at, a.created_at, now()),
  a.paid_at
from public.applications a
left join lateral (
  select c.id
  from public.customers c
  where lower(c.email) = lower(a.email)
  order by c.created_at desc
  limit 1
) matched_customer on true
on conflict (source_key) do nothing;

insert into public.opportunities (
  source_key, customer_id, offer_key, source_offer_key, offer_source,
  stage, status, amount_recorded, amount_unit, currency, review_required,
  evidence, opened_at, paid_at
)
select
  'customer:' || c.id::text || ':' || coalesce(nullif(lower(c.tier), ''), 'unassigned'),
  c.id,
  public.growtheko_offer_key(c.tier),
  nullif(lower(c.tier), ''),
  public.growtheko_offer_source(c.tier),
  case
    when lower(coalesce(c.status, '')) in ('suspended', 'chargeback', 'dispute', 'refunded', 'past_due') then 'paused'
    when lower(coalesce(c.onboarding_status, '')) in ('completed', 'complete')
      and lower(coalesce(c.portal_status, '')) in ('active', 'ready', 'in_progress', 'complete', 'completed') then 'delivery'
    when lower(coalesce(c.onboarding_status, '')) in ('completed', 'complete') then 'onboarding'
    when c.paid_at is not null then 'paid'
    when lower(coalesce(c.status, '')) in ('paid', 'active') then 'purchased'
    else 'attention'
  end,
  case
    when lower(coalesce(c.status, '')) in ('suspended', 'chargeback', 'dispute', 'refunded', 'past_due') then 'paused'
    else 'active'
  end,
  c.amount_paid,
  'unknown',
  upper(c.currency),
  public.growtheko_offer_key(c.tier) = 'legacy_review',
  jsonb_build_object(
    'backfill', true,
    'source_status', c.status,
    'portal_status', c.portal_status,
    'onboarding_status', c.onboarding_status,
    'amount_unit_review_required', c.amount_paid is not null
  ),
  coalesce(c.paid_at, c.created_at, now()),
  c.paid_at
from public.customers c
on conflict (source_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  application_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:application:' || a.id::text,
  'customer', 'application_submitted', 'application', a.id::text,
  a.id, o.id, 'applications', a.id::text,
  'web', 'Application submitted',
  jsonb_build_object(
    'backfill', true,
    'status', a.status,
    'stage', a.stage,
    'selected_tier', a.selected_tier
  ),
  coalesce(a.submitted_at, a.created_at, now())
from public.applications a
left join public.opportunities o on o.source_key = 'application:' || a.id::text
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  summary, metadata, occurred_at
)
select
  'backfill:customer:' || c.id::text,
  'system', 'customer_created', 'customer', c.id::text,
  c.id, o.id, 'customers', c.id::text,
  'Customer record created',
  jsonb_build_object(
    'backfill', true,
    'status', c.status,
    'tier', c.tier,
    'portal_status', c.portal_status,
    'onboarding_status', c.onboarding_status
  ),
  coalesce(c.created_at, now())
from public.customers c
left join public.opportunities o
  on o.source_key = 'customer:' || c.id::text || ':' || coalesce(nullif(lower(c.tier), ''), 'unassigned')
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:payment:' || c.id::text || ':' || extract(epoch from c.paid_at)::bigint::text,
  'system', 'payment_recorded', 'customer', c.id::text,
  c.id, o.id, 'customers', c.id::text,
  'billing', 'Payment recorded in the legacy customer mirror',
  jsonb_build_object(
    'backfill', true,
    'amount_recorded', c.amount_paid,
    'amount_unit', 'unknown',
    'currency', upper(c.currency),
    'tier', c.tier
  ),
  c.paid_at
from public.customers c
left join public.opportunities o
  on o.source_key = 'customer:' || c.id::text || ':' || coalesce(nullif(lower(c.tier), ''), 'unassigned')
where c.paid_at is not null
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, application_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:message:' || m.id::text,
  case when lower(coalesce(m.sender_type, '')) = 'customer' then 'customer' else 'nora' end,
  case
    when m.message_type = 'meeting_transcript' then 'meeting_transcript_stored'
    when m.message_type = 'event' then 'customer_event_recorded'
    else 'message_stored'
  end,
  'message', m.id::text,
  o.customer_id, m.application_id, o.id, 'messages', m.id::text,
  case when m.message_type = 'meeting_transcript' then 'meeting' else 'portal_inbox' end,
  case
    when m.message_type = 'meeting_transcript' then 'Meeting transcript stored'
    when m.message_type = 'event' then 'Customer event recorded'
    else 'Communication stored'
  end,
  jsonb_build_object(
    'backfill', true,
    'sender_type', m.sender_type,
    'sender_name', m.sender_name,
    'message_type', m.message_type,
    'content', m.content,
    'message_metadata', coalesce(m.metadata, '{}'::jsonb),
    'read_at', m.read_at
  ),
  coalesce(m.created_at, now())
from public.messages m
left join public.opportunities o on o.application_id = m.application_id
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:onboarding:start:' || s.id::text,
  'customer', 'onboarding_started', 'onboarding_session', s.id::text,
  s.customer_id, o.id, 'onboarding_sessions', s.id::text,
  'portal', 'Onboarding started',
  jsonb_build_object('backfill', true, 'tier', s.tier, 'status', s.status),
  coalesce(s.started_at, s.completed_at, now())
from public.onboarding_sessions s
left join lateral (
  select id from public.opportunities
  where customer_id = s.customer_id
  order by paid_at desc nulls last, created_at desc
  limit 1
) o on true
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:onboarding:complete:' || s.id::text,
  'system', 'onboarding_completed', 'onboarding_session', s.id::text,
  s.customer_id, o.id, 'onboarding_sessions', s.id::text,
  'portal', 'Onboarding completed',
  jsonb_build_object('backfill', true, 'tier', s.tier, 'status', s.status),
  s.completed_at
from public.onboarding_sessions s
left join lateral (
  select id from public.opportunities
  where customer_id = s.customer_id
  order by paid_at desc nulls last, created_at desc
  limit 1
) o on true
where s.completed_at is not null
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:portal-progress:' || p.id::text,
  'customer', 'portal_task_completed', 'portal_progress', p.id::text,
  p.customer_id, o.id, 'portal_progress', p.id::text,
  'portal', 'Portal task completed',
  jsonb_build_object('backfill', true, 'task_id', p.task_id, 'phase_id', p.phase_id),
  coalesce(p.completed_at, now())
from public.portal_progress p
left join lateral (
  select id from public.opportunities
  where customer_id = p.customer_id
  order by paid_at desc nulls last, created_at desc
  limit 1
) o on true
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:portal-email:' || e.id::text,
  'nora', 'email_sent', 'portal_email', e.id::text,
  e.customer_id, o.id, 'portal_email_log', e.id::text,
  'email', 'Portal email sent',
  jsonb_build_object('backfill', true, 'email_type', e.email_type, 'detail', e.detail),
  coalesce(e.sent_at, now())
from public.portal_email_log e
left join lateral (
  select id from public.opportunities
  where customer_id = e.customer_id
  order by paid_at desc nulls last, created_at desc
  limit 1
) o on true
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, application_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:email-sequence:' || e.id::text,
  'nora', 'email_sent', 'email_sequence', e.id::text,
  matched.customer_id, matched.application_id, matched.opportunity_id,
  'email_sequences', e.id::text,
  'email', 'Lifecycle email sent',
  jsonb_build_object('backfill', true, 'email_type', e.email_type, 'email_index', e.email_index),
  coalesce(e.sent_at, now())
from public.email_sequences e
left join lateral (
  select o.customer_id, o.application_id, o.id as opportunity_id
  from public.opportunities o
  left join public.customers c on c.id = o.customer_id
  left join public.applications a on a.id = o.application_id
  where lower(coalesce(c.email, a.email, '')) = lower(e.email)
  order by o.updated_at desc
  limit 1
) matched on true
on conflict (event_key) do nothing;

insert into public.ops_audit_events (
  event_key, actor_type, event_type, entity_type, entity_id,
  customer_id, application_id, opportunity_id, source_table, source_record_id,
  channel, summary, metadata, occurred_at
)
select
  'backfill:suppression:' || s.id::text,
  'system', 'communication_suppressed', 'suppression', s.id::text,
  matched.customer_id, matched.application_id, matched.opportunity_id,
  'communication_suppressions', s.id::text,
  'all', 'Communication suppression recorded',
  jsonb_build_object(
    'backfill', true,
    'scope', s.scope,
    'reason', s.reason,
    'source', s.source,
    'suppression_metadata', coalesce(s.metadata, '{}'::jsonb)
  ),
  coalesce(s.created_at, now())
from public.communication_suppressions s
left join lateral (
  select o.customer_id, o.application_id, o.id as opportunity_id
  from public.opportunities o
  left join public.customers c on c.id = o.customer_id
  left join public.applications a on a.id = o.application_id
  where lower(coalesce(c.email, a.email, '')) = lower(s.email)
  order by o.updated_at desc
  limit 1
) matched on true
on conflict (event_key) do nothing;

create or replace function public.growtheko_redact_audit_payload(payload jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(payload, '{}'::jsonb)
    - 'password_hash'
    - 'auth_token'
    - 'verify_code'
    - 'verify_code_expires'
    - 'stripe_payment_intent_id'
$$;

create or replace function public.growtheko_capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  row_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  record_id text := coalesce(row_new->>'id', row_old->>'id', gen_random_uuid()::text);
  linked_customer uuid;
  linked_application uuid;
  linked_opportunity uuid;
  event_actor text := 'system';
  event_channel text;
begin
  linked_customer := nullif(coalesce(row_new->>'customer_id', row_old->>'customer_id'), '')::uuid;
  linked_application := nullif(coalesce(row_new->>'application_id', row_old->>'application_id'), '')::uuid;

  if tg_table_name = 'customers' then linked_customer := record_id::uuid; end if;
  if tg_table_name = 'applications' then linked_application := record_id::uuid; end if;
  if tg_table_name = 'opportunities' then linked_opportunity := record_id::uuid; end if;
  if tg_table_name = 'messages' then
    event_actor := case when lower(coalesce(row_new->>'sender_type', row_old->>'sender_type')) = 'customer' then 'customer' else 'nora' end;
    event_channel := case when coalesce(row_new->>'message_type', row_old->>'message_type') = 'meeting_transcript' then 'meeting' else 'portal_inbox' end;
  end if;

  if linked_opportunity is null then
    select o.id, coalesce(linked_customer, o.customer_id), coalesce(linked_application, o.application_id)
      into linked_opportunity, linked_customer, linked_application
    from public.opportunities o
    where (linked_application is not null and o.application_id = linked_application)
       or (linked_customer is not null and o.customer_id = linked_customer)
    order by o.updated_at desc
    limit 1;
  end if;

  insert into public.ops_audit_events (
    event_key, actor_type, event_type, entity_type, entity_id,
    customer_id, application_id, opportunity_id, source_table, source_record_id,
    channel, summary, metadata, occurred_at
  ) values (
    'trigger:' || tg_table_name || ':' || record_id || ':' || lower(tg_op) || ':' || txid_current()::text,
    event_actor,
    lower(tg_table_name || '_' || tg_op),
    tg_table_name,
    record_id,
    linked_customer,
    linked_application,
    linked_opportunity,
    tg_table_name,
    record_id,
    event_channel,
    initcap(replace(tg_table_name, '_', ' ')) || ' ' || lower(tg_op),
    jsonb_build_object(
      'operation', tg_op,
      'before', public.growtheko_redact_audit_payload(row_old),
      'after', public.growtheko_redact_audit_payload(row_new)
    ),
    now()
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create or replace function public.growtheko_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists opportunities_touch_updated_at on public.opportunities;
create trigger opportunities_touch_updated_at
before update on public.opportunities
for each row execute function public.growtheko_touch_updated_at();

drop trigger if exists ops_decisions_touch_updated_at on public.ops_decisions;
create trigger ops_decisions_touch_updated_at
before update on public.ops_decisions
for each row execute function public.growtheko_touch_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'applications', 'customers', 'messages', 'onboarding_sessions',
    'portal_progress', 'portal_changes', 'portal_email_log', 'email_sequences',
    'playbook_drip_log', 'communication_suppressions', 'opportunities', 'ops_decisions'
  ]
  loop
    execute format('drop trigger if exists growtheko_audit_changes on public.%I', table_name);
    execute format(
      'create trigger growtheko_audit_changes after insert or update or delete on public.%I for each row execute function public.growtheko_capture_audit_event()',
      table_name
    );
  end loop;
end
$$;

create or replace function public.growtheko_prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ops_audit_events is append-only';
end
$$;

drop trigger if exists ops_audit_events_append_only on public.ops_audit_events;
create trigger ops_audit_events_append_only
before update or delete on public.ops_audit_events
for each row execute function public.growtheko_prevent_audit_mutation();

alter table public.opportunities enable row level security;
alter table public.ops_audit_events enable row level security;
alter table public.ops_decisions enable row level security;

revoke all on public.opportunities from anon, authenticated;
revoke all on public.ops_audit_events from anon, authenticated;
revoke all on public.ops_decisions from anon, authenticated;
grant select, insert, update, delete on public.opportunities to service_role;
grant select, insert on public.ops_audit_events to service_role;
grant select, insert, update, delete on public.ops_decisions to service_role;

revoke all on function public.growtheko_offer_key(text) from public, anon, authenticated;
revoke all on function public.growtheko_offer_source(text) from public, anon, authenticated;
revoke all on function public.growtheko_redact_audit_payload(jsonb) from public, anon, authenticated;
revoke all on function public.growtheko_capture_audit_event() from public, anon, authenticated;
grant execute on function public.growtheko_offer_key(text) to service_role;
grant execute on function public.growtheko_offer_source(text) to service_role;
grant execute on function public.growtheko_redact_audit_payload(jsonb) to service_role;
grant execute on function public.growtheko_capture_audit_event() to service_role;

notify pgrst, 'reload schema';

commit;
