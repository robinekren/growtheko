begin;

-- A person or application can move through more than one commercial offer over time.
-- source_key remains the durable idempotency key for each distinct opportunity.
drop index if exists public.opportunities_application_unique;
create index if not exists opportunities_application_idx
  on public.opportunities(application_id, updated_at desc)
  where application_id is not null;

commit;
