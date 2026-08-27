import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync(new URL('./assets/growtheko-consent.js', import.meta.url), 'utf8');

test('Privacy choices clears visible fixed bottom conversion surfaces', () => {
  assert.match(controller, /const fixedCtaSelector = \[/);
  assert.match(controller, /"\[data-sticky-cta\]"/);
  assert.match(controller, /"\.sticky-cta"/);
  assert.match(controller, /style\.position !== "fixed"/);
  assert.match(controller, /window\.innerHeight - rect\.top \+ 12/);
  assert.match(controller, /--ge-consent-bottom-clearance/);
  assert.match(controller, /bottom:calc\(10px \+ var\(--ge-consent-bottom-clearance,0px\)\)/);
});

test('Privacy banner and modal suspend conflicting fixed CTAs while open', () => {
  assert.match(controller, /const privacyLayerOpen = !banner\.hidden \|\| !modal\.hidden/);
  assert.match(controller, /heldByConsentLayer = element\.classList\.contains\("ge-consent-fixed-suspended"\)/);
  assert.match(controller, /ge-consent-fixed-suspended/);
  assert.match(controller, /opacity:0!important;visibility:hidden!important;pointer-events:none!important/);
  assert.match(controller, /html\.ge-consent-modal-open \.ge-consent-settings\{opacity:0;visibility:hidden;pointer-events:none\}/);
});

test('collision state follows sticky CTA visibility, resize, orientation and scroll', () => {
  assert.match(controller, /attributeFilter: \["class", "hidden", "style"\]/);
  assert.match(controller, /addEventListener\("resize", scheduleFixedSurfaceCollision/);
  assert.match(controller, /addEventListener\("orientationchange", scheduleFixedSurfaceCollision/);
  assert.match(controller, /addEventListener\("scroll", scheduleFixedSurfaceCollision/);
  assert.match(controller, /addEventListener\("transitionend"/);
  assert.match(controller, /addEventListener\("animationend"/);
  assert.match(controller, /requestAnimationFrame\(syncFixedSurfaceCollision\)/);
});
