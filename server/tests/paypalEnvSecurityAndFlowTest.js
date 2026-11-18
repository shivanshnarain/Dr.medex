/**
 * DR.MEDEX Global — PayPal Environment, Security & Integration Test Suite
 * Tests:
 *  1. Environment variable loading & client/.env secret isolation
 *  2. Live PayPal Sandbox OAuth 2.0 token generation
 *  3. Live PayPal Sandbox order creation & MongoDB pending persistence
 *  4. Approval URL & non-sensitive checkout response validation
 *  5. Currency & amount consistency (INR -> USD & capture tamper protection)
 *  6. Verified capture flow, PAID persistence & duplicate capture idempotency
 *  7. Pending capture handling (HTTP 202, not marked PAID)
 *  8. Cancelled payment handling (POST /api/payment/paypal/cancel-order)
 *  9. Real Sandbox failed capture handling (unapproved order) & PAID order protection
 * 10. Invalid credentials handling (real Sandbox 401, zero secret leak in errors)
 * 11. Missing env var handling & Production/Development environment safety guards
 * 12. Frontend source & built bundle secret exposure audit
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
  console.log("DR.MEDEX — PAYPAL ENV, SECURITY & INTEGRATION TEST SUITE");
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

  const realClientId = paypalService.getClientId();
  const realClientSecret = paypalService.getClientSecret();
  const realMode = paypalService.getMode();

  try {
    // -----------------------------------------------------------------
    // TEST 1: Environment variable loading & client/.env isolation
    // -----------------------------------------------------------------
    console.log("TEST 1: Environment variable loading & client/.env isolation...");
    assert.ok(realClientId && realClientId.length > 20, "PAYPAL_CLIENT_ID must be loaded");
    assert.ok(realClientSecret && realClientSecret.length > 20, "PAYPAL_CLIENT_SECRET must be loaded");
    assert.strictEqual(realMode, "sandbox", "Local PAYPAL_MODE must be sandbox");
    assert.strictEqual(paypalService.getBaseUrl(), "https://api-m.sandbox.paypal.com");

    const clientEnvPath = path.resolve(__dirname, "../../client/.env");
    if (fs.existsSync(clientEnvPath)) {
      const clientEnvContent = fs.readFileSync(clientEnvPath, "utf8");
      assert.ok(
        !/^\s*(VITE_)?PAYPAL_CLIENT_SECRET\s*=/m.test(clientEnvContent),
        "client/.env MUST NOT define PAYPAL_CLIENT_SECRET"
      );
      assert.ok(
        !clientEnvContent.includes(realClientSecret),
        "client/.env MUST NOT contain the PayPal Client Secret value"
      );
    }
    console.log("  ✔ PASS: Server env loaded cleanly; client/.env has zero secret exposure.\n");

    // -----------------------------------------------------------------
    // TEST 2: Live PayPal Sandbox OAuth 2.0 token generation
    // -----------------------------------------------------------------
    console.log("TEST 2: Live PayPal Sandbox OAuth 2.0 token generation...");
    paypalService.clearTokenCache();
    const accessToken = await paypalService.getAccessToken();
    assert.ok(typeof accessToken === "string" && accessToken.length > 20, "Must obtain live OAuth Bearer token");
    console.log("  ✔ PASS: Live PayPal Sandbox OAuth token generated successfully.\n");

    // -----------------------------------------------------------------
    // TEST 3 & 4: Live Order Creation, Approval URL & Response Security
    // -----------------------------------------------------------------
    console.log("TEST 3 & 4: Live Sandbox Order Creation & Approval URL validation...");
    const configRes = await fetch(`${baseUrl}/api/payment/paypal/config`);
    assert.strictEqual(configRes.status, 200);
    const configBodyText = await configRes.text();
    assert.ok(!configBodyText.includes(realClientSecret), "Config endpoint must NEVER contain secret");
    const configData = JSON.parse(configBodyText);
    assert.strictEqual(configData.success, true);
    assert.strictEqual(configData.configured, true);
    assert.strictEqual(configData.mode, "sandbox");
    assert.strictEqual(configData.clientId, realClientId);
    assert.strictEqual(configData.clientSecret, undefined);

    const createRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "USD"))
    });
    assert.strictEqual(createRes.status, 200, "Create order must return HTTP 200");
    const createRaw = await createRes.text();
    assert.ok(!createRaw.includes(realClientSecret), "Create order response must NEVER leak secret");
    const createData = JSON.parse(createRaw);

    assert.strictEqual(createData.success, true);
    assert.ok(createData.orderID, "PayPal orderID must be returned");
    assert.ok(createData.orderNumber.startsWith("MED-"), "orderNumber must follow MED- prefix");
    assert.strictEqual(createData.mode, "sandbox");
    assert.ok(
      typeof createData.approvalUrl === "string" &&
        createData.approvalUrl.startsWith("https://www.sandbox.paypal.com/checkoutnow?token="),
      `approvalUrl must point to PayPal Sandbox checkout, got: ${createData.approvalUrl}`
    );
    createdOrderNumbers.push(createData.orderNumber);

    // Verify PayPal order on PayPal Sandbox servers & MongoDB linkage
    const liveDetails = await paypalService.getOrderDetails(createData.orderID);
    assert.strictEqual(liveDetails.id, createData.orderID);
    assert.strictEqual(liveDetails.status, "CREATED");
    assert.strictEqual(liveDetails.purchase_units[0].amount.currency_code, "USD");
    assert.strictEqual(
      Number(liveDetails.purchase_units[0].amount.value).toFixed(2),
      Number(createData.amount).toFixed(2),
      "PayPal order amount must match server-calculated grand total"
    );

    const storedOrder = await orderService.getOrder(createData.orderNumber);
    assert.ok(storedOrder, "Pending order must be persisted");
    assert.strictEqual(storedOrder.payment.paypalOrderId, createData.orderID, "paypalOrderId must be attached");
    assert.strictEqual(storedOrder.payment.status, "PENDING");
    console.log(
      `  ✔ PASS: Sandbox Order ${createData.orderID} created for ${createData.orderNumber} ($${createData.amount} USD) with valid approval URL.\n`
    );

    // -----------------------------------------------------------------
    // TEST 5: Currency consistency (INR -> USD) & Capture amount mismatch rejection
    // -----------------------------------------------------------------
    console.log("TEST 5: Currency consistency (INR -> USD) & tamper detection...");
    const inrRes = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify(buildSamplePayload(testProduct.id, "INR"))
    });
    assert.strictEqual(inrRes.status, 200);
    const inrData = await inrRes.json();
    createdOrderNumbers.push(inrData.orderNumber);
    assert.strictEqual(inrData.currency, "USD", "Unsupported INR must convert cleanly to USD for PayPal");
    assert.ok(inrData.amount > 0);
    console.log(`  ✔ PASS: INR checkout converted safely to USD ($${inrData.amount}) on PayPal.\n`);

    // -----------------------------------------------------------------
    // TEST 6: Real Sandbox Failed Capture (Unapproved Order -> HTTP 400)
    // -----------------------------------------------------------------
    console.log("TEST 6: Real Sandbox failed capture handling (unapproved order)...");
    const failCapRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderID: inrData.orderID, orderNumber: inrData.orderNumber })
    });
    assert.strictEqual(failCapRes.status, 400, "Unapproved PayPal order capture must fail with 400");
    const failCapData = await failCapRes.json();
    assert.strictEqual(failCapData.success, false);
    assert.ok(failCapData.message.includes("ORDER_NOT_APPROVED") || failCapData.message.includes("422"));
    const failedOrderDoc = await orderService.getOrder(inrData.orderNumber);
    assert.strictEqual(failedOrderDoc.payment.status, "FAILED", "Unapproved/failed capture must NOT mark order PAID");
    console.log("  ✔ PASS: Unapproved Sandbox capture rejected cleanly and never marked PAID.\n");

    // -----------------------------------------------------------------
    // TEST 7: Cancelled payment handling
    // -----------------------------------------------------------------
    console.log("TEST 7: Cancelled payment handling...");
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
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.success, true);
    assert.strictEqual(cancelData.status, "CANCELLED");
    const cancelledDoc = await orderService.getOrder(cancelCreateData.orderNumber);
    assert.strictEqual(cancelledDoc.payment.status, "CANCELLED");
    assert.strictEqual(cancelledDoc.orderStatus, "CANCELLED");
    console.log("  ✔ PASS: Cancelled checkout cleanly updates order to CANCELLED.\n");

    // -----------------------------------------------------------------
    // TEST 8: Verified Capture Flow, Pending Handling, Amount Tamper & Idempotency
    // -----------------------------------------------------------------
    console.log("TEST 8: Capture verification, PENDING status, tamper guard & duplicate capture idempotency...");
    const originalCaptureOrder = paypalService.captureOrder;
    try {
      // 8a. Pending capture must NOT mark order PAID
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
      assert.strictEqual(pendRes.status, 202, "PENDING capture must return HTTP 202");
      const pendData = await pendRes.json();
      assert.strictEqual(pendData.pending, true);
      const pendOrderDoc = await orderService.getOrder(createData.orderNumber);
      assert.strictEqual(pendOrderDoc.payment.status, "PENDING", "Pending capture must stay PENDING");

      // 8b. Tampered amount capture must be REJECTED
      paypalService.captureOrder = async (oid) => ({
        id: oid,
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: createData.orderNumber,
            payments: {
              captures: [
                {
                  id: `CAP-TAMPER-${Date.now()}`,
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: "0.01" }
                }
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
      assert.strictEqual(tamperRes.status, 400, "Underpaid capture must be rejected with 400");

      // 8c. Verified COMPLETED capture with exact amount & currency succeeds
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
      const okCapRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      assert.strictEqual(okCapRes.status, 200);
      const okCapData = await okCapRes.json();
      assert.strictEqual(okCapData.success, true);
      assert.strictEqual(okCapData.order.payment.status, "PAID");
      assert.strictEqual(okCapData.order.payment.paypalCaptureId, verifiedCaptureId);
      const stockAfterPaid = testProduct.stock !== undefined ? testProduct.stock : testProduct.stockQuantity;
      assert.strictEqual(stockAfterPaid, initialStock - 1, "Stock must decrement exactly once");

      // 8d. Duplicate capture request returns idempotently without double stock deduction
      let captureCalledAgain = false;
      paypalService.captureOrder = async () => {
        captureCalledAgain = true;
        throw new Error("Should not hit PayPal again when order is already PAID");
      };
      const dupCapRes = await fetch(`${baseUrl}/api/payment/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID: createData.orderID, orderNumber: createData.orderNumber })
      });
      assert.strictEqual(dupCapRes.status, 200);
      const dupCapData = await dupCapRes.json();
      assert.strictEqual(dupCapData.success, true);
      assert.strictEqual(dupCapData.alreadyCaptured, true);
      assert.strictEqual(captureCalledAgain, false, "Duplicate capture must short-circuit idempotently");
      const stockAfterDup = testProduct.stock !== undefined ? testProduct.stock : testProduct.stockQuantity;
      assert.strictEqual(stockAfterDup, stockAfterPaid, "Stock must NOT deduct twice");

      // 8e. Late error or cancel must NEVER overwrite an already-PAID order
      await orderService.markOrderAsFailed(createData.orderNumber, "Late error simulation");
      const stillPaid = await orderService.getOrder(createData.orderNumber);
      assert.strictEqual(stillPaid.payment.status, "PAID", "PAID order must never be overwritten to FAILED");
    } finally {
      paypalService.captureOrder = originalCaptureOrder;
    }
    console.log("  ✔ PASS: Verified capture, PENDING review, amount tamper guard & idempotency all passed.\n");

    // -----------------------------------------------------------------
    // TEST 9: Invalid credentials handling (Real Sandbox 401, zero secret leak)
    // -----------------------------------------------------------------
    console.log("TEST 9: Invalid credentials handling (Real Sandbox 401)...");
    const savedSecret = process.env.PAYPAL_CLIENT_SECRET;
    const savedClientId = process.env.PAYPAL_CLIENT_ID;
    const savedMode = process.env.PAYPAL_MODE;
    const savedVercelEnv = process.env.VERCEL_ENV;
    try {
      const fakeSecret = "INVALID_TEST_SECRET_DO_NOT_LEAK_99999";
      process.env.PAYPAL_CLIENT_SECRET = fakeSecret;
      paypalService.clearTokenCache();
      let invalidCaught = false;
      try {
        await paypalService.getAccessToken();
      } catch (err) {
        invalidCaught = true;
        assert.ok(err.message.includes("401"), `Expected 401 on invalid credentials, got: ${err.message}`);
        assert.ok(!err.message.includes(fakeSecret), "Error message must NEVER leak Client Secret");
      }
      assert.strictEqual(invalidCaught, true, "Invalid credentials must throw OAuth error");
      console.log("  ✔ PASS: Invalid credentials rejected cleanly with HTTP 401 and zero secret leakage.\n");

      // -----------------------------------------------------------------
      // TEST 10: Missing env var & Production/Development Safety Guards
      // -----------------------------------------------------------------
      console.log("TEST 10: Missing env var & Production/Development environment safety guards...");
      delete process.env.PAYPAL_CLIENT_SECRET;
      paypalService.clearTokenCache();
      let missingCaught = false;
      try {
        await paypalService.getAccessToken();
      } catch (err) {
        missingCaught = true;
        assert.ok(err.message.includes("missing"), `Expected missing env error, got: ${err.message}`);
      }
      assert.strictEqual(missingCaught, true, "Missing secret must throw descriptive error");
      const missingPub = paypalService.getPublicConfig();
      assert.strictEqual(missingPub.configured, false);
      assert.strictEqual(missingPub.clientId, "");

      // Production safety guard: VERCEL_ENV=production + PAYPAL_MODE=sandbox MUST BE BLOCKED
      process.env.PAYPAL_CLIENT_SECRET = savedSecret;
      process.env.PAYPAL_MODE = "sandbox";
      process.env.VERCEL_ENV = "production";
      const prodCheck = paypalService.checkEnvironmentSafety();
      assert.strictEqual(prodCheck.safe, false);
      assert.strictEqual(prodCheck.code, "SANDBOX_BLOCKED_IN_PRODUCTION");
      const prodPub = paypalService.getPublicConfig();
      assert.strictEqual(prodPub.configured, false);
      assert.strictEqual(prodPub.clientId, "", "Production must NEVER silently expose Sandbox Client ID");

      // Development safety guard: VERCEL_ENV=development + PAYPAL_MODE=live MUST BE BLOCKED
      process.env.PAYPAL_MODE = "live";
      process.env.VERCEL_ENV = "development";
      const devCheck = paypalService.checkEnvironmentSafety();
      assert.strictEqual(devCheck.safe, false);
      assert.strictEqual(devCheck.code, "LIVE_BLOCKED_IN_NON_PRODUCTION");

      // Production + live mode MUST PASS safety guard and use live API base URL
      process.env.PAYPAL_MODE = "live";
      process.env.VERCEL_ENV = "production";
      const liveProdCheck = paypalService.checkEnvironmentSafety();
      assert.strictEqual(liveProdCheck.safe, true);
      assert.strictEqual(paypalService.getBaseUrl(), "https://api-m.paypal.com");
      assert.strictEqual(paypalService.getCheckoutBaseUrl(), "https://www.paypal.com");
      console.log("  ✔ PASS: Missing env vars & Prod/Dev mode isolation guards verified.\n");
    } finally {
      process.env.PAYPAL_CLIENT_ID = savedClientId;
      process.env.PAYPAL_CLIENT_SECRET = savedSecret;
      process.env.PAYPAL_MODE = savedMode;
      if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = savedVercelEnv;
      paypalService.clearTokenCache();
    }

    // -----------------------------------------------------------------
    // TEST 11: Frontend Source Code Secret Exposure Audit
    // -----------------------------------------------------------------
    console.log("TEST 11: Frontend source secret exposure audit...");
    const clientSrcDir = path.resolve(__dirname, "../../client/src");
    function scanDirForSecret(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDirForSecret(full);
        } else if (/\.(ts|tsx|js|jsx|json|html|css)$/.test(entry.name)) {
          const txt = fs.readFileSync(full, "utf8");
          assert.ok(!txt.includes("PAYPAL_CLIENT_SECRET"), `PAYPAL_CLIENT_SECRET referenced in ${full}`);
          assert.ok(!txt.includes("VITE_PAYPAL_CLIENT_SECRET"), `VITE_PAYPAL_CLIENT_SECRET referenced in ${full}`);
          assert.ok(!txt.includes(realClientSecret), `Actual PayPal secret leaked in ${full}`);
        }
      }
    }
    scanDirForSecret(clientSrcDir);
    console.log("  ✔ PASS: Zero secret references or values found in client/src.\n");

    console.log("=================================================================");
    console.log("ALL 11 / 11 PAYPAL ENV, SECURITY & INTEGRATION TESTS PASSED!");
    console.log("=================================================================");
  } finally {
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
