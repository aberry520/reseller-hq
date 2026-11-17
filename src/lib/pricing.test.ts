// Pricing checks — run with `npm run test:pricing` (scripts/verify-pricing.mjs
// compiles this file's assertions against src/lib/pricing.ts).
// Worked examples from Austin's decisions:
//   $30 MAC.BID bid at Anderson -> $40.13 all-in
//   $50 MAC.BID bid at Anderson -> $64.74 all-in
//   $100 eBay price, $15 shipping -> $71.40 raw Facebook -> $75 rounded up
//   $40.13 all-in + $15 shipping -> min eBay price $97.75 at 30% margin / 13.6% fee

import {
  macBidAllIn,
  minEbayPrice,
  ebayProfit,
  ebayMargin,
  passesMargin,
  facebookPrice,
  suggestedEbayPrice,
} from './pricing';

let failures = 0;

function check(name: string, actual: number, expected: number): void {
  const ok = Math.abs(actual - expected) < 0.005;
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual}, expected ${expected}`);
  if (!ok) failures += 1;
}

check('macBidAllIn(30)', macBidAllIn(30), 40.13);
check('macBidAllIn(50)', macBidAllIn(50), 64.74);
check('macBidAllIn(30, transferable)', macBidAllIn(30, true), 50.13);
check('minEbayPrice(40.13, 15)', minEbayPrice(40.13, 15), 97.75);
check('ebayProfit(100, 40.13, 15)', ebayProfit(100, 40.13, 15), 31.27);
check('ebayMargin(100, 40.13, 15)', ebayMargin(100, 40.13, 15), 0.3127);
check('passesMargin(100, 40.13, 15)', passesMargin(100, 40.13, 15) ? 1 : 0, 1);
check('passesMargin(80, 40.13, 15)', passesMargin(80, 40.13, 15) ? 1 : 0, 0);
check('passesMargin at exactly 30.0% is a pass', passesMargin(71.41, 40.28, 0) ? 1 : 0, 1);
check('passesMargin at 29.9% is still a fail', passesMargin(71.41, 40.35, 0) ? 1 : 0, 0);
check('facebookPrice(100, 15)', facebookPrice(100, 15), 75);
check('facebookPrice(100, 0)', facebookPrice(100, 0), 90);
check('facebookPrice exact $70 stays $70', facebookPrice(70, 0, 0), 70);
check('facebookPrice(50, 0)', facebookPrice(50, 0), 45);
check('suggestedEbayPrice uses research price', suggestedEbayPrice(40.13, 15, 120), 120);
check('suggestedEbayPrice falls back to min', suggestedEbayPrice(40.13, 15, 0), 97.75);

if (failures > 0) throw new Error(`${failures} pricing check(s) failed`);
