import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPaidOnboardingEntitlement } from './onboard.js';

const claims = { stripeCustomerId: 'cus_testMikailPolat20260820', tier: 'onetime_1997' };
const email = 'itsrobintv@gmail.com';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test('uses the durable entitlement ledger when available', async () => {
  const result = await verifyPaidOnboardingEntitlement({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'test-key',
    tokenClaims: claims,
    email,
    fetchImpl: async () => response(200, [{
      stripe_customer_id: claims.stripeCustomerId,
      entitlement_key: claims.tier,
      email,
      status: 'paid'
    }])
  });
  assert.equal(result, 'onetime_1997');
});

test('supports the signed legacy customer ledger without email-only access', async () => {
  const requests = [];
  const result = await verifyPaidOnboardingEntitlement({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'test-key',
    tokenClaims: claims,
    email,
    fetchImpl: async (url) => {
      requests.push(url);
      if (requests.length === 1) return response(404, { code: 'PGRST205' });
      return response(200, [{
        stripe_customer_id: claims.stripeCustomerId,
        email,
        status: 'paid',
        tier: 'growth'
      }]);
    }
  });
  assert.equal(result, 'onetime_1997');
  assert.equal(requests.length, 2);
});

test('rejects a legacy record that does not match the signed customer id', async () => {
  const result = await verifyPaidOnboardingEntitlement({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'test-key',
    tokenClaims: claims,
    email,
    fetchImpl: async (url) => url.includes('stripe_billing_entitlements')
      ? response(404, { code: 'PGRST205' })
      : response(200, [])
  });
  assert.equal(result, null);
});
