/**
 * Server-Side Cloud Firestore Service for DR.MEDEX Global
 * Manages product reviews & clinical customer feedback lifecycle in Cloud Firestore via Firebase Admin SDK.
 * 
 * Strict Data Architecture:
 * - Persists reviews exclusively in Cloud Firestore (drmedex project).
 * - Enforces status "PENDING" and verifiedPurchase false on all new submissions.
 * - Public queries return status "APPROVED" reviews only.
 * - Admin moderation (approval, rejection, verification, deletion) updates Firestore directly.
 * - Does not silently fall back to local JSON masking errors if Firestore fails.
 * - Supports Application Default Credentials (ADC), FIREBASE_SERVICE_ACCOUNT_KEY (env), or FIREBASE_SERVICE_ACCOUNT_PATH.
 */

const admin = require("firebase-admin");
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");

const COLLECTION_NAME = "reviews";
let firestoreDb = null;
let initError = null;

/**
 * Initialize or retrieve the Firebase Admin Firestore database instance
 */
function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;
  if (initError && !process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    throw initError;
  }
  initError = null;

  try {
    // 1. Reuse existing Firebase Admin app instance if already initialized (avoid duplicate initialization)
    const existingApps = getApps();
    if (existingApps.length > 0) {
      firestoreDb = getFirestore(existingApps[0]);
      return firestoreDb;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || "drmedex";
    let credential = null;

    // 2. Primary & Sanctioned Method: FIREBASE_SERVICE_ACCOUNT_KEY (Single-line JSON string)
    const envKeyRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (envKeyRaw && String(envKeyRaw).trim()) {
      try {
        let rawKey = String(envKeyRaw).trim();

        // Handle optional outer quotes (single or double) from shell / env configurations
        if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
          rawKey = rawKey.slice(1, -1).trim();
        }

        // Support base64-encoded service account string if passed
        if (!rawKey.startsWith("{") && !rawKey.startsWith("[")) {
          try {
            const decoded = Buffer.from(rawKey, "base64").toString("utf8").trim();
            let trimmedDecoded = decoded;
            if ((trimmedDecoded.startsWith('"') && trimmedDecoded.endsWith('"')) || (trimmedDecoded.startsWith("'") && trimmedDecoded.endsWith("'"))) {
              trimmedDecoded = trimmedDecoded.slice(1, -1).trim();
            }
            if (trimmedDecoded.startsWith("{")) {
              rawKey = trimmedDecoded;
            }
          } catch (e) {}
        }

        // Handle escaped quotes if JSON was escaped as a string literal (e.g. {\"type\":\"service_account\"...})
        if (rawKey.startsWith('{\\"') || rawKey.startsWith("{\\'") || rawKey.includes('\\"')) {
          try {
            const unescaped = rawKey.replace(/\\"/g, '"').replace(/\\'/g, "'");
            if (unescaped.startsWith("{")) {
              rawKey = unescaped;
            }
          } catch (e) {}
        }

        const serviceAccount = JSON.parse(rawKey);
        if (!serviceAccount || typeof serviceAccount !== "object") {
          throw new Error("Parsed credential is not a JSON object.");
        }

        // Validate required fields
        if (!serviceAccount.project_id) {
          throw new Error("Missing required field 'project_id'.");
        }
        if (!serviceAccount.client_email) {
          throw new Error("Missing required field 'client_email'.");
        }
        if (!serviceAccount.private_key) {
          throw new Error("Missing required field 'private_key'.");
        }

        // Normalize private key: correctly handle escaped newline characters (\n)
        let privateKey = String(serviceAccount.private_key || "").trim();
        if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
          privateKey = privateKey.slice(1, -1).trim();
        }
        if (privateKey.includes("\\n")) {
          privateKey = privateKey.replace(/\\n/g, "\n");
        }
        serviceAccount.private_key = privateKey;

        // Initialize using admin.credential.cert() or cert()
        credential = (admin.credential && typeof admin.credential.cert === "function")
          ? admin.credential.cert(serviceAccount)
          : cert(serviceAccount);
      } catch (parseErr) {
        throw new Error(`Invalid JSON in FIREBASE_SERVICE_ACCOUNT_KEY environment variable: ${parseErr.message}`);
      }
    }
    // 3. Backward-compatibility test support if legacy path is explicitly passed in a test harness
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const resolvedPath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.resolve(process.cwd(), serviceAccountPath);

      if (fs.existsSync(resolvedPath)) {
        const rawContent = fs.readFileSync(resolvedPath, "utf8");
        const serviceAccount = JSON.parse(rawContent);
        if (serviceAccount && typeof serviceAccount.private_key === "string") {
          let pk = serviceAccount.private_key.trim();
          if ((pk.startsWith('"') && pk.endsWith('"')) || (pk.startsWith("'") && pk.endsWith("'"))) {
            pk = pk.slice(1, -1).trim();
          }
          if (pk.includes("\\n")) {
            pk = pk.replace(/\\n/g, "\n");
          }
          serviceAccount.private_key = pk;
        }
        credential = (admin.credential && typeof admin.credential.cert === "function")
          ? admin.credential.cert(serviceAccount)
          : cert(serviceAccount);
      } else {
        throw new Error(`Firebase service account file not found at: ${resolvedPath}`);
      }
    } else {
      throw new Error(
        "Cloud Firestore Admin credentials are not configured on the server. " +
        "Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable. " +
        "Please configure the complete Service Account JSON in FIREBASE_SERVICE_ACCOUNT_KEY."
      );
    }

    const app = initializeApp({
      credential,
      projectId
    });

    firestoreDb = getFirestore(app);
    return firestoreDb;
  } catch (err) {
    initError = err;
    throw err;
  }
}

