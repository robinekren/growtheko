# Nora Ops — final interface contract

## Operating model

Nora works one source-backed queue from top to bottom:

`detect → identify → verify context → select playbook → check risk → act → document → schedule next`

Every real lead or customer receives exactly one current next action. Automatic work stays in Queue. Only policy exceptions appear in Decisions.

## Autonomy phases

The phase selector is an inspection control. The active phase is server-controlled through `GROWTHEKO_NORA_AUTONOMY_PHASE`; the interface cannot silently promote Nora.

1. **Phase 1 · Supervised** — Nora reads, verifies, classifies and drafts. Robin approves every customer-visible message, access change and revenue-changing action.
2. **Phase 2 · Guarded** — Nora may execute reviewed routine communication. Access, prices, high-ticket offers, contracts, exceptions and sensitive claims remain with Robin.
3. **Phase 3 · Bounded** — Nora executes proven playbooks end to end. Money movement, legal, security, public claims, destructive actions and policy exceptions always stop for Robin.

“Autonomous” means autonomous inside a verified playbook, never unrestricted authority. Every critical policy breach forces a supervised review.

## Required design gate for future UI work

Before a new Nora Ops screen, module or major interaction is coded:

1. define the exact job and remove overlap with existing modules
2. lock the final user-facing copy
3. generate and review one visual design gate
4. implement from that approved hierarchy
5. verify every path without adding tabs, production demo records or duplicate navigation

## Final modules

1. **Queue** — “One verified next action per record. Nora works from top to bottom; exceptions stop for approval.”
2. **Customers** — “Lead, access, onboarding, outcome and communication context in one record.”
3. **Pipeline** — “Every opportunity, offer, revenue stage and next action in one operating view.”
4. **Inbox** — “Messages and meeting transcripts in one chronological queue. Customer context opens beside it.”
5. **Decisions** — “Only unresolved exceptions that Nora is not allowed to execute autonomously.”

There is no separate Meetings module, no second Pipeline module, no top-tab navigation and no duplicate customer timeline. Meetings are filtered inside Inbox. The full customer timeline lives once inside Customer 360. Details open beside the current list.

Production never renders invented people. When localhost has no CRM source, it may render exactly one explicit `Test customer ·` record at the initial Diagnose stage for operator QA. The interface labels it `LOCAL SCENARIOS · NOT PRODUCTION`; the API never returns it for a non-loopback production request.

## Visual gates

- `01-command-queue.png`
- `02-customer-360.png`
- `03-revenue-pipeline.png`
- `04-decisions.png`
- `05-autonomy-phases.png`

These images are design references. Production UI must continue to render only verified source data; names and values visible in the references are not application fixtures.
