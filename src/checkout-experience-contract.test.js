import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BILLING_TERMS_VERSION, parseCheckoutInput } from './api/lib/billing-config.js';
import { OFFER_REGISTRY } from './api/lib/offer-registry.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function validAuditCheckout(overrides = {}) {
  return {
    offer: 'onetime_1997',
    requestId: 'founder-qa-1997',
    companyName: 'Robin Ekren',
    buyerCountry: 'AT',
    email: 'robinekrenn@gmail.com',
    acceptsB2B: true,
    acceptsTerms: true,
    acceptsElectronicInvoices: true,
    termsVersion: BILLING_TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
    ...overrides
  };
}

test('Audit public CTA uses the customer-facing copy and canonical $1,997 checkout destination', () => {
  const offer = read('./offer/index.html');
  const publicPages = `${offer}\n${read('./start/index.html')}`;

  assert.equal(OFFER_REGISTRY.audit.primaryCta, 'Start your AI Operator Audit');
  assert.equal(OFFER_REGISTRY.audit.route, '/start?checkout=onetime_1997');
  assert.match(offer, /cta:'Start your AI Operator Audit',href:'\/start\?checkout=onetime_1997'/);
  assert.doesNotMatch(publicPages, /Audit auswählen|zum Checkout wechseln/i);
});

test('checkout dialog locks page scroll and confines scrolling to a safe-area-aware inner viewport', () => {
  const start = read('./start/index.html');

  assert.match(start, /html\.checkout-open,html\.checkout-open body \{ overflow:hidden; overscroll-behavior:none; \}/);
  assert.match(start, /html\.checkout-open body \{ position:fixed;/);
  assert.match(start, /dialog \{ position:fixed; inset:0;/);
  assert.match(start, /100dvh - max\(14px,env\(safe-area-inset-top\)\) - max\(14px,env\(safe-area-inset-bottom\)\)/);
  assert.match(start, /dialog::backdrop \{ position:fixed; inset:0;/);
  assert.match(start, /\.modal \{ max-height:inherit; display:flex; flex-direction:column; padding:0; overflow:hidden; \}/);
  assert.match(start, /\.modal-scroll \{ min-height:0;[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain;/);
  assert.match(start, /\.modal-footer \{ position:sticky;[^}]*bottom:0;/);
  assert.match(start, /padding:10px 30px calc\(18px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(start, /<div class="modal-scroll">[\s\S]*<div class="modal-footer">/);
  assert.match(start, /function lockPageScroll\(\)/);
  assert.match(start, /document\.body\.style\.top = '-' \+ checkoutScrollY \+ 'px'/);
  assert.match(start, /modal\.addEventListener\('close', unlockPageScroll\)/);
  assert.match(start, /window\.scrollTo\(0, checkoutScrollY\)/);
});

test('sole traders can use their legal name, while consumer use is not misrepresented as B2B', () => {
  const start = read('./start/index.html');
  const parsed = parseCheckoutInput(validAuditCheckout());

  assert.equal(parsed.companyName, 'Robin Ekren');
  assert.equal(parsed.acceptsB2B, true);
  assert.match(start, /sole traders and freelancers without a registered company can enter their full legal name/i);
  assert.match(start, /not for personal consumer use/i);
  assert.match(start, /Do not confirm the business-purchase statement or continue to payment/i);
  assert.match(start, /href="\/start">Return to the offer overview<\/a>/);
  assert.match(start, /href="\/contact">contact GrowthEko<\/a>/);
  assert.throws(
    () => parseCheckoutInput(validAuditCheckout({ acceptsB2B: false })),
    error => error?.code === 'b2b_attestation_required'
  );
});

test('public legal pages contain required operator facts without internal launch-review copy', () => {
  const imprint = read('./imprint/index.html');
  const terms = read('./terms/index.html');
  const privacy = read('./privacy/index.html');
  const legal = `${imprint}\n${terms}\n${privacy}`;

  assert.match(imprint, /Robin Ekren, sole proprietor/);
  assert.match(imprint, /VAT ID: ATU83303738/);
  assert.match(imprint, /GISA 39946621/);
  assert.match(terms, /offered exclusively to entrepreneurs purchasing for their business/i);
  assert.match(terms, /Austrian domestic B2B orders are ordinarily subject to 20% Austrian VAT/);
  assert.match(privacy, /Business identity, contact, billing, country, and payment information/);
  assert.doesNotMatch(legal, /Launch review boundary|local preparation reflects|licensed legal review|explicit deployment approval|AI-to-Robin/i);
  assert.doesNotMatch(imprint, /class="notice"|--gold:/);
});
