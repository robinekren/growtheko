const TEMPLATE_KEYS = new Set(['authority_product', 'local_service']);
const TRAFFIC_MODES = new Set(['organic', 'paid', 'hybrid', 'undecided']);
const CTA_KEYS = new Set(['checkout', 'application', 'book_call', 'lead_form', 'phone', 'whatsapp']);
const WEBSITE_STATES = new Set(['live', 'needs_rebuild', 'no_website']);
const DOMAIN_MODES = new Set(['existing', 'new', 'subdomain', 'undecided']);
const EXISTING_SYSTEM_OWNERS = new Set(['yes', 'no']);

export const LAUNCH_TEMPLATES = Object.freeze({
  authority_product: Object.freeze({
    key: 'authority_product',
    name: 'Digital Estate',
    bestFor: 'A content-led digital asset, product, education path or direct checkout.',
    previewUrl: '/launch-preview?template=authority_product&mode=guide',
    suggestedCtas: Object.freeze(['checkout', 'application', 'book_call'])
  }),
  local_service: Object.freeze({
    key: 'local_service',
    name: 'AI Service',
    bestFor: 'A trust-led AI service sold through proof and one clear client conversation.',
    previewUrl: '/launch-preview?template=local_service&mode=guide',
    suggestedCtas: Object.freeze(['book_call', 'application', 'whatsapp'])
  })
});

export const LAUNCH_ARTIFACTS = Object.freeze([
  Object.freeze({ key: 'page_copy', name: 'Page copy', type: 'page_copy' }),
  Object.freeze({ key: 'page_build', name: 'Page build', type: 'page_build' }),
  Object.freeze({ key: 'asset_pack', name: 'Asset pack', type: 'asset_pack' }),
  Object.freeze({ key: 'email_sequence', name: 'Email sequence', type: 'email_sequence' }),
  Object.freeze({ key: 'tracking_plan', name: 'Tracking plan', type: 'tracking_plan' }),
  Object.freeze({ key: 'legal_checklist', name: 'Legal checklist', type: 'legal_checklist' }),
  Object.freeze({ key: 'traffic_plan', name: 'Traffic plan', type: 'traffic_plan' })
]);

