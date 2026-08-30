# GrowthEko Customer Operating Model V1

Status: production operating definition

## One customer, one portal

Every customer uses the same `/portal` shell. A customer never receives a second portal after an upgrade. Entitlements, tasks, support level, prompts and calendar access change inside the existing account. Unknown or legacy tiers fail closed and require an operator review.

Customer-facing navigation:

1. Tasks
2. Prompts
3. Calendar
4. Support
5. Listings, only when the entitlement and marketplace eligibility permit it

Internal navigation:

- `/ops` is the single operator surface.
- `/crm` temporarily redirects to `/ops` for backwards compatibility.
- Invented people are prohibited in production. Explicitly labelled localhost-only scenario fixtures may be used for operator QA when no CRM source is configured.
- Customers and applications remain the identity source. Each commercial offer has its own durable opportunity, so one person can move through the $7 entry and later $97, $1,997, $4,997 or $14,997 offers without replacing earlier history.
- Every operational change is attached to the append-only audit ledger. The UI may aggregate this evidence but does not create a second customer truth.

## Offer ladder and promise boundary

### Free Operator Starter — $0

- AI Growth Playbook and free training
- one Operator Action Card
- customer-safe starter prompt
- Digital Estate Calculator
- no private advice, custom analysis or implementation

### Operator Membership — $97/month

- one weekly 60-minute group Growth Support clinic
- operating frameworks, templates and recurring guidance
- customer executes with their own team
- no custom implementation, managed advertising or guaranteed result

### AI Operator Audit — $1,997 once

- structured intake and evidence review
- 60-minute diagnostic
- prioritized roadmap
- 45-minute walkthrough
- no done-for-you build

### AI System Sprint — $4,997 once

- 30 days
- exactly one evidence-backed bottleneck
- exactly one accepted System Unit
- kickoff, midpoint and handoff
- SOP and acceptance test
- no open-ended transformation

### AI Empire Architect — $14,997 once, application only

- 90 days
- one verified revenue path
- up to three connected System Units
- up to six private reviews
- proposal, SOW and acceptance criteria before payment
- no self-serve checkout and no universal automation promise

Expansion is prescribed only when the current bottleneck requires a capability outside the active scope and evidence shows the customer can use it. An upgrade is never triggered by calendar time, message volume, or a sales quota.

## Marketplace eligibility

Marketplace browsing is not a default paid-offer benefit. Access requires all of the following:

- active and verified customer account
- completed business objective and monetization path
- accepted risk and platform-compliance notice
- no unresolved billing, identity, ownership or security gate

A listing request creates an auditable CRM interaction. It is not a purchase, guarantee, broker representation or authorization to transfer money.

## Customer communication

Nora may classify an inbound message, retrieve context, draft a response, route the request and log the interaction. Automatic sending is allowed only for approved low-risk intents with locked templates and factual fields: receipt, status, scheduling, missing-information request and confirmed delivery notice.

Human approval is mandatory for pricing exceptions, refunds, contracts, scope changes, performance claims, security/access, payments, legal/tax issues, account sanctions and any message whose facts cannot be verified.

Do not manufacture human latency. The service target is a clear same-business-day response; urgent security or access incidents route immediately. Do not claim Robin wrote a message that he did not write. Ryan may communicate as `Ryan — GrowthEko Customer Success`, never by impersonating Robin. Yekdal may own qualified high-ticket calls and proposals under an approved sales SOP, never inventing proof or terms.

### Operator Inbox delivery contract

Email is the only customer communication channel in the OPS Inbox. The interface groups canonical `messages` records into one email thread per verified application. It is a communication surface, not a second CRM. The collapsed context card may open the matching Customer 360 record; the fixed conversation area contains the chronological email ledger and the only operator composer.

Incoming customer email is verified by the Resend webhook signature, resolved to a verified application by the sender address, retrieved from the Resend Receiving API and stored as a `customer` message. It appears on the left. An operator reply is sent through Resend and stored as a `team` message from `Nora`; it appears in blue on the right. `In-Reply-To` and `References` preserve the customer email thread where source metadata is available. Every production send and inbound receipt writes a source-linked audit event. Opening the UI, selecting a script or inserting a draft never sends anything.

