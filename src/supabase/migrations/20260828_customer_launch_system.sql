begin;

create table if not exists public.launch_workspaces (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  onboarding_session_id uuid references public.onboarding_sessions(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  template_key text not null check (template_key in ('authority_product', 'local_service')),
  traffic_mode text not null default 'undecided' check (traffic_mode in ('organic', 'paid', 'hybrid', 'undecided')),
  primary_cta text not null check (primary_cta in ('checkout', 'application', 'book_call', 'lead_form', 'phone', 'whatsapp')),
  website_state text not null check (website_state in ('live', 'needs_rebuild', 'no_website')),
  domain_mode text not null check (domain_mode in ('existing', 'new', 'subdomain', 'undecided')),
  status text not null default 'intake_complete' check (status in (
    'intake_complete', 'template_approved', 'drafting', 'ready_for_review',
    'changes_requested', 'approved_to_publish', 'published', 'traffic_ready',
    'measuring', 'proof', 'paused'
  )),
  cta_destination text,
  domain_value text,
  business_snapshot jsonb not null default '{}'::jsonb,
  offer_snapshot jsonb not null default '{}'::jsonb,
  launch_config jsonb not null default '{}'::jsonb,
  review_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_workspaces_customer_idx on public.launch_workspaces(customer_id, updated_at desc);
create index if not exists launch_workspaces_opportunity_idx on public.launch_workspaces(opportunity_id, updated_at desc);
create index if not exists launch_workspaces_status_idx on public.launch_workspaces(status, updated_at desc);

create table if not exists public.launch_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.launch_workspaces(id) on delete restrict,
  artifact_key text not null,
  artifact_type text not null check (artifact_type in (
    'page_copy', 'page_build', 'asset_pack', 'email_sequence',
    'tracking_plan', 'legal_checklist', 'traffic_plan'
  )),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in (
    'draft', 'ready_for_review', 'approved', 'changes_requested', 'published', 'retired'
  )),
  content jsonb not null default '{}'::jsonb,
  preview_url text,
  checksum text,
  generated_by text not null default 'nora',
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, artifact_key, version)
);

create index if not exists launch_artifacts_workspace_idx on public.launch_artifacts(workspace_id, status, updated_at desc);

create table if not exists public.launch_approvals (
  id uuid primary key default gen_random_uuid(),
  approval_key text not null unique,
  workspace_id uuid not null references public.launch_workspaces(id) on delete restrict,
  artifact_id uuid references public.launch_artifacts(id) on delete restrict,
  scope text not null check (scope in ('template', 'publish', 'paid_traffic')),
  decision text not null check (decision in ('approved', 'changes_requested', 'held')),
  notes text,
  decided_by text not null default 'robin',
  decided_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists launch_approvals_workspace_idx on public.launch_approvals(workspace_id, decided_at desc);

create or replace function public.growtheko_prevent_launch_approval_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'launch_approvals is append-only';
end;
$$;

drop trigger if exists launch_approvals_append_only on public.launch_approvals;
create trigger launch_approvals_append_only
before update or delete on public.launch_approvals
for each row execute function public.growtheko_prevent_launch_approval_mutation();

alter table public.launch_workspaces enable row level security;
alter table public.launch_artifacts enable row level security;
alter table public.launch_approvals enable row level security;
revoke all on public.launch_workspaces from anon, authenticated;
revoke all on public.launch_artifacts from anon, authenticated;
revoke all on public.launch_approvals from anon, authenticated;
grant all on public.launch_workspaces to service_role;
grant all on public.launch_artifacts to service_role;
grant select, insert on public.launch_approvals to service_role;

commit;