function choice(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeLaunchInput(data = {}) {
  const templateKey = choice(data.launch_template, TEMPLATE_KEYS, 'authority_product');
  const trafficMode = choice(data.traffic_mode, TRAFFIC_MODES, 'undecided');
  const primaryCta = choice(data.primary_cta, CTA_KEYS, templateKey === 'local_service' ? 'book_call' : 'checkout');
  const ownershipFallback = data.website || data.existing_system_links ? 'yes' : 'no';
  const existingSystemOwner = choice(data.existing_system_owner, EXISTING_SYSTEM_OWNERS, ownershipFallback);
  const ownsExistingSystem = existingSystemOwner === 'yes';
  return {
    template_key: templateKey,
    traffic_mode: trafficMode,
    primary_cta: primaryCta,
    existing_system_owner: existingSystemOwner,
    owns_existing_system: ownsExistingSystem,
    existing_system_links: ownsExistingSystem ? text(data.existing_system_links || data.website, 3000) : '',
    website_state: ownsExistingSystem
      ? choice(data.website_state, WEBSITE_STATES, data.website ? 'live' : 'needs_rebuild')
      : 'no_website',
    domain_mode: choice(data.domain_mode, DOMAIN_MODES, ownsExistingSystem && data.website ? 'existing' : 'undecided'),
    cta_destination: text(data.cta_destination, 1000),
    domain_value: text(data.domain_value || (ownsExistingSystem ? data.website : ''), 500),
    asset_state: text(data.asset_state, 120) || 'needs_support',
    email_platform: text(data.email_platform, 160) || 'none',
    legal_owner: text(data.legal_owner, 160) || 'customer',
    legal_links: text(data.legal_links, 2000),
    launch_notes: text(data.launch_notes, 3000)
  };
}

export function launchGates(input = {}) {
  const normalized = normalizeLaunchInput(input);
  const destinationReady = Boolean(normalized.cta_destination);
  const domainReady = normalized.domain_mode === 'existing'
    ? Boolean(normalized.domain_value)
    : normalized.domain_mode === 'new' || normalized.domain_mode === 'subdomain';
  const legalReady = Boolean(normalized.legal_links);
  const paidRequested = normalized.traffic_mode === 'paid' || normalized.traffic_mode === 'hybrid';
  return {
    template_approval: false,
    publish_approval: false,
    paid_traffic_approval: !paidRequested,
    cta_destination_ready: destinationReady,
    domain_ready: domainReady,
    legal_ready: legalReady,
    tracking_ready: false,
    paid_requested: paidRequested
  };
}

export function buildLaunchWorkspace(data = {}) {
  const input = normalizeLaunchInput(data);
  const template = LAUNCH_TEMPLATES[input.template_key];
  const gates = launchGates(data);
  return {
    status: 'intake_complete',
    ...input,
    business_snapshot: {
      name: text(data.name, 160),
      company: text(data.company, 240),
      website: text(data.website, 500),
      country: text(data.country, 120),
      market: text(data.market, 120),
      niche: text(data.niche, 240),
      ideal_customer: text(data.ideal_customer, 1200)
    },
    offer_snapshot: {
      type: text(data.product_type, 160),
      description: text(data.product_description, 2500),
      price: text(data.product_price, 160),
      delivery: text(data.delivery_method, 160),
      goal: text(data.primary_goal, 1200)
    },
    launch_config: {
      template_name: template.name,
      preview_url: template.previewUrl,
      gates,
      requirements: {
        asset_state: input.asset_state,
        email_platform: input.email_platform,
        legal_owner: input.legal_owner,
        legal_links: input.legal_links,
        existing_system_links: input.existing_system_links,
        launch_notes: input.launch_notes
      },
      rule: 'One input, one workspace, versioned artifacts, three approval gates.'
    }
  };
}

export function launchArtifactSeeds(data = {}) {
  const workspace = buildLaunchWorkspace(data);
  return LAUNCH_ARTIFACTS.map(artifact => ({
    artifact_key: artifact.key,
    artifact_type: artifact.type,
    version: 1,
    status: 'draft',
    content: {
      name: artifact.name,
      source: 'onboarding',
      template_key: workspace.template_key,
      traffic_mode: workspace.traffic_mode,
      primary_cta: workspace.primary_cta
    },
    generated_by: 'system'
  }));
}

export function launchNextAction(workspace, artifacts = []) {
  if (!workspace) return null;
  const config = workspace.launch_config || {};
  const gates = config.gates || {};
  if (!gates.template_approval) return { key: 'launch-template-approval', action: 'Approve the launch template direction', gate: 'Template direction' };
  if (artifacts.some(item => item.status === 'changes_requested')) return { key: 'launch-revision', action: 'Revise the requested launch artifacts', gate: 'Internal execution' };
  if (!artifacts.length || artifacts.some(item => item.status === 'draft')) return { key: 'launch-build', action: 'Build the seven connected launch artifacts', gate: 'Internal execution' };
  if (!gates.publish_approval) return { key: 'launch-publish-approval', action: 'Approve the final launch preview', gate: 'Public release' };
  if (!['published', 'traffic_ready', 'measuring', 'proof'].includes(workspace.status)) return { key: 'launch-publish', action: 'Publish the approved launch package', gate: 'Internal execution' };
  if (gates.paid_requested && !gates.paid_traffic_approval) return { key: 'launch-paid-traffic-approval', action: 'Approve the paid traffic test', gate: 'Ad spend' };
  return { key: 'launch-measure', action: 'Measure the live launch and record evidence', gate: 'Weekly operating loop' };
}
