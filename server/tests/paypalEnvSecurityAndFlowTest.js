/**
 * DR.MEDEX Global — PayPal Sandbox + Live Environment, Security & Integration Test Suite
 * Tests:
 *  1. Root .env dual credential sets (Sandbox + Live) & active mode dynamic selection
 *  2. client/.env secret isolation (neither Sandbox nor Live secret present)
 *  3. Live PayPal SANDBOX OAuth 2.0 token generation
 *  4. Live PayPal LIVE OAuth 2.0 token generation
 *  5. Live PayPal LIVE Order Creation (NO capture / NO real charge) & Live approval URL
 *  6. Live PayPal SANDBOX Order Creation, Approval URL & MongoDB persistence
 *  7. Currency consistency (INR -> USD) & capture tamper protection
 *  8. Real Sandbox failed capture (unapproved order) & Cancelled checkout handling
 *  9. Verified capture flow, PENDING review, amount tamper guard & duplicate capture idempotency
 * 10. Invalid credentials handling (401, zero secret leak) & Production/Preview safety guards
 * 11. Frontend source code secret exposure audit (checks BOTH Sandbox & Live secrets)
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = require("../index");
const store = require("../services/store");
const mongoService = require("../services/mongoService");
const paypalService = require("../services/paypalService");
const orderService = require("../services/orderService");

const createdOrderNumbers = [];

async function cleanupTestOrders() {
  try {
    const client = await mongoService.getClient();
    const db = client.db();
    for (const orderNumber of createdOrderNumbers) {
      await db.collection("orders").deleteOne({ orderNumber }).catch(() => {});
      const idx = store.getOrders().findIndex((o) => o.orderNumber === orderNumber);
      if (idx !== -1) store.getOrders().splice(idx, 1);
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

function buildSamplePayload(productId, currency = "USD") {
  return {
    customer: {
      firstName: "Dr. Meera",
      lastName: "Nair",
      fullName: "Dr. Meera Nair",
      email: "meera.nair.test@drmedex-sandbox.org",
      phone: "+1 415-555-0142",
      companyName: "Pacific Surgical Institute",
      countryCode: currency === "INR" ? "IN" : "US"
    },
    shippingAddress: {
      fullName: "Dr. Meera Nair",
      addressLine1: "750 Medical Center Way",
      city: currency === "INR" ? "Mumbai" : "San Francisco",
      state: currency === "INR" ? "Maharashtra" : "CA",
      stateCode: currency === "INR" ? "MH" : "CA",
      postalCode: currency === "INR" ? "400001" : "94143",
      country: currency === "INR" ? "India" : "United States",
      countryCode: currency === "INR" ? "IN" : "US"
    },
    currency,
    items: [{ productId, quantity: 1 }]
  };
}

async function runTests() {
  console.log("=================================================================");
  console.log("DR.MEDEX — PAYPAL SANDBOX + LIVE ENV, SECURITY & FLOW TEST SUITE");
  console.log("=================================================================\n");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://localhost:${port}`;

  const products = store.getProducts();
  assert.ok(products.length > 0, "Catalogue must contain products");
  const testProduct = products[0];
  const initialStock =
    testProduct.stock !== undefined ? testProduct.stock : (testProduct.stockQuantity || 100);

  const savedEnv = {
    PAYPAL_MODE: process.env.PAYPAL_MODE,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_SANDBOX_CLIENT_ID: process.env.PAYPAL_SANDBOX_CLIENT_ID,
    PAYPAL_SANDBOX_CLIENT_SECRET: process.env.PAYPAL_SANDBOX_CLIENT_SECRET,
    PAYPAL_LIVE_CLIENT_ID: process.env.PAYPAL_LIVE_CLIENT_ID,
    PAYPAL_LIVE_CLIENT_SECRET: process.env.PAYPAL_LIVE_CLIENT_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV
  };

  const sandboxSecret = (process.env.PAYPAL_SANDBOX_CLIENT_SECRET || "").trim();
  const liveSecret = (process.env.PAYPAL_LIVE_CLIENT_SECRET || "").trim();

  try {
    // -----------------------------------------------------------------
    // TEST 1: Root .env dual credential sets & dynamic mode selection
    // -----------------------------------------------------------------
    console.log("TEST 1: Root .env dual credential sets & dynamic mode selection...");
    assert.ok(process.env.PAYPAL_SANDBOX_CLIENT_ID, "PAYPAL_SANDBOX_CLIENT_ID must be present in root .env");
    assert.ok(sandboxSecret, "PAYPAL_SANDBOX_CLIENT_SECRET must be present in root .env");
    assert.ok(process.env.PAYPAL_LIVE_CLIENT_ID, "PAYPAL_LIVE_CLIENT_ID must be present in root .env");
    assert.ok(liveSecret, "PAYPAL_LIVE_CLIENT_SECRET must be present in root .env");
    assert.notStrictEqual(
      process.env.PAYPAL_SANDBOX_CLIENT_ID,
      process.env.PAYPAL_LIVE_CLIENT_ID,
      "Sandbox and Live Client IDs must be distinct"
    );

    // Verify dynamic mode selection selects Live creds when PAYPAL_MODE=live
    process.env.PAYPAL_MODE = "live";
    assert.strictEqual(paypalService.getClientId(), process.env.PAYPAL_LIVE_CLIENT_ID.trim());
    assert.strictEqual(paypalService.getClientSecret(), liveSecret);
    assert.strictEqual(paypalService.getBaseUrl(), "https://api-m.paypal.com");

    // Verify dynamic mode selection selects Sandbox creds when PAYPAL_MODE=sandbox
    process.env.PAYPAL_MODE = "sandbox";
    assert.strictEqual(paypalService.getClientId(), process.env.PAYPAL_SANDBOX_CLIENT_ID.trim());
    assert.strictEqual(paypalService.getClientSecret(), sandboxSecret);
    assert.strictEqual(paypalService.getBaseUrl(), "https://api-m.sandbox.paypal.com");

    // Verify client/.env has zero secrets
    const clientEnvPath = path.resolve(__dirname, "../../client/.env");
    if (fs.existsSync(clientEnvPath)) {
      const clientEnvContent = fs.readFileSync(clientEnvPath, "utf8");
      assert.ok(!/^\s*(VITE_)?PAYPAL_.*SECRET\s*=/m.test(clientEnvContent), "client/.env MUST NOT define any PayPal secret");
      assert.ok(!clientEnvContent.includes(sandboxSecret), "client/.env MUST NOT contain Sandbox secret");
      assert.ok(!clientEnvContent.includes(liveSecret), "client/.env MUST NOT contain Live secret");
    }
    console.log("  ✔ PASS: Dual credential sets verified; dynamic mode selection & client/.env isolation passed.\n");

    // -----------------------------------------------------------------
    // TEST 2: Live PayPal LIVE OAuth 2.0 + Live Order Creation (NO CAPTURE)
    // -----------------------------------------------------------------
    console.log("TEST 2: Live PayPal LIVE OAuth & Live Order Creation (NO capture / NO charge)...");
    process.env.PAYPAL_MODE = "live";
    delete process.env.VERCEL_ENV;
    paypalService.clearTokenCache();

    const liveToken = await paypalService.getAccessToken();
    assert.ok(typeof liveToken === "string" && liveToken.length > 20, "Live OAuth must return Bearer token");

    const liveConfigRes = await fetch(`${baseUrl}/api/payment/paypal/config`);
    assert.strictEqual(liveConfigRes.status, 200);
    const liveConfigText = await liveConfigRes.text();
    assert.ok(!liveConfigText.includes(liveSecret) && !liveConfigText.includes(sandboxSecret), "Config must NEVER leak secrets");
    const liveConfig = JSON.parse(liveConfigText);
    assert.strictEqual(liveConfig.mode, "live");
    assert.strictEqual(liveConfig.configured, true);
    assert.strictEqual(liveConfig.hasClientId, true);
    assert.strictEqual(liveConfig.hasClientSecret, true);

    const liveCreateRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://drmedex.vercel.app" },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "USD"))
    });
    assert.strictEqual(liveCreateRes.status, 200, "Live order creation must return HTTP 200");
    const liveCreateRaw = await liveCreateRes.text();
    assert.ok(!liveCreateRaw.includes(liveSecret) && !liveCreateRaw.includes(liveToken), "Create response must NEVER leak secret or token");
    const liveCreateData = JSON.parse(liveCreateRaw);
    assert.strictEqual(liveCreateData.success, true);
    assert.strictEqual(liveCreateData.mode, "live");
    assert.ok(liveCreateData.orderID, "Live PayPal Order ID must be returned");
    assert.ok(
      typeof liveCreateData.approvalUrl === "string" &&
        liveCreateData.approvalUrl.startsWith("https://www.paypal.com/checkoutnow?token="),
      `Live approvalUrl must point to https://www.paypal.com/checkoutnow?token=..., got: ${liveCreateData.approvalUrl}`
    );
    createdOrderNumbers.push(liveCreateData.orderNumber);

    const liveDetails = await paypalService.getOrderDetails(liveCreateData.orderID);
    assert.strictEqual(liveDetails.id, liveCreateData.orderID);
    assert.strictEqual(liveDetails.status, "CREATED");
    console.log(
      `  ✔ PASS: Live OAuth OK & Live Order ${liveCreateData.orderID} CREATED ($${liveCreateData.amount} USD) with official Live approval URL (NO payment captured).\n`
    );

    // -----------------------------------------------------------------
    // TEST 3: Live PayPal SANDBOX OAuth 2.0 + Order Creation + Approval URL
    // -----------------------------------------------------------------
    console.log("TEST 3: Live PayPal SANDBOX OAuth, Order Creation & Approval URL...");
    process.env.PAYPAL_MODE = "sandbox";
    paypalService.clearTokenCache();

    const sandboxToken = await paypalService.getAccessToken();
    assert.ok(typeof sandboxToken === "string" && sandboxToken.length > 20, "Sandbox OAuth must return Bearer token");

    const createRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "USD"))
    });
    assert.strictEqual(createRes.status, 200);
    const createRaw = await createRes.text();
    assert.ok(!createRaw.includes(sandboxSecret) && !createRaw.includes(sandboxToken), "Response must NEVER leak secret or token");
    const createData = JSON.parse(createRaw);
    assert.strictEqual(createData.success, true);
    assert.strictEqual(createData.mode, "sandbox");
    assert.ok(
      createData.approvalUrl.startsWith("https://www.sandbox.paypal.com/checkoutnow?token="),
      `Sandbox approvalUrl mismatch: ${createData.approvalUrl}`
    );
    createdOrderNumbers.push(createData.orderNumber);

    const storedOrder = await orderService.getOrder(createData.orderNumber);
    assert.strictEqual(storedOrder.payment.paypalOrderId, createData.orderID);
    assert.strictEqual(storedOrder.payment.status, "PENDING");
    console.log(`  ✔ PASS: Sandbox OAuth OK & Sandbox Order ${createData.orderID} created for ${createData.orderNumber}.\n`);

    // -----------------------------------------------------------------
    // TEST 4: INR -> USD conversion & Real Sandbox unapproved capture failure
    // -----------------------------------------------------------------
    console.log("TEST 4: Currency conversion (INR -> USD) & real Sandbox unapproved capture failure...");
    const inrRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "INR"))
    });
    const inrData = await inrRes.json();
    createdOrderNumbers.push(inrData.orderNumber);
    assert.strictEqual(inrData.currency, "USD");

    const failCapRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderID: inrData.orderID, orderNumber: inrData.orderNumber })
    });
    assert.strictEqual(failCapRes.status, 400);
    const failedDoc = await orderService.getOrder(inrData.orderNumber);
    assert.strictEqual(failedDoc.payment.status, "FAILED");
    console.log("  ✔ PASS: INR -> USD conversion & unapproved capture rejection verified.\n");

    // -----------------------------------------------------------------
    // TEST 5: Cancelled payment handling
    // -----------------------------------------------------------------
    console.log("TEST 5: Cancelled payment handling...");
    const cancelCreateRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "USD"))
    });
    const cancelCreateData = await cancelCreateRes.json();
    createdOrderNumbers.push(cancelCreateData.orderNumber);

    const cancelRes = await fetch(`${baseUrl}/api/payment/paypal/cancel-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: cancelCreateData.orderNumber, orderID: cancelCreateData.orderID })
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelledDoc = await orderService.getOrder(cancelCreateData.orderNumber);
    assert.strictEqual(cancelledDoc.payment.status, "CANCELLED");
    console.log("  ✔ PASS: Cancelled checkout cleanly updates order to CANCELLED.\n");

    // -----------------------------------------------------------------
    // TEST 6: Verified capture flow, PENDING review, tamper guard & idempotency
    // -----------------------------------------------------------------
    console.log("TEST 6: Capture verification, PENDING review, amount tamper guard & idempotency...");
    const originalCaptureOrder = paypalService.captureOrder;
    try {
      paypalService.captureOrder = async (oid) => ({
        id: oid,
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: createData.orderNumber,
            payments: {
              captures: [
                {
                  id: `CAP-PEND-${Date.now()}`,
                  status: "PENDING",
                  status_details: { reason: "ECHECK" },
                  amount: { currency_code: "USD", value: Number(createData.amount).toFixed(2) }
                }
              ]
            }
          }
        ]
      });
      const pendRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      assert.strictEqual(pendRes.status, 202);

      paypalService.captureOrder = async (oid) => ({
        id: oid,
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: createData.orderNumber,
            payments: {
              captures: [
                { id: `CAP-TAMPER-${Date.now()}`, status: "COMPLETED", amount: { currency_code: "USD", value: "0.01" } }
              ]
            }
          }
        ]
      });
      const tamperRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      assert.strictEqual(tamperRes.status, 400);

      const verifiedCaptureId = `CAP-OK-${Date.now()}`;
      paypalService.captureOrder = async (oid) => ({
        id: oid,
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: createData.orderNumber,
            payments: {
              captures: [
                {
                  id: verifiedCaptureId,
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: Number(createData.amount).toFixed(2) }
                }
              ]
            }
          }
        ]
      });
      const okRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      assert.strictEqual(okRes.status, 200);
      const okData = await okRes.json();
      assert.strictEqual(okData.order.payment.status, "PAID");
      const stockAfterPaid = testProduct.stock !== undefined ? testProduct.stock : testProduct.stockQuantity;
      assert.strictEqual(stockAfterPaid, initialStock - 1);

      const dupRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      const dupData = await dupRes.json();
      assert.strictEqual(dupData.alreadyCaptured, true);
      const stockAfterDup = testProduct.stock !== undefined ? testProduct.stock : testProduct.stockQuantity;
      assert.strictEqual(stockAfterDup, stockAfterPaid);

      await orderService.markOrderAsFailed(createData.orderNumber, "Late error");
      const stillPaid = await orderService.getOrder(createData.orderNumber);
      assert.strictEqual(stillPaid.payment.status, "PAID");
    } finally {
      paypalService.captureOrder = originalCaptureOrder;
    }
    console.log("  ✔ PASS: Capture verification, PENDING, tamper guard & duplicate idempotency passed.\n");

    // -----------------------------------------------------------------
    // TEST 7: Invalid credentials, Missing env vars & Prod/Preview safety guards
    // -----------------------------------------------------------------
    console.log("TEST 7: Invalid credentials, missing env & Production/Preview safety guards...");
    const fakeSecret = "INVALID_TEST_SECRET_DO_NOT_LEAK_99999";
    process.env.PAYPAL_MODE = "sandbox";
    process.env.PAYPAL_SANDBOX_CLIENT_SECRET = fakeSecret;
    process.env.PAYPAL_CLIENT_SECRET = fakeSecret;
    paypalService.clearTokenCache();
    let invalidCaught = false;
    try {
      await paypalService.getAccessToken();
    } catch (err) {
      invalidCaught = true;
      assert.ok(err.message.includes("401"));
      assert.ok(!err.message.includes(fakeSecret), "Error must NEVER leak secret");
    }
    assert.strictEqual(invalidCaught, true);

    // Production guard: VERCEL_ENV=production + PAYPAL_MODE=sandbox MUST BE BLOCKED
    process.env.PAYPAL_SANDBOX_CLIENT_SECRET = savedEnv.PAYPAL_SANDBOX_CLIENT_SECRET;
    process.env.PAYPAL_MODE = "sandbox";
    process.env.VERCEL_ENV = "production";
    assert.strictEqual(paypalService.checkEnvironmentSafety().code, "SANDBOX_BLOCKED_IN_PRODUCTION");
    assert.strictEqual(paypalService.getPublicConfig().configured, false);

    // Preview guard: VERCEL_ENV=preview + PAYPAL_MODE=live MUST BE BLOCKED
    process.env.PAYPAL_MODE = "live";
    process.env.VERCEL_ENV = "preview";
    assert.strictEqual(paypalService.checkEnvironmentSafety().code, "LIVE_BLOCKED_IN_NON_PRODUCTION");

    // Production + Live MUST PASS
    process.env.PAYPAL_MODE = "live";
    process.env.VERCEL_ENV = "production";
    assert.strictEqual(paypalService.checkEnvironmentSafety().safe, true);
    assert.strictEqual(paypalService.getPublicConfig().configured, true);
    console.log("  ✔ PASS: Invalid creds, Production safety guard & Preview safety guard verified.\n");

    // -----------------------------------------------------------------
    // TEST 8: Frontend source secret exposure audit (Sandbox & Live secrets)
    // -----------------------------------------------------------------
    console.log("TEST 8: Frontend source secret exposure audit...");
    const clientSrcDir = path.resolve(__dirname, "../../client/src");
    function scanDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else if (/\.(ts|tsx|js|jsx|json|html|css)$/.test(entry.name)) {
          const txt = fs.readFileSync(full, "utf8");
          assert.ok(!txt.includes("PAYPAL_CLIENT_SECRET"), `PAYPAL_CLIENT_SECRET in ${full}`);
          assert.ok(!txt.includes("PAYPAL_LIVE_CLIENT_SECRET"), `PAYPAL_LIVE_CLIENT_SECRET in ${full}`);
          assert.ok(!txt.includes("PAYPAL_SANDBOX_CLIENT_SECRET"), `PAYPAL_SANDBOX_CLIENT_SECRET in ${full}`);
          assert.ok(!txt.includes(sandboxSecret), `Sandbox secret leaked in ${full}`);
          assert.ok(!txt.includes(liveSecret), `Live secret leaked in ${full}`);
        }
      }
    }
    scanDir(clientSrcDir);
    console.log("  ✔ PASS: Zero Sandbox or Live secrets found in client/src.\n");

    console.log("=================================================================");
    console.log("ALL 8 / 8 SANDBOX + LIVE PAYPAL INTEGRATION TESTS PASSED!");
    console.log("=================================================================");
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    paypalService.clearTokenCache();
    await cleanupTestOrders();
    testProduct.stock = initialStock;
    testProduct.stockQuantity = initialStock;
    server.close();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ TEST SUITE FAILED:", err);
    process.exit(1);
  });
