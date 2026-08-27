import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(new URL('./portal/index.html', import.meta.url), 'utf8');
const support = readFileSync(new URL('./api/portal-support.js', import.meta.url), 'utf8');

test('newest approved Instagram listing is visible without publishing unverified analytics as fact', () => {
  assert.match(portal, /data-listing-id="ashalea-1"/);
  assert.match(portal, /data-listing-platform="instagram"/);
  assert.match(portal, /@ashalea_1/);
  assert.match(portal, /184K · Instagram · Model &amp; Fashion/);
  assert.match(portal, /US · claimed/);
  assert.match(portal, /Seller-submitted analytics are pending review/);
  assert.doesNotMatch(portal, /data-listing-id="ashalea-1"[\s\S]{0,2500}Verified analytics/);
});

test('request API recognizes the new listing using the same canonical identity', () => {
  assert.match(support, /'ashalea-1': \{/);
  assert.match(support, /username: '@ashalea_1'/);
  assert.match(support, /platform: 'Instagram'/);
  assert.match(support, /niche: 'Model & Fashion Girls'/);
});
