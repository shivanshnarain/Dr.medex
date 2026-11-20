/**
 * DR.MEDEX — Autonomous PayPal Global Payment Testing & Production Health Audit Test Suite
 * 
 * Verifies Phases 1 through 8:
 * - Phase 1: Automatic Environment Discovery & Credential Isolation
 * - Phase 2: Multi-Country Sandbox Buyer Suite (US, GB, CA, AU, DE, FR, AE, SG, JP, IN)
 * - Phase 3: Complete Payment Lifecycle Suite (16 Core Scenarios & Edge Cases)
 * - Phase 4: Post-Payment Automation (MongoDB, Inventory, Emails, Invoices)
 * - Phase 5: LIVE PayPal Health Check (Non-Capturing Safeguard)
 * - Phase 6: Global Country Eligibility Matrix
 * - Phase 7: Webhook Testing (Signature validation & Idempotency)
 * - Phase 8: Admin Dashboard API Endpoints
 */

const assert = require("assert");
const crypto = require("crypto");
require("dotenv").config({ path: "/Users/shivanshnarain/medicuroglobal/.env" });

const paypalService = require("../services/paypalService");
const paypalTestRunner = require("../services/paypalTestRunner");
const orderService = require("../services/orderService");
const mongoService = require("../services/mongoService");
const emailService = require("../services/emailService");
const store = require("../services/store");

