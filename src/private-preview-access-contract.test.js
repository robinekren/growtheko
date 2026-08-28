import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const onboard = readFileSync(new URL('./onboard/index.html', import.meta.url), 'utf8');

function redirect(source) {
  return vercel.redirects.find(item => item.source === source);
}

test('internal vision and launch preview routes are not publicly served in production', () => {
  for (const source of ['/vision', '/vision/:path*', '/launch-preview', '/launch-preview/:path*']) {
    assert.deepEqual(redirect(source), {
      source,
      destination: '/ops-login?next=/ops',
      permanent: false
    });
  }

  const revenueRedirectIndex = vercel.redirects.findIndex(item => item.source === '/vision/revenue-funnel');
  const privateVisionRedirectIndex = vercel.redirects.findIndex(item => item.source === '/vision/:path*');
  assert.ok(revenueRedirectIndex >= 0 && revenueRedirectIndex < privateVisionRedirectIndex);
});

test('visionStep sample mode is localhost-only and production removes the query without verification', () => {
  assert.match(onboard, /new Set\(\['localhost', '127\.0\.0\.1', '::1', '\[::1\]'\]\)/);
  assert.match(onboard, /if \(!localPreviewHosts\.has\(window\.location\.hostname\)\) \{[\s\S]*?urlParams\.delete\('visionStep'\);[\s\S]*?history\.replaceState\([\s\S]*?return;[\s\S]*?\}/);

  const guardIndex = onboard.indexOf("if (!localPreviewHosts.has(window.location.hostname))");
  const sampleIndex = onboard.indexOf('Object.assign(customerData, VISION_SAMPLE_DATA);');
  const verifiedIndex = onboard.indexOf('verified = true;', guardIndex);
  assert.ok(guardIndex >= 0 && sampleIndex > guardIndex && verifiedIndex > guardIndex);
  assert.ok(onboard.indexOf('return;', guardIndex) < sampleIndex);
});

test('normal onboarding does not depend on visionStep', () => {
  assert.match(onboard, /if \(!visionStep\) return;/);
  assert.match(onboard, /const onboardingToken = tokenFromUrl \|\| sessionStorage\.getItem\('ge_onboarding_token'\) \|\| '';/);
  assert.match(onboard, /await fetch\('\/api\/onboard', \{/);
});
