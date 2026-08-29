import { resolveCustomerLevel } from './customer-level.js';

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function serviceHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function optionalRows(url, key) {
  try {
    const response = await fetch(url, { headers: serviceHeaders(key) });
    return response.ok ? await response.json().catch(() => []) : [];
  } catch {
    return [];
  }
}

export async function loadVerifiedCustomerLevel({ base, key, application, customer: suppliedCustomer } = {}) {
  const applicationId = clean(application?.id, 140);
  const email = clean(application?.email, 320).toLowerCase();
  let customer = suppliedCustomer;

  if (customer === undefined) {
    const customers = email
      ? await optionalRows(`${base}/rest/v1/customers?email=eq.${encodeURIComponent(email)}&select=id,email,tier,amount_paid,paid_at&limit=1`, key)
      : [];
    customer = customers?.[0] || null;
  }

  const opportunityByApplication = applicationId
    ? optionalRows(`${base}/rest/v1/opportunities?application_id=eq.${encodeURIComponent(applicationId)}&select=id,customer_id,application_id,entity_id,email,offer_key,source_offer_key,stage,status,paid_at`, key)
    : Promise.resolve([]);
  const opportunityByCustomer = customer?.id
    ? optionalRows(`${base}/rest/v1/opportunities?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,customer_id,application_id,entity_id,email,offer_key,source_offer_key,stage,status,paid_at`, key)
    : Promise.resolve([]);
  const entitlementRows = email
    ? optionalRows(`${base}/rest/v1/stripe_billing_entitlements?email=eq.${encodeURIComponent(email)}&select=email,entitlement_key,status,updated_at`, key)
    : Promise.resolve([]);
  const [applicationOpportunities, customerOpportunities, entitlements] = await Promise.all([
    opportunityByApplication,
    opportunityByCustomer,
    entitlementRows
  ]);
  const opportunities = [...applicationOpportunities, ...customerOpportunities]
    .filter((record, index, all) => index === all.findIndex(candidate => clean(candidate?.id, 140) === clean(record?.id, 140)));
  const entity = customer
    ? { ...customer, entity_type: 'customer', application_id: applicationId, email }
    : { id: applicationId, entity_type: 'lead', application_id: applicationId, email };

  return resolveCustomerLevel({ entity, opportunities, entitlements });
}
