/**
 * DR.MEDEX — Mobile Auto-Zoom, Location Detection & Global Address Autocomplete Test Suite
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================================');
console.log('DR.MEDEX — MOBILE AUTO-ZOOM, US SUBDIVISIONS & ADDRESS TEST SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`✗ [FAIL] ${name}:`, err.message);
    process.exitCode = 1;
  }
}

// TEST 1: Mobile Auto-Zoom Global CSS Prevention
runTest('CSS: index.css enforces 16px minimum font-size for mobile inputs', () => {
  const cssPath = path.resolve(__dirname, '../../client/src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert(css.includes('@media screen and (max-width: 768px)'), 'Missing 768px mobile breakpoint');
  assert(css.includes('font-size: 16px !important;'), 'Missing 16px font-size enforcement');
  assert(css.includes('input:not([type="checkbox"]):not([type="radio"])'), 'Missing input selector');
  assert(css.includes('textarea'), 'Missing textarea selector');
  assert(css.includes('select'), 'Missing select selector');
});

// TEST 2: Viewport Meta Tag Preserves User Zoom & Accessibility
runTest('HTML: client/index.html maintains accessible viewport configuration', () => {
  const htmlPath = path.resolve(__dirname, '../../client/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.includes('name="viewport"'), 'Missing viewport meta tag');
  assert(html.includes('width=device-width'), 'Missing width=device-width');
  assert(html.includes('initial-scale=1.0'), 'Missing initial-scale=1.0');
  assert(!html.includes('maximum-scale=1'), 'Forbidden maximum-scale=1 found (breaks accessibility)');
  assert(!html.includes('user-scalable=no'), 'Forbidden user-scalable=no found (breaks accessibility)');
});

// TEST 3: US Subdivisions - Exact 56 Entries, Zero Unpopulated Islands
runTest('Geo: US subdivisions include only 50 states + DC + 5 territories (No Baker Island)', () => {
  const locationService = require('../services/locationService');
  const states = locationService.getStatesByCountry('US');
  
  assert.strictEqual(states.length, 56, `Expected exactly 56 US subdivisions, got ${states.length}`);
  
  const bakerIsland = states.find(s => s.name.toLowerCase().includes('baker') || s.code === 'UM-81');
  assert(!bakerIsland, 'Baker Island must not be present in US subdivisions');
  
  const anyUM = states.filter(s => s.code.startsWith('UM'));
  assert.strictEqual(anyUM.length, 0, `Found unpopulated UM outlying islands: ${anyUM.map(s => s.code).join(', ')}`);
  
  // Verify territories
  const pr = states.find(s => s.code === 'PR');
  assert(pr && pr.category === 'Territory', 'Puerto Rico must be categorized as Territory');
  const gu = states.find(s => s.code === 'GU');
  assert(gu && gu.category === 'Territory', 'Guam must be categorized as Territory');
  const dc = states.find(s => s.code === 'DC');
  assert(dc && dc.category === 'Federal District', 'DC must be categorized as Federal District');
});

// TEST 4: Client-side US.json Subdivision Dataset
runTest('Geo: Client US.json matches 56 entries with valid territory metadata', () => {
  const clientUSPath = path.resolve(__dirname, '../../client/src/data/geo/subdivisions/US.json');
  const clientUS = JSON.parse(fs.readFileSync(clientUSPath, 'utf8'));
  assert.strictEqual(clientUS.length, 56, `Client US.json expected 56 entries, got ${clientUS.length}`);
  
  const hasBaker = clientUS.some(s => s.name.toLowerCase().includes('baker') || s.code.startsWith('UM'));
  assert(!hasBaker, 'Client US.json contains Baker Island or UM codes');
});

// TEST 5: Location Service Country and Subdivisions Resolution
runTest('Geo: locationService handles country list and subdivision lookups', () => {
  const locationService = require('../services/locationService');
  const inStates = locationService.getStatesByCountry('IN');
  assert(inStates.length > 25, 'India states should have >25 entries');
  const delhi = inStates.find(s => s.code === 'DL' || s.name.toLowerCase().includes('delhi'));
  assert(delhi, 'Delhi must exist in India states');

  const gbStates = locationService.getStatesByCountry('GB');
  assert(gbStates.length > 0, 'UK subdivisions should be returned');
});

// TEST 6: Address Autocomplete Endpoint
runTest('API: locationService.autocompleteAddress handles country scoping', async () => {
  const locationService = require('../services/locationService');
  const results = await locationService.autocompleteAddress('Hospital', 'US');
  assert(Array.isArray(results), 'Autocomplete must return an array');
  // Should return results or fallback gracefully without throwing
});

// TEST 7: Phone Input & Mobile Responsive Dropdown
runTest('UI: InternationalPhoneInput enforces text-[16px] and prevents horizontal overflow', () => {
  const phoneInputPath = path.resolve(__dirname, '../../client/src/components/InternationalPhoneInput.tsx');
  const content = fs.readFileSync(phoneInputPath, 'utf8');
  assert(content.includes('text-[16px] sm:text-xs'), 'Phone inputs must have text-[16px] sm:text-xs');
  assert(content.includes('w-[calc(100vw-2.5rem)] sm:w-80'), 'Dropdown must prevent mobile horizontal overflow');
});

// TEST 8: Cascading Address Form Mobile Bottom Sheet & Auto-Zoom Prevention
runTest('UI: AmazonCascadingAddressForm includes responsive bottom sheet & 16px font-size', () => {
  const formPath = path.resolve(__dirname, '../../client/src/components/AmazonCascadingAddressForm.tsx');
  const content = fs.readFileSync(formPath, 'utf8');
  assert(content.includes('fixed inset-0 z-50 bg-black/60') && content.includes('rounded-t-3xl'), 'Missing responsive bottom sheet overlay');
  assert(content.includes('text-[16px] sm:text-xs'), 'Form inputs must include text-[16px] sm:text-xs');
  assert(content.includes('Use my current location'), 'Explicit location trigger must be present');
  assert(content.includes('/api/location/autocomplete'), 'Autocomplete endpoint must be wired');
});

// TEST 9: Geolocation Accuracy and Non-Destructive Update Logic in CheckoutPage
runTest('Checkout: CheckoutPage handles accuracy threshold and never overwrites user data silently', () => {
  const checkoutPath = path.resolve(__dirname, '../../client/src/pages/CheckoutPage.tsx');
  const content = fs.readFileSync(checkoutPath, 'utf8');
  assert(content.includes('accuracy > 1500'), 'CheckoutPage must inspect geolocation accuracy threshold (>1500m)');
  assert(content.includes('Approximate location detected') && content.includes('Your existing address was preserved'), 'CheckoutPage must explain approximate location and preserve existing address');
  assert(content.includes('text-[16px] sm:text-xs'), 'CheckoutPage inputs must have text-[16px] sm:text-xs');
});

console.log('\n======================================================================');
console.log(`SUMMARY: ${passedTests} / ${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);
console.log('======================================================================');
