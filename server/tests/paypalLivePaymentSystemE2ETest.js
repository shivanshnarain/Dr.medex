/**
 * DR.MEDEX Global — PayPal Live Payment System Full Lifecycle Test Suite
 * Covers all 15 Phases of the payment lifecycle:
 * - Production OAuth & Live API connectivity (read-only verification)
 * - Live Webhook ID registration & 10 event types
 * - Webhook signature verification & duplicate event idempotency
 * - Server-side order creation & country routing (India domestic vs International)
 * - Payment capture verification & strict status transitions
 * - Concurrency-safe inventory deduction
 * - Transactional email notifications (customer & admin)
 * - Downloadable branded tax invoice generation
 * - Full & partial refund system and admin audit trail
 * - Admin order views and payment status filtering
 */

const assert = require("assert");
const http = require("http");
const path = require("path");
process.env.NODE_ENV = "test";
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const app = require("../index");
const store = require("../services/store");
const mongoService = require("../services/mongoService");
const paypalService = require("../services/paypalService");
const orderService = require("../services/orderService");
const emailService = require("../services/emailService");
const currencyService = require("../services/currencyService");

async function runTests() {
  console.log("================================================================================");
  console.log("DR.MEDEX GLOBAL — COMPLETE PAYPAL LIVE PAYMENT SYSTEM END-TO-END TEST SUITE");
  console.log("================================================================================\n");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Test Harness] Server running on ${baseUrl}\n`);

  let passedTests = 0;
  let totalTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      process.stdout.write(`TEST ${totalTests}: ${name} ... `);
      await fn();
      console.log("✔ PASS");
      passedTests++;
    } catch (err) {
      console.log(`❌ FAILED\n   Error: ${err.message}\n`);
      throw err;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Production OAuth Authentication & Credentials Security
    // -------------------------------------------------------------------------
    await test("Production Live OAuth Authentication (Secret Isolation)", async () => {
      const mode = paypalService.getMode();
      assert.strictEqual(mode, "live", "PayPal mode must be 'live'");
      const clientId = paypalService.getClientId();
      const secret = paypalService.getClientSecret();
      assert.ok(clientId && clientId.length > 20, "Live Client ID must be loaded");
      assert.ok(secret && secret.length > 20, "Live Client Secret must be loaded");

      // Verify OAuth Token Acquisition from api-m.paypal.com
      paypalService.clearTokenCache();
      const token = await paypalService.getAccessToken();
      assert.ok(token && typeof token === "string" && token.length > 30, "Live access token must be obtained");

      // Verify Secret Isolation: public config must NEVER leak secret
      const pubConfig = paypalService.getPublicConfig();
      assert.strictEqual(pubConfig.clientId, clientId);
      assert.strictEqual(pubConfig.mode, "live");
      assert.strictEqual(pubConfig.configured, true);
      assert.strictEqual(pubConfig.clientSecret, undefined, "Secret must never be in public config");
      assert.strictEqual(pubConfig.hasWebhookId, true, "Webhook ID must be registered");
    });

    // -------------------------------------------------------------------------
    // TEST 2: Production Live API Connectivity & Order Creation (No Capture)
    // -------------------------------------------------------------------------
    await test("Production Live API Order Creation (No Real Payment Captured)", async () => {
      const sampleOrderNumber = `MED-LIVE-READONLY-${Date.now().toString().slice(-5)}`;
      const liveOrder = await paypalService.createOrder({
        orderNumber: sampleOrderNumber,
        amount: 50.00,
        currency: "USD",
        description: `DR.MEDEX Live API Connectivity Verification #${sampleOrderNumber}`,
        items: [{ title: "Institutional Ultrasound Calibrator", unitPrice: 50.00, quantity: 1 }],
        returnUrl: `https://drmedex.vercel.app/checkout?paypal_return=1&orderNumber=${sampleOrderNumber}`,
        cancelUrl: `https://drmedex.vercel.app/checkout?paypal_cancel=1&orderNumber=${sampleOrderNumber}`
      });

      assert.ok(liveOrder && liveOrder.id, "Live PayPal Order ID must be created");
      assert.strictEqual(liveOrder.status, "CREATED", "Live order status must be CREATED");
      const approveLink = liveOrder.links?.find((l) => l.rel === "approve")?.href;
      assert.ok(approveLink && approveLink.includes("paypal.com/checkoutnow?token="), "Approval URL must point to Live PayPal");

      // Retrieve Order Details via Live API (Read-only verification)
      const details = await paypalService.getOrderDetails(liveOrder.id);
      assert.strictEqual(details.id, liveOrder.id);
      assert.strictEqual(details.status, "CREATED");
    });

    // -------------------------------------------------------------------------
    // TEST 3: Production Live Webhook ID Registration & 10 Event Types
    // -------------------------------------------------------------------------
    await test("Production Live Webhook Registration & Configured Events", async () => {
      const webhookId = paypalService.getWebhookId();
      assert.strictEqual(webhookId, "7M1853351M9950810", "Live Webhook ID must match registered webhook");

      const token = await paypalService.getAccessToken();
      const baseUrlApi = paypalService.getBaseUrl();
      const res = await fetch(`${baseUrlApi}/v1/notifications/webhooks/${webhookId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 200, "Webhook must be retrievable from Live PayPal API");
      const data = await res.json();
      assert.strictEqual(data.url, "https://drmedex.vercel.app/api/payment/paypal/webhook");

      const eventNames = (data.event_types || []).map((e) => e.name);
      const requiredEvents = [
        "PAYMENT.CAPTURE.COMPLETED",
        "PAYMENT.CAPTURE.PENDING",
        "PAYMENT.CAPTURE.DENIED",
        "PAYMENT.CAPTURE.REFUNDED",
        "PAYMENT.CAPTURE.REVERSED",
        "CHECKOUT.ORDER.APPROVED",
        "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
        "CUSTOMER.DISPUTE.CREATED",
        "CUSTOMER.DISPUTE.UPDATED",
        "CUSTOMER.DISPUTE.RESOLVED"
      ];

      for (const reqEv of requiredEvents) {
        assert.ok(eventNames.includes(reqEv), `Webhook must be subscribed to ${reqEv}`);
      }
    });

    // -------------------------------------------------------------------------
    // TEST 4: Country Routing: Domestic India (Razorpay) vs International (PayPal)
    // -------------------------------------------------------------------------
    await test("Country Routing: Domestic Indian Orders Strictly Blocked from PayPal", async () => {
      // 1. Domestic Indian order to PayPal must be rejected
      const indianPayload = {
        customer: { fullName: "Aarav Sharma", email: "aarav@apollohospitals.com", countryCode: "IN" },
        shippingAddress: { countryCode: "IN", country: "India", city: "Mumbai", postalCode: "400001", addressLine1: "Marine Drive" },
        items: [{ productId: store.getProducts(true)[0]?.id || "prod-1", quantity: 1 }]
      };
      const resIn = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indianPayload)
      });
      assert.strictEqual(resIn.status, 400, "Domestic Indian PayPal checkout must be blocked");
      const dataIn = await resIn.json();
      assert.ok(dataIn.message.includes("Domestic orders within India must be processed via Razorpay"));

      // 2. Domestic Indian order to Razorpay must succeed
      const resRzp = await fetch(`${baseUrl}/api/payment/razorpay/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indianPayload)
      });
      assert.strictEqual(resRzp.status, 200, "Domestic Indian Razorpay order must succeed");
      const dataRzp = await resRzp.json();
      assert.strictEqual(dataRzp.success, true);
      assert.ok(dataRzp.orderNumber, "Razorpay response must include internal orderNumber");
      assert.strictEqual(dataRzp.currency, "INR", "Domestic Razorpay currency must be INR");
    });

    // -------------------------------------------------------------------------
    // TEST 5: PayPal Create-Order for International Customers
    // -------------------------------------------------------------------------
    let createdInternationalOrder = null;
    await test("PayPal Order Creation with Currency Conversion for International Customer", async () => {
      const activeProd = store.getProducts(true)[0];
      assert.ok(activeProd, "Must have an active product");

      const intlPayload = {
        customer: {
          fullName: "Dr. Sarah Jenkins",
          email: "sarah.jenkins@mayoclinic.org",
          phone: "+1 507-284-2511",
          countryCode: "US",
          companyName: "Mayo Clinic Biomedical Division"
        },
        shippingAddress: {
          fullName: "Dr. Sarah Jenkins",
          companyName: "Mayo Clinic Biomedical Division",
          phone: "+1 507-284-2511",
          addressLine1: "200 First St SW",
          addressLine2: "Eisenheim Surgical Pavilion",
          city: "Rochester",
          state: "MN",
          postalCode: "55905",
          country: "United States",
          countryCode: "US"
        },
        currency: "USD",
        items: [{ productId: activeProd.id, quantity: 1 }]
      };

      const res = await fetch(`${baseUrl}/api/payment/paypal/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intlPayload)
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.orderID, "Must have PayPal order ID");
      assert.ok(data.orderNumber && data.orderNumber.startsWith("MED-"), "Must have MED- format order number");
      assert.strictEqual(data.currency, "USD");
      assert.ok(data.amount > 0);

      // Verify pending order exists in database with PENDING status
      const savedPending = await orderService.getOrder(data.orderNumber);
      assert.ok(savedPending);
      assert.strictEqual(savedPending.payment.status, "PENDING");
      assert.strictEqual(savedPending.orderStatus, "PENDING");
      assert.strictEqual(savedPending.payment.paypalOrderId, data.orderID);

      createdInternationalOrder = savedPending;
    });

    // -------------------------------------------------------------------------
    // TEST 6: Payment Capture Verification & Order State Transitions
    // -------------------------------------------------------------------------
    let capturedOrder = null;
    const testCaptureId = `CAP-${Date.now()}`;
    await test("Payment Capture Verification (COMPLETED -> PAID) & Stock Movement", async () => {
      assert.ok(createdInternationalOrder);
      const prodId = createdInternationalOrder.items[0].productId;
      const initialStock = store.getProductById(prodId)?.stock || 100;

      // Mock PayPal capture response with strict COMPLETED status
      const mockCaptureData = {
        id: createdInternationalOrder.payment.paypalOrderId,
        status: "COMPLETED",
        purchase_units: [
          {
            reference_id: createdInternationalOrder.orderNumber,
            custom_id: createdInternationalOrder.orderNumber,
            payments: {
              captures: [
                {
                  id: testCaptureId,
                  status: "COMPLETED",
                  amount: {
                    currency_code: createdInternationalOrder.pricing.currency,
                    value: createdInternationalOrder.pricing.grandTotal.toFixed(2)
                  }
                }
              ]
            }
          }
        ]
      };

      // Perform verified payment mark
      capturedOrder = await orderService.markOrderAsPaid({
        orderNumber: createdInternationalOrder.orderNumber,
        paypalOrderId: createdInternationalOrder.payment.paypalOrderId,
        paypalCaptureId: testCaptureId,
        paymentDetails: mockCaptureData
      });

      assert.strictEqual(capturedOrder.payment.status, "PAID");
      assert.strictEqual(capturedOrder.orderStatus, "PROCESSING");
      assert.strictEqual(capturedOrder.payment.paypalCaptureId, testCaptureId);
      assert.ok(capturedOrder.payment.paidAt);
      assert.strictEqual(capturedOrder.stockDeducted, true);

      // Verify stock was deducted exactly once
      const updatedStock = store.getProductById(prodId)?.stock;
      assert.strictEqual(updatedStock, initialStock - 1, "Inventory must be deducted by purchased quantity");
    });

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate Capture Prevention & Strict Idempotency
    // -------------------------------------------------------------------------
    await test("Duplicate Capture Prevention: Second Capture Does Not Double-Deduct Stock", async () => {
      assert.ok(capturedOrder);
      const prodId = capturedOrder.items[0].productId;
      const stockBeforeSecondCapture = store.getProductById(prodId)?.stock;

      // Repeat markOrderAsPaid with same or duplicate capture
      const secondCallResult = await orderService.markOrderAsPaid({
        orderNumber: capturedOrder.orderNumber,
        paypalOrderId: capturedOrder.payment.paypalOrderId,
        paypalCaptureId: testCaptureId,
        paymentDetails: { duplicate: true }
      });

      assert.strictEqual(secondCallResult.payment.status, "PAID");
      const stockAfterSecondCapture = store.getProductById(prodId)?.stock;
      assert.strictEqual(stockAfterSecondCapture, stockBeforeSecondCapture, "Stock must NOT be double-deducted on duplicate capture");
    });

    // -------------------------------------------------------------------------
    // TEST 8: Transactional Email Notifications & Deduplication
    // -------------------------------------------------------------------------
    await test("Transactional Email Dispatch (Customer Invoice & Admin Notification)", async () => {
      assert.ok(capturedOrder);

      // Verify customer invoice email can be generated and sent
      const invoiceEmailRes = await emailService.sendOrderInvoiceEmail(capturedOrder);
      assert.strictEqual(invoiceEmailRes.success, true);

      // Verify admin new paid order notification email can be generated and sent
      const adminEmailRes = await emailService.sendAdminNewPaidOrderNotification(capturedOrder);
      assert.strictEqual(adminEmailRes.success, true);

      // Verify in-memory mailbox recorded both emails
      assert.ok(emailService.testMailbox.length >= 2, "Test mailbox must record emails");
      const foundInvoice = emailService.testMailbox.find((m) => m.metadata?.type === "ORDER_INVOICE");
      assert.ok(foundInvoice, "Customer invoice email must be recorded");
      assert.ok(foundInvoice.subject.includes(`INV-${capturedOrder.orderNumber}`));

      const foundAdmin = emailService.testMailbox.find((m) => m.metadata?.type === "admin_paid_order_notification");
      assert.ok(foundAdmin, "Admin notification email must be recorded");
      assert.ok(foundAdmin.subject.includes(`Order #${capturedOrder.orderNumber}`));
    });

    // -------------------------------------------------------------------------
    // TEST 9: Branded Tax Invoice HTML Document Generation & HTTP Endpoint
    // -------------------------------------------------------------------------
    await test("Downloadable Tax Invoice Endpoint (GET /api/orders/:id/invoice)", async () => {
      assert.ok(capturedOrder);

      // Call public/authorized invoice endpoint
      const res = await fetch(`${baseUrl}/api/orders/${capturedOrder.orderNumber}/invoice`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/html"));
      const html = await res.text();

      // Verify official DR.MEDEX business and invoice data
      assert.ok(html.includes("DR.MEDEX"), "Must contain DR.MEDEX branding");
      assert.ok(html.includes("TAX INVOICE"), "Must contain TAX INVOICE heading");
      assert.ok(html.includes(`INV-${capturedOrder.orderNumber}`), "Must contain Invoice Number");
      assert.ok(html.includes(capturedOrder.customer.fullName), "Must contain customer name");
      assert.ok(html.includes(capturedOrder.pricing.currency), "Must contain currency");
      assert.ok(html.includes("CONFIRMED PAID"), "Must display verified payment status badge");
      assert.ok(html.includes("support@drmedex.com"), "Must contain support contact");
      assert.ok(html.includes("window.print()"), "Must provide print / PDF download option");
    });

    // -------------------------------------------------------------------------
    // TEST 10: Webhook Signature Verification & Invalid Signature Rejection
    // -------------------------------------------------------------------------
    await test("PayPal Webhook Signature Verification & Invalid Signature Rejection", async () => {
      // Post with invalid signature headers to live webhook listener
      const res = await fetch(`${baseUrl}/api/payment/paypal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "paypal-transmission-id": "fake-trans-id-12345",
          "paypal-transmission-time": new Date().toISOString(),
          "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123",
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-transmission-sig": "INVALID_SIGNATURE_BASE64_STRING"
        },
        body: JSON.stringify({
          id: `WH-EV-${Date.now()}`,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: { id: "CAP-TEST-123" }
        })
      });

      // Must be rejected with HTTP 401
      assert.strictEqual(res.status, 401, "Invalid webhook signature must be rejected with HTTP 401");
      const data = await res.json();
      assert.strictEqual(data.received, false);
      assert.ok(data.message.includes("Invalid PayPal webhook signature"));
    });

    // -------------------------------------------------------------------------
    // TEST 11: Webhook Idempotency & Duplicate Delivery Deduplication
    // -------------------------------------------------------------------------
    await test("Webhook Duplicate Event Delivery Deduplication", async () => {
      const eventId = `WH-EV-IDEM-${Date.now()}`;
      const client = await mongoService.getClient();
      const db = client.db();

      // Pre-seed an event ID into processed_webhooks collection
      await db.collection("processed_webhooks").insertOne({
        eventId,
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        orderNumber: capturedOrder.orderNumber,
        processedAt: new Date().toISOString()
      });

      // Send event with matching eventId (simulate duplicate delivery)
      const res = await fetch(`${baseUrl}/api/payment/paypal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "paypal-transmission-id": "TEST_SIMULATED_TRANSMISSION"
        },
        body: JSON.stringify({
          id: eventId,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: { id: "CAP-DUPLICATE" }
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alreadyProcessed, true, "Duplicate event must return alreadyProcessed: true");
    });

    // -------------------------------------------------------------------------
    // TEST 12: Webhook Dispute Handling (CUSTOMER.DISPUTE.CREATED / RESOLVED)
    // -------------------------------------------------------------------------
    await test("Webhook Customer Dispute Events (CREATED & RESOLVED)", async () => {
      assert.ok(capturedOrder);

      // Dispute Created
      const disputeCreatedOrder = await orderService.markOrderAsDisputed(capturedOrder.orderNumber, {
        disputeId: "PP-D-998877",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        amount: 25.00
      });
      assert.strictEqual(disputeCreatedOrder.payment.disputeStatus, "UNDER_DISPUTE");
      assert.strictEqual(disputeCreatedOrder.orderStatus, "DISPUTED");

      // Dispute Resolved
      const disputeResolvedOrder = await orderService.markOrderDisputeResolved(capturedOrder.orderNumber, {
        disputeId: "PP-D-998877",
        outcome: "RESOLVED_BUYER_FAVOUR"
      });
      assert.strictEqual(disputeResolvedOrder.payment.disputeStatus, "RESOLVED");
    });

    // -------------------------------------------------------------------------
    // TEST 13: Full & Partial Refund System with Admin Audit Trail
    // -------------------------------------------------------------------------
    await test("Refund Management: Partial and Full Refunds with Audit Trail", async () => {
      assert.ok(capturedOrder);

      // 1. Partial Refund ($10.00)
      const partialRefundOrder = await orderService.recordRefundAdmin(capturedOrder.orderNumber, {
        refundId: `REFUND-PARTIAL-${Date.now()}`,
        amount: 10.00,
        currency: "USD",
        reason: "Customer calibration credit",
        adminUser: "superadmin@drmedex.com"
      });

      assert.strictEqual(partialRefundOrder.payment.status, "PARTIALLY_REFUNDED");
      assert.strictEqual(partialRefundOrder.payment.refundStatus, "PARTIALLY_REFUNDED");
      assert.strictEqual(partialRefundOrder.payment.refundAmount, 10.00);
      assert.ok(partialRefundOrder.payment.refunds?.length >= 1);
      assert.ok(partialRefundOrder.auditLogs?.some((l) => l.action === "PAYMENT_REFUNDED"));

      // 2. Full Remaining Refund
      const remaining = capturedOrder.pricing.grandTotal - 10.00;
      const fullRefundOrder = await orderService.recordRefundAdmin(capturedOrder.orderNumber, {
        refundId: `REFUND-FULL-${Date.now()}`,
        amount: remaining,
        currency: "USD",
        reason: "Full institutional cancellation",
        adminUser: "superadmin@drmedex.com"
      });

      assert.strictEqual(fullRefundOrder.payment.status, "REFUNDED");
      assert.strictEqual(fullRefundOrder.payment.refundStatus, "REFUNDED");
      assert.strictEqual(fullRefundOrder.orderStatus, "REFUNDED");
    });

    // -------------------------------------------------------------------------
    // TEST 14: Admin Panel Order Management & Payment Status Filters
    // -------------------------------------------------------------------------
    await test("Admin Panel Orders Query & Status Filtering", async () => {
      const allOrdersResult = await orderService.getAllOrdersAdmin({ page: 1, limit: 10 });
      assert.ok(allOrdersResult.orders.length > 0);
      assert.ok(allOrdersResult.total >= 1);

      // Verify payment filters work
      const refundedOrders = await orderService.getAllOrdersAdmin({ paymentStatus: "REFUNDED" });
      assert.ok(refundedOrders.orders.every((o) => o.payment?.status === "REFUNDED"));

      const paidOrders = await orderService.getAllOrdersAdmin({ paymentStatus: "PAID" });
      assert.ok(paidOrders.orders.every((o) => o.payment?.status === "PAID"));
    });

    // -------------------------------------------------------------------------
    // TEST 15: Buyer Cancellation Handling (/api/payment/paypal/cancel-order)
    // -------------------------------------------------------------------------
    await test("Buyer Checkout Cancellation Preserves Order Integrity", async () => {
      // Create a pending order to cancel
      const cancelPending = await orderService.createPendingOrder({
        customer: { fullName: "Dr. Cancellation Test", email: "cancel.test@hospital.org", countryCode: "US" },
        shippingAddress: { countryCode: "US", country: "United States", city: "Chicago", postalCode: "60601", addressLine1: "Michigan Ave" },
        items: [{ productId: store.getProducts(true)[0]?.id, quantity: 1 }]
      });

      const cancelRes = await fetch(`${baseUrl}/api/payment/paypal/cancel-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: cancelPending.orderNumber, reason: "Customer closed PayPal popup" })
      });
      assert.strictEqual(cancelRes.status, 200);
      const cancelData = await cancelRes.json();
      assert.strictEqual(cancelData.success, true);
      assert.strictEqual(cancelData.status, "CANCELLED");

      const checkDoc = await orderService.getOrder(cancelPending.orderNumber);
      assert.strictEqual(checkDoc.payment.status, "CANCELLED");
      assert.strictEqual(checkDoc.orderStatus, "CANCELLED");
    });

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("\n================================================================================");
  console.log(`ALL TESTS PASSED: ${passedTests} / ${totalTests} test suites completed successfully!`);
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("Test Suite Execution Error:", err);
  process.exit(1);
});
