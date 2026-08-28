import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('retired GrowthEko entry routes redirect to the RobinEkren experiment', () => {
  const config = JSON.parse(read('./vercel.json'));
  const destinations = new Map(config.redirects.map(({ source, destination }) => [source, destination]));

  for (const source of ['/revenue-leak', '/scorecard', '/vision/revenue-funnel']) {
    assert.equal(destinations.get(source), 'https://www.robinekren.com/digital-estate');
  }
});

test('GrowthEko Terms exclude the retired USD 7 scorecard', () => {
  const terms = read('./terms/index.html');

  assert.doesNotMatch(terms, /Revenue Leak Scorecard/i);
  assert.doesNotMatch(terms, /\$7\s+USD/i);
  assert.match(terms, /Version 1\.3/);
});

test('application consumes canonical offer links and routes current direct offers to checkout', () => {
  const apply = read('./apply/index.html');
  const offer = read('./offer/index.html');

  assert.match(apply, /params\.get\('offer'\) \|\| params\.get\('tier'\)/);
  assert.match(apply, /'done_with_you_4997': \{ label: 'AI System Sprint'/);
  assert.match(apply, /'done_for_you_14997': \{ label: 'AI Empire Architect'/);
  assert.match(offer, /href:'\/apply\?offer=done_with_you_4997'/);
  assert.match(offer, /href:'\/apply\?offer=done_for_you_14997'/);
  assert.match(apply, /window\.location\.replace\('\/start\?checkout=monthly_97'\)/);
  assert.match(apply, /window\.location\.replace\('\/start\?checkout=onetime_1997'\)/);
});
