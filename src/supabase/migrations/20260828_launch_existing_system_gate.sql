begin;

alter table public.launch_workspaces
  add column if not exists owns_existing_system boolean not null default false;

comment on column public.launch_workspaces.owns_existing_system is
  'True when onboarding confirmed that the customer already owns a website or funnel system.';

commit;
