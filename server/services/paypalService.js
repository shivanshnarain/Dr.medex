/**
 * DR.MEDEX Global — PayPal Payment Gateway Service
 * Server-Side Only: Never exposes PayPal Client Secret to the frontend
 */

/**
 * Dynamic credential getters to guarantee real-time resolution in serverless / Vercel environments
 * SECURITY: Client Secret is strictly server-side and must NEVER be read from VITE_* variables
 * or exposed in API responses, logs, or frontend bundles.
 */
function stripQuotes(val) {
  return String(val || "").trim().replace(/^["']|["']$/g, "").trim();
}

function getMode() {
  const vercelEnv = stripQuotes(process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "preview" || vercelEnv === "development") {
    return "sandbox";
  }
  const raw = stripQuotes(process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  return raw || "sandbox";
}

function getClientId(explicitMode) {
  const mode = explicitMode || getMode();
  if (mode === "live") {
    return stripQuotes(
      process.env.PAYPAL_LIVE_CLIENT_ID ||
      process.env.PAYPAL_CLIENT_ID ||
      process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
      process.env.REACT_APP_PAYPAL_CLIENT_ID ||
      process.env.PAYPAL_CLIENT ||
      ""
    );
  }
  return stripQuotes(
    process.env.PAYPAL_SANDBOX_CLIENT_ID ||
    process.env.PAYPAL_CLIENT_ID ||
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
    process.env.REACT_APP_PAYPAL_CLIENT_ID ||
    process.env.PAYPAL_CLIENT ||
    ""
  );
}

function getClientSecret(explicitMode) {
  const mode = explicitMode || getMode();
  if (mode === "live") {
    return stripQuotes(
      process.env.PAYPAL_LIVE_CLIENT_SECRET ||
      process.env.PAYPAL_CLIENT_SECRET ||
      process.env.PAYPAL_SECRET_KEY ||
      process.env["paypal-secret_key"] ||
      process.env.PAYPAL_SECRET ||
      ""
    );
  }
  return stripQuotes(
    process.env.PAYPAL_SANDBOX_CLIENT_SECRET ||
    process.env.PAYPAL_CLIENT_SECRET ||
    process.env.PAYPAL_SECRET_KEY ||
    process.env["paypal-secret_key"] ||
    process.env.PAYPAL_SECRET ||
    ""
  );
}

function getDeploymentEnv() {
  if (process.env.VERCEL_ENV) {
    return stripQuotes(process.env.VERCEL_ENV).toLowerCase();
  }
  if (process.env.NODE_ENV) {
    return stripQuotes(process.env.NODE_ENV).toLowerCase();
  }
  return "development";
}

function getWebhookId(explicitMode) {
  const mode = explicitMode || getMode();
  if (mode === "sandbox") {
    return stripQuotes(
      process.env.PAYPAL_SANDBOX_WEBHOOK_ID ||
      "05948271A6295011K"
    );
  }
  return stripQuotes(
    process.env.PAYPAL_LIVE_WEBHOOK_ID ||
    process.env.PAYPAL_WEBHOOK_ID ||
    "7M1853351M9950810"
  );
}

/**
 * Validate PayPal mode & deployment environment safety.
 * - Never silently use Sandbox credentials in Production (VERCEL_ENV === "production").
 * - Never silently use Live credentials in Vercel Preview or Vercel Development deployments.
 * - Locally (without VERCEL_ENV), honors explicit PAYPAL_MODE ("sandbox" or "live") so developers
 *   can maintain and test both credential sets safely.
 */
function checkEnvironmentSafety() {
  const mode = getMode();
  const env = getDeploymentEnv();
  const vercelEnv = stripQuotes(process.env.VERCEL_ENV || "").toLowerCase();

  if (mode !== "sandbox" && mode !== "live") {
    return {
      safe: false,
      code: "INVALID_PAYPAL_MODE",
      reason: `Invalid PAYPAL_MODE "${mode}". Expected "sandbox" or "live".`
    };
  }

  if (env === "production" && mode !== "live") {
    const rawMode = stripQuotes(process.env.PAYPAL_MODE || "");
    const detail = rawMode
      ? `PAYPAL_MODE is currently "${mode}" in Production.`
      : "PAYPAL_MODE is not set in Production (defaulted to sandbox).";
    return {
      safe: false,
      code: "SANDBOX_BLOCKED_IN_PRODUCTION",
      reason:
        `PayPal Live credentials are not configured for Production (${detail}) Refusing to silently run Sandbox mode in Production.`
    };
  }

  if (
    (vercelEnv === "development" || vercelEnv === "preview") &&
    mode === "live" &&
    process.env.PAYPAL_ALLOW_LIVE_IN_NON_PROD !== "true"
  ) {
    return {
      safe: false,
      code: "LIVE_BLOCKED_IN_NON_PRODUCTION",
      reason:
        `Refusing to silently use PayPal Live mode in Vercel "${vercelEnv}" environment. Configure Sandbox credentials and PAYPAL_MODE=sandbox.`
    };
  }

  return { safe: true, code: "OK", reason: null };
}

function assertEnvironmentSafety() {
  const check = checkEnvironmentSafety();
  if (!check.safe) {
    const err = new Error(check.reason);
    err.code = check.code;
    throw err;
  }
}

function getBaseUrl() {
  const mode = getMode();
  if (mode !== "sandbox" && mode !== "live") {
    throw new Error(`Invalid PAYPAL_MODE "${mode}". Expected "sandbox" or "live".`);
  }
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getCheckoutBaseUrl() {
  return getMode() === "live"
    ? "https://www.paypal.com"
    : "https://www.sandbox.paypal.com";
}

/**
 * Returns strictly non-sensitive PayPal configuration safe for browser consumption.
 * NEVER includes clientSecret or any server credential.
 */
function getPublicConfig() {
  const clientId = getClientId();
  const hasClientId = Boolean(clientId);
  const hasClientSecret = Boolean(getClientSecret());
  const hasWebhookId = Boolean(getWebhookId());
  const mode = getMode();
  const safety = checkEnvironmentSafety();
  const configured = Boolean(hasClientId && hasClientSecret && safety.safe);

  return {
    clientId: configured ? clientId : "",
    mode,
    configured,
    hasClientId,
    hasClientSecret,
    hasWebhookId,
    environment: getDeploymentEnv(),
    ...(safety.safe ? {} : { warning: safety.reason })
  };
}

// In-memory token cache to minimize OAuth round-trips (keyed by credentials & mode)
const tokenCache = new Map();

function clearTokenCache() {
  tokenCache.clear();
}

/**
 * Obtain or refresh OAuth 2.0 access token from PayPal
 */
async function getAccessToken(explicitMode) {
  const currentMode = explicitMode || getMode();
  if (!explicitMode) {
    assertEnvironmentSafety();
  }

  const currentClientId = getClientId(currentMode);
  const currentClientSecret = getClientSecret(currentMode);
  const baseUrl = currentMode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  if (!currentClientId || !currentClientSecret) {
    throw new Error(`PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing from server environment for mode: ${currentMode}.`);
  }

  const credsHash = `${currentClientId}:${currentClientSecret}:${currentMode}`;
  const cached = tokenCache.get(credsHash);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token;
  }

  const auth = Buffer.from(`${currentClientId}:${currentClientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!res.ok) {
    let errorDesc = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorDesc = errJson.error_description || errJson.error || errorDesc;
    } catch {
      // Never include raw credentials in error text
    }
    const modeHint =
      res.status === 401
        ? ` Verify that PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are genuine PayPal ${currentMode.toUpperCase()} credentials matching PAYPAL_MODE=${currentMode}.`
        : "";
    throw new Error(`PayPal OAuth authentication failed (HTTP ${res.status}): ${errorDesc}.${modeHint}`);
  }

  const data = await res.json();
  if (!data || !data.access_token) {
    throw new Error("PayPal OAuth response did not include an access_token.");
  }
  const token = data.access_token;
  tokenCache.set(credsHash, {
    token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  });
  return token;
}

/**
 * Supported PayPal currencies. If a customer browses in an unsupported currency,
 * the backend converts the charge to USD and passes USD to PayPal.
 */
const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "NZD", "SGD", "HKD",
  "SEK", "DKK", "PLN", "NOK", "HUF", "CZK", "ILS", "MXN", "BRL", "MYR",
  "PHP", "TWD", "THB"
]);

function isPayPalSupportedCurrency(currency) {
  return PAYPAL_SUPPORTED_CURRENCIES.has((currency || "").toUpperCase());
}

/**
 * Create a PayPal v2 Checkout Order
 */
async function createOrder({
  orderNumber,
  amount,
  currency = "USD",
  description = "DR.MEDEX Medical Equipment",
  items = [],
  customer = {},
  returnUrl,
  cancelUrl
}) {
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();

  // Normalize currency to a verified PayPal-supported ISO code (default USD)
  const cleanCurrency = isPayPalSupportedCurrency(currency)
    ? currency.toUpperCase()
    : "USD";

  const isZeroDecimal = cleanCurrency === "JPY" || cleanCurrency === "HUF" || cleanCurrency === "TWD";
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw new Error(`Invalid PayPal order amount: ${amount}`);
  }
  const formattedAmount = isZeroDecimal
    ? Math.round(numAmount).toString()
    : numAmount.toFixed(2);

  // We use reference_id and custom_id for order correlation.
  // Note: invoice_id is omitted to avoid DUPLICATE_INVOICE_ID on customer re-attempts or retries.
  const purchaseUnit = {
    reference_id: String(orderNumber || Date.now()),
    description: `DR.MEDEX Order #${orderNumber}`.substring(0, 127),
    custom_id: String(orderNumber || ""),
    amount: {
      currency_code: cleanCurrency,
      value: formattedAmount
    }
  };

  // If items are provided, build item line details safely
  if (Array.isArray(items) && items.length > 0) {
    const paypalItems = items.slice(0, 10).map((it) => {
      const itemPrice = isZeroDecimal
        ? Math.round(Number(it.unitPrice) || 0).toString()
        : Number(it.unitPrice || 0).toFixed(2);
      return {
        name: (it.title || "Medical Device").substring(0, 127),
        sku: (it.sku || it.productId || "MED-SKU").substring(0, 127),
        unit_amount: {
          currency_code: cleanCurrency,
          value: itemPrice
        },
        quantity: String(it.quantity || 1),
        category: "PHYSICAL_GOODS"
      };
    });

    const itemTotal = paypalItems.reduce((acc, it) => {
      return acc + (Number(it.unit_amount.value) * Number(it.quantity));
    }, 0);

    const formattedItemTotal = isZeroDecimal
      ? Math.round(itemTotal).toString()
      : itemTotal.toFixed(2);

    // CRITICAL: PayPal strictly enforces that sum(items.unit_amount * quantity) === breakdown.item_total.value
    // and that item_total + shipping - discount === amount.value.
    // If there is ANY cent mismatch (e.g. from exchange rate rounding or discounts), breakdown triggers HTTP 422 ITEM_TOTAL_MISMATCH.
    // Therefore, only include breakdown and items if itemTotal matches formattedAmount EXACTLY to the penny.
    if (formattedItemTotal === formattedAmount) {
      purchaseUnit.items = paypalItems;
      purchaseUnit.amount.breakdown = {
        item_total: {
          currency_code: cleanCurrency,
          value: formattedItemTotal
        }
      };
    }
  }

  const payload = {
    intent: "CAPTURE",
    purchase_units: [purchaseUnit],
    application_context: {
      brand_name: "DR.MEDEX Medical Equipment",
      landing_page: "NO_PREFERENCE",
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
      ...(returnUrl ? { return_url: returnUrl } : {}),
      ...(cancelUrl ? { cancel_url: cancelUrl } : {})
    }
  };

  const res = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    const detailMsg = Array.isArray(data.details)
      ? data.details.map((d) => `${d.issue || d.name || "Error"}: ${d.description || ""}${d.field ? ` (${d.field})` : ""}`).join("; ")
      : data.message || JSON.stringify(data);
    throw new Error(`PayPal Order Creation Failed (HTTP ${res.status}): ${detailMsg}`);
  }

  return data;
}

/**
 * Capture an approved PayPal order with idempotency
 */
async function captureOrder(paypalOrderId) {
  const cleanOrderId = String(paypalOrderId || "").trim();
  if (!cleanOrderId) {
    throw new Error("PayPal orderID is required for capture.");
  }

  const token = await getAccessToken();
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(cleanOrderId)}/capture`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    }
  });

  const data = await res.json();
  if (!res.ok) {
    // If order was already captured (HTTP 422 with ORDER_ALREADY_CAPTURED), retrieve verified details
    if (
      res.status === 422 &&
      Array.isArray(data.details) &&
      data.details.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")
    ) {
      try {
        const existingDetails = await getOrderDetails(cleanOrderId);
        if (existingDetails && existingDetails.status === "COMPLETED") {
          return existingDetails;
        }
      } catch (checkErr) {
        // Fall through to throw original error
      }
    }
    const detailMsg = Array.isArray(data.details)
      ? data.details.map((d) => `${d.issue || d.name || "Error"}: ${d.description || ""}`).join("; ")
      : data.message || `HTTP ${res.status}`;
    const err = new Error(`PayPal Order Capture Failed (HTTP ${res.status}): ${detailMsg}`);
    err.httpStatus = res.status;
    err.paypalIssue = Array.isArray(data.details) ? data.details[0]?.issue : data.name;
    throw err;
  }

  return data;
}

/**
 * Retrieve details for an existing PayPal order
 */
async function getOrderDetails(paypalOrderId) {
  const cleanOrderId = String(paypalOrderId || "").trim();
  if (!cleanOrderId) {
    throw new Error("PayPal orderID is required.");
  }
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(cleanOrderId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`PayPal Get Order Failed (HTTP ${res.status}): ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Refund a captured PayPal payment (Full or Partial)
 * Server-Side Only: Requires valid captured payment ID and admin authorization
 */
async function refundCapture({
  captureId,
  amount = null,
  currency = "USD",
  note = "DR.MEDEX Customer Refund",
  requestId = null
}) {
  const cleanCaptureId = String(captureId || "").trim();
  if (!cleanCaptureId) {
    throw new Error("captureId is required for refund.");
  }

  const token = await getAccessToken();
  const baseUrl = getBaseUrl();
  const cleanRequestId = requestId || `refund-${cleanCaptureId}-${Date.now()}`;

  const payload = {
    note_to_payer: String(note || "DR.MEDEX Customer Refund").substring(0, 255)
  };

  if (amount !== null && amount !== undefined) {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid refund amount: ${amount}`);
    }
    const cleanCurrency = isPayPalSupportedCurrency(currency) ? currency.toUpperCase() : "USD";
    const isZeroDecimal = cleanCurrency === "JPY" || cleanCurrency === "HUF" || cleanCurrency === "TWD";
    payload.amount = {
      value: isZeroDecimal ? Math.round(numAmount).toString() : numAmount.toFixed(2),
      currency_code: cleanCurrency
    };
  }

  const res = await fetch(`${baseUrl}/v2/payments/captures/${encodeURIComponent(cleanCaptureId)}/refund`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": cleanRequestId,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    const detailMsg = Array.isArray(data.details)
      ? data.details.map((d) => `${d.issue || d.name || "Error"}: ${d.description || ""}`).join("; ")
      : data.message || `HTTP ${res.status}`;
    const err = new Error(`PayPal Refund Failed (HTTP ${res.status}): ${detailMsg}`);
    err.httpStatus = res.status;
    err.paypalIssue = Array.isArray(data.details) ? data.details[0]?.issue : data.name;
    throw err;
  }

  return data;
}

/**
 * Retrieve refund details from PayPal
 */
async function getRefundDetails(refundId) {
  const cleanRefundId = String(refundId || "").trim();
  if (!cleanRefundId) {
    throw new Error("refundId is required.");
  }
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/v2/payments/refunds/${encodeURIComponent(cleanRefundId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`PayPal Get Refund Failed (HTTP ${res.status}): ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Validate PayPal certificate URL against strict domain, protocol, and path requirements
 */
function validatePayPalCertUrl(certUrl) {
  if (!certUrl || typeof certUrl !== "string") {
    return { valid: false, isSandbox: false, reason: "Missing certUrl" };
  }
  try {
    const parsed = new URL(certUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, isSandbox: false, reason: "Insecure protocol (must be https)" };
    }
    const hostname = parsed.hostname.toLowerCase();
    const isPayPalHost = hostname === "paypal.com" || hostname.endsWith(".paypal.com");
    if (!isPayPalHost) {
      return { valid: false, isSandbox: false, reason: `Untrusted certificate host: ${hostname}` };
    }
    if (!parsed.pathname.startsWith("/v1/notifications/certs/")) {
      return { valid: false, isSandbox: false, reason: "Invalid certificate pathname" };
    }
    const isSandbox = hostname.includes("sandbox.paypal.com");
    return { valid: true, isSandbox, hostname };
  } catch (err) {
    return { valid: false, isSandbox: false, reason: `Malformed URL: ${err.message}` };
  }
}

/**
 * Verify Webhook Event Signature
 * Automatically validates both Live and Sandbox webhook signatures against their authoritative PayPal endpoint.
 */
async function verifyWebhookSignature({
  webhookId,
  transmissionId,
  transmissionTime,
  certUrl,
  authAlgo,
  transmissionSig,
  webhookEvent
}) {
  if (transmissionId === "TEST_SIMULATED_TRANSMISSION" && process.env.NODE_ENV === "test") {
    return true;
  }

  const certCheck = validatePayPalCertUrl(certUrl);
  if (!certCheck.valid) {
    console.warn(`[PayPal Webhook] Certificate URL security validation failed: ${certCheck.reason} (${certUrl})`);
    return false;
  }

  const isSandboxCert = certCheck.isSandbox;
  const targetMode = isSandboxCert ? "sandbox" : getMode();
  const token = await getAccessToken(targetMode);
  const baseUrl = targetMode === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const targetWebhookId = isSandboxCert
    ? getWebhookId("sandbox")
    : (webhookId || getWebhookId("live"));

  const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: targetWebhookId,
      webhook_event: webhookEvent
    })
  });

  const data = await res.json().catch(() => ({}));
  return Boolean(data && data.verification_status === "SUCCESS");
}

module.exports = {
  isPayPalSupportedCurrency,
  getAccessToken,
  clearTokenCache,
  createOrder,
  captureOrder,
  getOrderDetails,
  refundCapture,
  getRefundDetails,
  verifyWebhookSignature,
  validatePayPalCertUrl,
  getClientId,
  getClientSecret,
  getWebhookId,
  getMode,
  getDeploymentEnv,
  checkEnvironmentSafety,
  assertEnvironmentSafety,
  getBaseUrl,
  getCheckoutBaseUrl,
  getPublicConfig
};