The small mail icon with a checked badge represents the connected email route; permanent delivery sentences are intentionally omitted from the composer. Errors remain accessible and visible only when action is required. Customer 360 opens as a reversible drill-in above the conversation, with one explicit return action that restores the same thread, draft, script path and scroll position. Localhost is always a preview: the full composer and script workspace can be tested, but no database record or email leaves the machine.

### Nora reply workspace

The compact `Script` control above the composer opens a draft aid, not an autonomous sender. It provides four paths — Freestyle, Start to sale, Follow up and Expansion — with explicit phases and Text or Voice note format. Only the active phase is shown. `Use draft` moves the draft into the email composer for review; the blue Send button is the only send action. After a reviewed script draft is sent, that phase remains visible as sent but is locked against duplicate use, and the workspace advances to the next unsent phase.

Nora drafts from the verified application and canonical email history. The tone is concise, direct, supportive and lowercase, with Robin's casual voice used naturally rather than mechanically. A greeting always uses a comma, never a dash, and drafts do not use em or en dashes. New email subjects use the customer's first name plus the most relevant truthful next question or action; existing inbound subjects remain in the same `Re:` thread. Subjects may create honest curiosity but must never use fabricated stakes or clickbait. The body has no oversized brand banner. Drafts must not invent facts, proof, prices, urgency, scarcity, deadlines, results or availability. Commercial direction follows verified need and permission. Draft provenance, operator edits, phase completion and the final sent email are audit-linked.

WhatsApp, Instagram DMs and portal chat are not fallbacks. Adding another channel requires a separate approved contract with verified destination mapping, customer consent, delivery logging and a clear reason that email cannot serve the use case.

## Customer-success decision rule

Every interaction is routed to one outcome:

1. Answer from verified scope.
2. Ask for the one missing fact.
3. Route to the correct lesson, task or live.
4. Open a risk/approval gate.
5. Diagnose a verified expansion need.
6. Close the loop and log evidence.

The customer sees help, not an artificial upsell. A commercial recommendation may be made only after the current situation, desired outcome, bottleneck, evidence, fit and next scope are recorded.

## Roles

- Nora: orchestration, context, QA, routing and evidence ledger
- Customer Success AI: intake, classification, retrieval, draft, follow-up and logging within approved policy
- Ryan: disclosed human customer-success owner and final text review where required
- Yekdal: qualified closer for Sprint and Architect proposals
- Robin: lives, selected proof/testimonial recording, vision and critical exceptions
- Chief People Officer: owns both human-role and AI-agent role cards, SOPs, training, evaluation and retirement

No AI persona receives a fake human photo or fabricated human identity.

## Calls, lives and transcripts

- Friday 18:00 Vienna: public GrowthEko training/acquisition live
- Sunday 20:00 Vienna: member Growth Support clinic
- extra recurring lives are removed until demand and attendance data justify them

Fireflies or another meeting recorder is not silently enabled. Activation requires:

1. account and API ownership
2. participant notice and valid recording/transcription consent
3. privacy policy, processor/DPA and retention decision
4. secure webhook verification
5. customer-to-meeting identity match
6. redaction and access controls
7. a deletion/export workflow

After those gates, transcript segments may be attached to the customer timeline with meeting ID, speakers, consent evidence and source timestamps. Raw credentials, payment data and unrelated private conversation are never stored in a prompt.

## Decision queue

Only open decisions appear by default. Every decision contains verified context, three mutually exclusive choices, one recommendation, owner, deadline and exact approval gate. Closed decisions remain searchable by date, customer, project and outcome; they do not remain in the active queue.

An approval records authorization and returns the bounded task to Nora's command queue. It does not itself send a message, change access, charge money or perform another external action. Hold and reject record the stop decision and remove the task from the active execution queue.

## Prompt separation

Customer prompts contain only the context required to execute their Portal work. Internal Nora prompts, sales thresholds, risk policy, hidden commercial logic, other-customer information and operator credentials never enter the customer prompt library.

The default customer setup is one ChatGPT/Codex Project and one working chat. A new chat is opened only when context contamination or a materially different workstream makes it necessary.
