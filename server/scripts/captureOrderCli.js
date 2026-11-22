/**
 * DR.MEDEX Order Capture CLI
 * Checks the status of a PayPal order and captures it once approved.
 */
require("dotenv").config();
const paypalService = require("../services/paypalService");
const orderService = require("../services/orderService");
const { MongoClient } = require("mongodb");

async function run() {
  const mode = process.argv[2] || "sandbox";
  const orderId = process.argv[3] || "6VD59041488098129";
  const orderNumber = process.argv[4] || "MED-97932";

  console.log(`[Capture CLI] Checking Order: ${orderId} (Mode: ${mode}, Order: ${orderNumber})`);

  try {
    const details = await paypalService.getOrderDetails(orderId, mode);
    console.log(`[Capture CLI] Current PayPal Order Status: ${details.status}`);
    console.log(`[Capture CLI] Payer:`, details.payer ? `${details.payer.email_address} (${details.payer.payer_id})` : "NOT YET APPROVED");

    if (details.status !== "APPROVED") {
      console.log(`[Capture CLI] Order is currently ${details.status}. Awaiting buyer approval.`);
      const approveLink = details.links?.find(l => l.rel === "approve")?.href;
      if (approveLink) {
        console.log(`[Capture CLI] Approval Link: ${approveLink}`);
      }
      return { status: details.status, approved: false };
    }

    console.log(`[Capture CLI] Buyer approval detected! Capturing order ${orderId}...`);
    const captureResult = await paypalService.captureOrder(orderId, mode);
    console.log(`[Capture CLI] Capture Status: ${captureResult.status}, Capture ID: ${captureResult.id}`);

    // Update MongoDB
    if (mode === "sandbox") {
      process.env.MONGODB_DB = "drmedex_test";
    }
    const updatedOrder = await orderService.markOrderAsPaid({
      orderNumber,
      paypalOrderId: orderId,
      paypalCaptureId: captureResult.id,
      paymentDetails: captureResult
    });

    console.log(`[Capture CLI] Successfully marked ${orderNumber} as PAID!`);
    console.log(`[Capture CLI] Order Status: ${updatedOrder.status}, Payment Status: ${updatedOrder.payment?.status}`);
    return { status: "COMPLETED", captureId: captureResult.id, approved: true };
  } catch (err) {
    console.error(`[Capture CLI] Error:`, err.message);
    return { error: err.message };
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;