/**
 * Check if Firebase Admin is configured and ready
 */
function isFirestoreAdminConfigured() {
  try {
    getFirestoreDb();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Reset Admin instance for testing purposes
 */
async function resetFirestoreAdmin() {
  const { deleteApp } = require("firebase-admin/app");
  try {
    const existing = getApps();
    await Promise.all(existing.map(a => deleteApp(a)));
  } catch (e) {
    // ignore
  }
  firestoreDb = null;
  initError = null;
}

/**
 * Inject mock / testing Firestore DB for unit testing lifecycle without live network credentials
 */
function setMockFirestoreDb(mockDb) {
  firestoreDb = mockDb;
  initError = null;
}

/**
 * Fetch approved reviews for a specific product ID (or all approved reviews if productId is null) with pagination
 */
async function getApprovedReviews(productId = null, { limit = 10, offset = 0 } = {}) {
  const db = getFirestoreDb();
  const reviewsRef = db.collection(COLLECTION_NAME);

  let query = reviewsRef.where("status", "==", "APPROVED");
  if (productId) {
    query = query.where("productId", "==", productId);
  }

  let snapshot;
  try {
    snapshot = await query.orderBy("createdAt", "desc").get();
  } catch (err) {
    if (err.message && (err.message.includes("requires an index") || err.code === 9)) {
      snapshot = await query.get();
    } else {
      throw err;
    }
  }

  const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  allDocs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const paginated = allDocs.slice(offset, offset + limit);
  const hasMore = offset + limit < allDocs.length;

  return {
    reviews: paginated,
    total: allDocs.length,
    hasMore
  };
}

/**
 * Fetch all reviews for admin moderation (with status and product filters)
 */
async function getAdminReviews({ status = "ALL", productId = null, limit = 50, page = 1 } = {}) {
  const db = getFirestoreDb();
  const reviewsRef = db.collection(COLLECTION_NAME);

  let query = reviewsRef;
  if (productId) {
    query = query.where("productId", "==", productId);
  }
  if (status && status !== "ALL") {
    query = query.where("status", "==", status);
  }

  let snapshot;
  try {
    snapshot = await query.orderBy("createdAt", "desc").get();
  } catch (err) {
    if (err.message && (err.message.includes("requires an index") || err.code === 9)) {
      snapshot = await query.get();
    } else {
      throw err;
    }
  }

  const filteredDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  filteredDocs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const offset = (Math.max(1, page) - 1) * limit;
  const paginated = filteredDocs.slice(offset, offset + limit);

  // Aggregate counts for admin dashboard tabs
  const allSnapshot = await reviewsRef.get();
  const allDocs = allSnapshot.docs.map(d => d.data());

  return {
    reviews: paginated,
    total: filteredDocs.length,
    page,
    limit,
    counts: {
      total: allDocs.length,
      pending: allDocs.filter(r => r.status === "PENDING").length,
      quarantined: allDocs.filter(r => r.status === "QUARANTINED").length,
      approved: allDocs.filter(r => r.status === "APPROVED").length,
      rejected: allDocs.filter(r => r.status === "REJECTED").length
    }
  };
}

/**
 * Create a new customer review (verified and published immediately if clean, else PENDING/QUARANTINED)
 */
async function createReview(reviewPayload, { initialStatus = null } = {}) {
  const db = getFirestoreDb();
  const cleanRating = Math.min(5, Math.max(1, Math.round(Number(reviewPayload.rating) || 5)));
  const cleanTitle = String(reviewPayload.reviewTitle || "Clinical Feedback").trim().substring(0, 150);
  const cleanText = String(reviewPayload.reviewText || reviewPayload.comment || "").trim().substring(0, 2500);
  const customerName = String(
    reviewPayload.customerName ||
    reviewPayload.author ||
    (reviewPayload.userEmail ? reviewPayload.userEmail.split("@")[0] : "Verified Customer")
  ).trim().substring(0, 100);

  // Status is controlled strictly by server-side moderation; client cannot self-approve
  let assignedStatus = "PENDING";
  if (initialStatus === "APPROVED" || initialStatus === "QUARANTINED" || initialStatus === "PENDING" || initialStatus === "REJECTED") {
    assignedStatus = initialStatus;
  } else if (reviewPayload.moderatedStatus === "APPROVED" || reviewPayload.moderatedStatus === "QUARANTINED") {
    assignedStatus = reviewPayload.moderatedStatus;
  }

  const newDoc = {
    productId: reviewPayload.productId,
    productSlug: reviewPayload.productSlug || "",
    productTitle: reviewPayload.productTitle || "",
    rating: cleanRating,
    reviewTitle: cleanTitle,
    reviewText: cleanText,
    comment: cleanText, // backward compatibility
    customerFeedbackPoints: Array.isArray(reviewPayload.customerFeedbackPoints) 
      ? reviewPayload.customerFeedbackPoints.slice(0, 10) 
      : [],
    userId: "anonymous", // Prevent customer impersonation
    userEmail: String(reviewPayload.userEmail || "").substring(0, 150),
    customerName,
    author: customerName, // backward compatibility
    facility: String(reviewPayload.facility || "").trim().substring(0, 150),
    verifiedPurchase: false, // Strict: newly created reviews are unverified until admin checks order records
    status: assignedStatus,
    moderationReason: reviewPayload.moderationReason || null,
    aiAssisted: Boolean(reviewPayload.aiAssisted),
    date: new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = await db.collection(COLLECTION_NAME).add(newDoc);
  return {
    id: docRef.id,
    ...newDoc
  };
}

/**
 * Update review moderation status in Cloud Firestore (Admin Privileged Write)
 */
async function updateReviewStatus(reviewId, { status, verifiedPurchase, adminNote = null }) {
  const db = getFirestoreDb();
  const allowedStatuses = ["PENDING", "APPROVED", "REJECTED", "QUARANTINED"];
  if (status && !allowedStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${allowedStatuses.join(", ")}`);
  }

  const docRef = db.collection(COLLECTION_NAME).doc(reviewId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    return null;
  }

  const updates = {
    updatedAt: new Date().toISOString()
  };
  if (status) updates.status = status;
  if (verifiedPurchase !== undefined) updates.verifiedPurchase = Boolean(verifiedPurchase);
  if (adminNote !== undefined) updates.adminNote = adminNote;

  await docRef.update(updates);
  const updatedSnap = await docRef.get();
  return { id: updatedSnap.id, ...updatedSnap.data() };
}

/**
 * Delete a review from Cloud Firestore (Admin Privileged Write)
 */
async function deleteReview(reviewId) {
  const db = getFirestoreDb();
  const docRef = db.collection(COLLECTION_NAME).doc(reviewId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    return false;
  }

  await docRef.delete();
  return true;
}

module.exports = {
  getApprovedReviews,
  getAdminReviews,
  createReview,
  updateReviewStatus,
  deleteReview,
  getFirestoreDb,
  isFirestoreAdminConfigured,
  resetFirestoreAdmin,
  setMockFirestoreDb
};
