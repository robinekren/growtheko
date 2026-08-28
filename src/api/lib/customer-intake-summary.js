import { LAUNCH_TEMPLATES } from './launch-system.js';

// This is the canonical customer-authored intake contract. The verified email is
// identity data and intentionally stays outside the 48 numbered answers.
export const CUSTOMER_INTAKE_FIELDS = Object.freeze([
  ['about_you', 'name', 'Name'],
  ['about_you', 'company', 'Company'],
  ['about_you', 'website', 'Website'],
  ['about_you', 'country', 'Country'],
  ['about_you', 'city', 'City'],
  ['about_you', 'current_job', 'Current role / job'],
  ['about_you', 'date_of_birth', 'Birthday'],
  ['about_you', 'business_age', 'Time in business'],
  ['market', 'market', 'Market'],
  ['market', 'sub_market', 'Sub-market'],
  ['market', 'niche', 'Niche'],
  ['market', 'blue_ocean', 'Blue ocean'],
  ['market', 'ideal_customer', 'Ideal customer'],
  ['audience', 'primary_geo_market', 'Primary market'],
  ['audience', 'additional_markets', 'Additional markets'],
  ['audience', 'company_size', 'Company size'],
  ['product', 'product_type', 'Product type'],
  ['product', 'product_description', 'Product description'],
  ['product', 'product_price', 'Product price'],
  ['product', 'delivery_method', 'Delivery method'],
  ['launch_path', 'existing_system_owner', 'Existing system'],
  ['launch_path', 'existing_system_links', 'Existing system links'],
  ['launch_path', 'website_state', 'Existing system plan'],
  ['launch_path', 'launch_template', 'Page system'],
  ['launch_path', 'primary_cta', 'Primary action'],
  ['launch_path', 'cta_destination', 'Action destination'],
  ['launch_path', 'traffic_mode', 'Traffic'],
  ['launch_path', 'domain_mode', 'Domain plan'],
  ['launch_path', 'domain_value', 'Domain'],
  ['launch_path', 'asset_state', 'Assets'],
  ['launch_path', 'email_platform', 'Email platform'],
  ['launch_path', 'legal_links', 'Legal pages'],
  ['business_status', 'monthly_revenue', 'Revenue'],
  ['business_status', 'customer_count', 'Customers'],
  ['business_status', 'acquisition_channels', 'Acquisition'],
  ['business_status', 'biggest_problem', 'Biggest problem'],
  ['goals', 'primary_goal', 'Goal'],
  ['goals', 'revenue_target', 'Revenue target'],
  ['goals', 'hours_available', 'Hours / week'],
  ['goals', 'ai_experience', 'AI level'],
  ['tech_tools', 'current_tools', 'Tools'],
  ['tech_tools', 'email_list_size', 'Email list'],
  ['tech_tools', 'social_media', 'Social media'],
  ['business_brand', 'legal_entity_type', 'Legal entity'],
  ['business_brand', 'tax_id', 'Tax ID'],
  ['business_brand', 'vat_registered', 'VAT registered'],
  ['business_brand', 'brand_voice', 'Brand voice'],
  ['business_brand', 'timezone', 'Timezone']
].map(([section, key, label], index) => Object.freeze({ number: index + 1, section, key, label })));

export const CUSTOMER_INTAKE_NORMALIZATION_STYLE = Object.freeze({
  version: 'growtheko.customer-intake-normalization.v1',
  audience: 'operator',
  voice: 'precise_concise_neutral',
  primary_layer: 'normalized_customer_meaning',
  normalization: Object.freeze({
    mode: 'deterministic_only',
    whitespace: 'trim_outer_whitespace',
    enums: 'canonical_display_labels_only',
    preserve_meaning: true,
    generative_rewrite: false
  }),
  unknowns: Object.freeze({
    visible: true,
    reasons: Object.freeze(['not_captured', 'empty_submission', 'conflicting_sources']),
    inference_allowed: false
  }),
  evidence: Object.freeze({
    raw_preserved: true,
    provenance_preserved: true,
    raw_layer: 'secondary_disclosure',
    duplicate_raw_when_equal_to_normalized: false
  }),
  copy: Object.freeze({
    sales_hype: false,
    duplicate_copy: false,
    invented_facts: false
  })
});

const DISPLAY_VALUES = Object.freeze({
  launch_template: Object.freeze({
    authority_product: LAUNCH_TEMPLATES.authority_product.name,
    local_service: LAUNCH_TEMPLATES.local_service.name
  }),
  existing_system_owner: Object.freeze({ yes: 'Yes', no: 'No' })
});

function sourceRowsByField(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.field_name ?? '').trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function rawString(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function displayValue(key, raw) {
  const trimmed = raw.trim();
  return DISPLAY_VALUES[key]?.[trimmed] || trimmed;
}

function sourceSessionId(rows, fallback) {
  const ids = [...new Set(rows.map(row => String(row?.session_id ?? '').trim()).filter(Boolean))];
  return ids.length === 1 ? ids[0] : (String(fallback || '').trim() || null);
}

export function canonicalCustomerIntakeSummary(answerRows = [], { sessionId = null } = {}) {
  const grouped = sourceRowsByField(answerRows);
  const items = CUSTOMER_INTAKE_FIELDS.map(field => {
    const rows = grouped.get(field.key) || [];
    const rawValues = rows.map(row => row?.field_value);
    const populated = rawValues.map(rawString).map(value => value.trim()).filter(Boolean);
    const distinct = [...new Set(populated)];
    const conflict = distinct.length > 1;
    const known = distinct.length === 1;
    const unknownReason = conflict ? 'conflicting_sources' : rows.length ? 'empty_submission' : 'not_captured';
    const rawValue = known ? rawValues.find(value => rawString(value).trim() === distinct[0]) : null;

    return {
      number: field.number,
      section: field.section,
      key: field.key,
      label: field.label,
      value: known ? displayValue(field.key, distinct[0]) : null,
      raw_value: rawValue,
      status: known ? 'known' : 'unknown',
      unknown: !known,
      unknown_reason: known ? null : unknownReason,
      provenance: {
        source_table: 'onboarding_answers',
        session_id: sourceSessionId(rows, sessionId),
        field_name: field.key,
        capture: 'customer_submitted',
        raw_preserved: rows.length > 0,
        source_row_count: rows.length,
        conflicting_sources: conflict,
        raw_values: rawValues
      }
    };
  });
  const knownCount = items.filter(item => !item.unknown).length;
  const text = items.map(item => item.unknown
    ? `${item.number}. ${item.label}: Unknown [${item.unknown_reason}]`
    : `${item.number}. ${item.label}: ${item.value}`
  ).join('\n');

  return {
    schema_version: 'growtheko.customer-intake-summary.v1',
    summary_type: 'canonical_normalized_ai_context',
    normalization: 'deterministic_no_inference',
    normalization_style: CUSTOMER_INTAKE_NORMALIZATION_STYLE.version,
    format: 'numbered_48',
    total: CUSTOMER_INTAKE_FIELDS.length,
    known_count: knownCount,
    unknown_count: CUSTOMER_INTAKE_FIELDS.length - knownCount,
    raw_answers_preserved: true,
    items,
    text
  };
}