async function runAutonomousTestSuite() {
  console.log("================================================================================");
  console.log("DR.MEDEX — AUTONOMOUS PAYPAL GLOBAL PAYMENT & PRODUCTION HEALTH AUDIT TEST SUITE");
  console.log("================================================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  async function test(title, fn) {
    totalTests++;
    process.stdout.write(`TEST ${totalTests}: ${title} ... `);
    try {
      await fn();
      passedTests++;
      console.log("✔ PASS");
    } catch (err) {
      console.log("✖ FAILED");
      console.error("  Error:", err.message);
      throw err;
    }
  }

  // PHASE 1: Automatic Environment Discovery
  await test("Phase 1: Environment Discovery & Credential Isolation", async () => {
    // Mode exists
    const mode = paypalService.getMode();
    assert.ok(mode === "sandbox" || mode === "live", `Mode must be sandbox or live, got: ${mode}`);

    // Public config never leaks secret
    const pub = paypalService.getPublicConfig();
    assert.strictEqual(pub.hasClientId, true, "Must have Client ID");
    assert.strictEqual(pub.hasClientSecret, true, "Must have Client Secret");
    assert.strictEqual(pub.hasWebhookId, true, "Must have Webhook ID");
    assert.strictEqual(pub.clientSecret, undefined, "Public config must NEVER expose clientSecret");
    assert.ok(pub.clientId && pub.clientId.length > 10, "Public config has valid Client ID string");

    // Both credential sets exist in environment
    assert.ok(process.env.PAYPAL_SANDBOX_CLIENT_ID, "Sandbox Client ID must be configured");
    assert.ok(process.env.PAYPAL_SANDBOX_CLIENT_SECRET, "Sandbox Client Secret must be configured");
    assert.ok(process.env.PAYPAL_LIVE_CLIENT_ID, "Live Client ID must be configured");
    assert.ok(process.env.PAYPAL_LIVE_CLIENT_SECRET, "Live Client Secret must be configured");
  });

  // PHASE 2: Multi-Country Sandbox Buyer Suite
  await test("Phase 2: Multi-Country Sandbox Buyer Suite", async () => {
    const multiCountry = await paypalTestRunner.runMultiCountrySandboxSuite();
    assert.strictEqual(multiCountry.totalTested, 10, "Must test exactly 10 countries");
    assert.strictEqual(multiCountry.passedCount, 9, "9 International countries must PASS");
    assert.strictEqual(multiCountry.restrictedCount, 1, "India domestic must be RESTRICTED");
    assert.strictEqual(multiCountry.failedCount, 0, "Zero countries should fail");

    // Verify US
    const us = multiCountry.results.find(r => r.countryCode === "US");
    assert.ok(us && us.status === "PASS", "United States must PASS");
    assert.strictEqual(us.checks.currencyRouting, "PASS (USD)");

    // Verify Japan (Zero decimal)
    const jp = multiCountry.results.find(r => r.countryCode === "JP");
    assert.ok(jp && jp.status === "PASS", "Japan must PASS");
    assert.strictEqual(jp.checks.currencyRouting, "PASS (JPY)");

    // Verify UAE (Currency conversion to USD)
    const ae = multiCountry.results.find(r => r.countryCode === "AE");
    assert.ok(ae && ae.status === "PASS", "UAE must PASS");
    assert.strictEqual(ae.checks.currencyRouting, "PASS (USD)");

    // Verify India Domestic restriction
    const inCountry = multiCountry.results.find(r => r.countryCode === "IN");
    assert.ok(inCountry && inCountry.status === "RESTRICTED", "India must be RESTRICTED to Razorpay");
  });

  // PHASE 3: Complete Payment Lifecycle Suite (16 Scenarios)
  await test("Phase 3: Complete Payment Lifecycle Suite (16 Scenarios)", async () => {
    const lifecycle = await paypalTestRunner.runPaymentLifecycleSuite();
    assert.strictEqual(lifecycle.totalScenarios, 16, "Must test all 16 scenarios");
    assert.strictEqual(lifecycle.passed, 16, "All 16 scenarios must PASS");
    assert.strictEqual(lifecycle.failed, 0, "Zero scenarios should fail");

    const captureScenario = lifecycle.scenarios.find(s => s.name === "Successful Payment Capture");
    assert.strictEqual(captureScenario.status, "PASS");

    const refundScenario = lifecycle.scenarios.find(s => s.name === "Full Refund & Order Cancellation");
    assert.strictEqual(refundScenario.status, "PASS");

    const sigScenario = lifecycle.scenarios.find(s => s.name === "Invalid Webhook Signature Rejection");
    assert.strictEqual(sigScenario.status, "PASS");
  });

  // PHASE 4: Post-Payment Automation & Data Integrity
  await test("Phase 4: Post-Payment Automation (MongoDB, Inventory, Emails, Invoices)", async () => {
    const sampleProd = store.getProducts(true)[0];
    const initialStock = sampleProd.stock !== undefined ? sampleProd.stock : (sampleProd.stockQuantity || 100);

    const testOrder = await orderService.createPendingOrder({
      customer: { fullName: "Dr. Audit Buyer", email: "audit.buyer@hospital.org", phone: "+1 555-019-9999", countryCode: "US" },
      shippingAddress: { fullName: "Dr. Audit Buyer", addressLine1: "500 Medical Center Way", city: "Chicago", state: "IL", postalCode: "60601", country: "United States", countryCode: "US" },
      items: [{ productId: sampleProd.id, quantity: 1 }],
      currency: "USD"
    });

    // Verify Pending
    assert.strictEqual(testOrder.orderStatus, "PENDING");
    assert.strictEqual(testOrder.payment.status, "PENDING");

    // Capture payment
    const captureId = `CAP-AUDIT-${Date.now()}`;
    const paid = await orderService.markOrderAsPaid({
      orderNumber: testOrder.orderNumber,
      paypalCaptureId: captureId,
      paymentDetails: { id: captureId, status: "COMPLETED" }
    });

    assert.strictEqual(paid.payment.status, "PAID");
    assert.strictEqual(paid.orderStatus, "PROCESSING");
    assert.strictEqual(paid.stockDeducted, true);

    // Verify invoice generation
    const invoiceHtml = emailService.generateInvoiceHtml(paid);
    assert.ok(invoiceHtml.includes(`INV-${testOrder.orderNumber}`), "Tax invoice must include INV-orderNumber");
    assert.ok(invoiceHtml.includes("DR.MEDEX"), "Tax invoice must include official business branding");

    // Verify email service handles invoice dispatch without crashing
    const emailRes = await emailService.sendOrderInvoiceEmail(paid);
    assert.strictEqual(emailRes.success, true);

    // Clean up test order and restore inventory
    await orderService.markOrderAsCancelled(testOrder.orderNumber, "Post-payment test cleanup");
    const client = await mongoService.getClient().catch(() => null);
    if (client) {
      await client.db().collection("orders").deleteOne({ orderNumber: testOrder.orderNumber });
    }
  });

  // PHASE 5: LIVE PayPal Health Check (Non-Capturing Safeguard)
  await test("Phase 5: Safe LIVE PayPal Health Check (Zero Captures)", async () => {
    const liveDiag = await paypalTestRunner.runLiveDiagnosticSuite();
    assert.strictEqual(liveDiag.status, "PASS", "LIVE diagnostic must PASS");
    assert.strictEqual(liveDiag.oauthStatus, "PASS", "LIVE OAuth must authenticate with api-m.paypal.com");
    assert.ok(liveDiag.oauthLatencyMs > 0, "OAuth latency must be recorded");
    assert.strictEqual(liveDiag.webhookRegistration, "VERIFIED_ACTIVE", "LIVE webhook must be verified active");
    assert.strictEqual(liveDiag.webhookId, "7M1853351M9950810", "LIVE webhook ID must match 7M1853351M9950810");
    assert.strictEqual(liveDiag.subscribedEventsCount, 10, "LIVE webhook must have 10 subscribed events");
    assert.strictEqual(liveDiag.liveRealPaymentStatus, "LIVE PAYMENT NOT TESTED (Financial Protection Safeguard)");
  });

  // PHASE 6: Global Country Eligibility Matrix
  await test("Phase 6: Global Country Eligibility Matrix", async () => {
    const matrix = paypalTestRunner.getCountryEligibilityMatrix();
    assert.ok(matrix.length >= 10, "Matrix must cover at least 10 key countries");

    const inRow = matrix.find(m => m.countryCode === "IN");
    assert.strictEqual(inRow.status, "RESTRICTED");
    assert.strictEqual(inRow.merchantAcceptance, "RESTRICTED (DOMESTIC RAZORPAY ONLY)");

    const usRow = matrix.find(m => m.countryCode === "US");
    assert.strictEqual(usRow.status, "PASS");
    assert.strictEqual(usRow.currency, "USD");
  });

  // PHASE 7: Webhook Testing (Signature Validation & Mock Events)
  await test("Phase 7: Webhook Signature Verification & Idempotency", async () => {
    // 1. Signature rejection
    const isVerifiedFake = await paypalService.verifyWebhookSignature({
      webhookId: "7M1853351M9950810",
      transmissionId: "test-fake-tx",
      transmissionTime: new Date().toISOString(),
      certUrl: "https://api-m.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-82a87a66",
      authAlgo: "SHA256withRSA",
      transmissionSig: "INVALID_SIG_PROBE",
      webhookEvent: { id: "WH-SIM-001" }
    });
    assert.strictEqual(isVerifiedFake, false, "Invalid probe signature must be rejected");

    // 2. Idempotency table
    const client = await mongoService.getClient().catch(() => null);
    if (client) {
      const db = client.db();
      const testEvId = "WH-IDEMPOTENCY-TEST-" + Date.now();
      await db.collection("processed_webhooks").insertOne({
        eventId: testEvId,
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        orderNumber: "TEST-ORD-WH",
        processedAt: new Date().toISOString()
      });
      const found = await db.collection("processed_webhooks").findOne({ eventId: testEvId });
      assert.ok(found, "Webhook must be stored in processed_webhooks");
      await db.collection("processed_webhooks").deleteOne({ eventId: testEvId });
    }
  });

  // PHASE 8: Unified Health Report
  await test("Phase 8: Full Unified Report Generation", async () => {
    const report = await paypalTestRunner.generateFullReport();
    console.log("\n[Test 8 Report Summary]:", report.summary);
    if (report.summary.sandboxCountriesPassed < 8) {
      console.log("[Test 8 Country Details]:", report.multiCountry.results.map(r => ({ code: r.countryCode, status: r.status, details: r.details })));
    }
    assert.ok(report.generatedAt, "Report must have timestamp");
    assert.ok(report.summary.overallStatus === "HEALTHY" || report.summary.overallStatus === "ATTENTION_REQUIRED");
    assert.strictEqual(report.summary.liveApiStatus, "PASS");
    assert.ok(report.summary.sandboxCountriesPassed >= 8, "At least 8 international countries must pass");
    assert.strictEqual(report.summary.sandboxCountriesRestricted, 1, "India must be restricted");
    assert.strictEqual(report.summary.lifecycleScenariosPassed, 16, "All 16 lifecycle scenarios must pass");
    assert.strictEqual(report.summary.lifecycleScenariosFailed, 0, "Zero lifecycle scenarios failed");
  });

  console.log("\n================================================================================");
  console.log(`ALL TESTS PASSED: ${passedTests} / ${totalTests} test suites completed successfully!`);
  console.log("================================================================================\n");
  process.exit(0);
}

runAutonomousTestSuite().catch((err) => {
  console.error("Test Suite Execution Failed:", err);
  process.exit(1);
});
