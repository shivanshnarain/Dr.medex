/**
 * DR.MEDEX — Complete Physiotherapy Product Catalog Import & Database Synchronization
 * 
 * Synchronizes the 80 product placements across 10 categories:
 * 1. Ultrasound Therapy Machines: 34
 * 2. TENS Machines: 11
 * 3. Laser Therapy Machines: 6
 * 4. CPM: 7
 * 5. Shortwave Diathermy Machine: 2
 * 6. Longwave Diathermy Machine: 2
 * 7. Shockwave Therapy Machine: 3
 * 8. Electronic Traction Machine: 3
 * 9. Interferential Therapy (IFT): 1
 * 10. Electric Muscle Stimulator: 11
 * Total: 80
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const mongoService = require("./mongoService");

const DB_PATH = path.join(__dirname, "../data/db.json");
const FALLBACK_PRODUCTS_PATH = path.join(__dirname, "../../client/src/data/fallbackProducts.json");
const FALLBACK_CATEGORIES_PATH = path.join(__dirname, "../../client/src/data/fallbackCategories.json");
const SCRAPED_PATH = path.join(__dirname, "../data/physiotherapy_scraped_products.json");
const AUDIT_PATH = path.join(__dirname, "../data/physio_category_audit.json");

async function main() {
  console.log("=================================================================");
  console.log("DR.MEDEX — PHYSIOTHERAPY CATALOG IMPORT & SYNCHRONIZATION");
  console.log("=================================================================\n");

  const scrapedProducts = JSON.parse(fs.readFileSync(SCRAPED_PATH, "utf8"));
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
  const slugToCats = audit.slug_to_categories;

  console.log(`Loaded ${scrapedProducts.length} scraped products from reference catalog.`);

  // Load local databases
  const dbData = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const fallbackProducts = JSON.parse(fs.readFileSync(FALLBACK_PRODUCTS_PATH, "utf8"));
  const fallbackCategories = JSON.parse(fs.readFileSync(FALLBACK_CATEGORIES_PATH, "utf8"));

  // Ensure 'ift' subcategory exists in dbData categories
  const physioCatInDb = dbData.categories.find(c => c.id === "physiotherapy");
  if (physioCatInDb) {
    if (!physioCatInDb.subcategories.some(s => s.id === "ift")) {
      physioCatInDb.subcategories.push({
        id: "ift",
        slug: "ift",
        name: "Interferential Therapy (IFT)"
      });
      console.log("Added 'ift' subcategory to db.json categories.");
    }
  }

  // Ensure 'ift' exists in fallbackCategories
  const physioCatInFallback = fallbackCategories.find(c => c.id === "physiotherapy");
  if (physioCatInFallback) {
    if (!physioCatInFallback.subcategories.some(s => s.id === "ift")) {
      physioCatInFallback.subcategories.push({
        id: "ift",
        slug: "ift",
        name: "Interferential Therapy (IFT)"
      });
      console.log("Added 'ift' subcategory to fallbackCategories.json.");
    }
  }

  // Map of scraped products by slug
  const scrapedBySlug = new Map(scrapedProducts.map(p => [p.slug, p]));

  // Track counts
  let updatedInDb = 0;
  let insertedInDb = 0;

  // Process dbData.products
  const dbProducts = dbData.products || [];
  const dbSlugIndex = new Map();
  dbProducts.forEach((p, idx) => {
    if (p.slug) dbSlugIndex.set(p.slug, idx);
    else if (p.referenceURL) {
      const s = p.referenceURL.split("/product-page/")[1];
      if (s) dbSlugIndex.set(s, idx);
    }
  });

  // Also index ESWT shockwave by title or partial id
  const eswtIdx = dbProducts.findIndex(p => 
    p.slug === "extracorporeal-shock-wave-therapy-eswt-machine-for-joint-and-muscle-pain-relief" ||
    (p.title && p.title.toLowerCase().includes("shock wave therapy") && p.title.toLowerCase().includes("eswt"))
  );
  if (eswtIdx !== -1) {
    dbSlugIndex.set("extracorporeal-shock-wave-therapy-eswt-machine-for-joint-and-muscle-pain-relief", eswtIdx);
  }

  // Ensure replacement probe is classified as general accessory rather than a machine
  const probeIdx = dbProducts.findIndex(p => p.slug === "premium-replacement-probes-for-ultronix-ultrasound-therapy-machine");
  if (probeIdx !== -1) {
    dbProducts[probeIdx].subcategory = "physiotherapy-general";
    dbProducts[probeIdx].subcategories = ["physiotherapy-general"];
  }

  for (const [slug, scraped] of scrapedBySlug.entries()) {
    const assignedCats = slugToCats[slug] || scraped.subcategories || [scraped.subcategory];
    scraped.subcategories = assignedCats;
    scraped.subcategory = assignedCats[0];

    if (dbSlugIndex.has(slug)) {
      const idx = dbSlugIndex.get(slug);
      const existing = dbProducts[idx];

      // Preserve any existing Cloudinary images if present
      const hasCloudinary = Array.isArray(existing.images) && existing.images.some(img => typeof img === "string" && img.includes("cloudinary.com"));
      const mergedImages = hasCloudinary ? existing.images : scraped.images;
      const mergedPrimary = hasCloudinary ? (existing.primaryImage || existing.images[0]) : scraped.primaryImage;

      dbProducts[idx] = {
        ...existing,
        ...scraped,
        id: existing.id, // Preserve existing ID
        title: scraped.title,
        productName: scraped.productName,
        category: "physiotherapy",
        categoryName: "Physiotherapy Machines",
        subcategory: assignedCats[0],
        subcategories: assignedCats,
        productType: scraped.productType,
        images: mergedImages,
        galleryImages: mergedImages,
        primaryImage: mergedPrimary,
        originalSourceImages: scraped.originalSourceImages,
        features: scraped.features,
        specifications: scraped.specifications,
        applications: scraped.applications,
        shortDescription: scraped.shortDescription,
        fullDescription: scraped.fullDescription,
        overview: scraped.overview,
        basePrice: scraped.basePrice,
        regularPrice: scraped.regularPrice,
        salePrice: scraped.salePrice,
        baseCurrency: "INR",
        referenceURL: scraped.referenceURL,
        status: "ACTIVE",
        reviewStatus: "CORRECT",
        inCatalogue: true,
        isRetired: false,
        updatedAt: new Date().toISOString()
      };
      updatedInDb++;
    } else {
      // New product
      dbProducts.push({
        ...scraped,
        status: "ACTIVE",
        reviewStatus: "CORRECT",
        inCatalogue: true,
        isRetired: false,
        updatedAt: new Date().toISOString()
      });
      insertedInDb++;
    }
  }

  dbData.products = dbProducts;
  fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2), "utf8");
  console.log(`Updated db.json: ${updatedInDb} updated, ${insertedInDb} newly inserted. Total products: ${dbProducts.length}`);

  // Now process fallbackProducts.json
  const fbProducts = fallbackProducts || [];
  const fbSlugIndex = new Map();
  fbProducts.forEach((p, idx) => {
    if (p.slug) fbSlugIndex.set(p.slug, idx);
    else if (p.referenceURL) {
      const s = p.referenceURL.split("/product-page/")[1];
      if (s) fbSlugIndex.set(s, idx);
    }
  });

  const eswtFbIdx = fbProducts.findIndex(p => 
    p.slug === "extracorporeal-shock-wave-therapy-eswt-machine-for-joint-and-muscle-pain-relief" ||
    (p.title && p.title.toLowerCase().includes("shock wave therapy") && p.title.toLowerCase().includes("eswt"))
  );
  if (eswtFbIdx !== -1) {
    fbSlugIndex.set("extracorporeal-shock-wave-therapy-eswt-machine-for-joint-and-muscle-pain-relief", eswtFbIdx);
  }

  const probeFbIdx = fbProducts.findIndex(p => p.slug === "premium-replacement-probes-for-ultronix-ultrasound-therapy-machine");
  if (probeFbIdx !== -1) {
    fbProducts[probeFbIdx].subcategory = "physiotherapy-general";
    fbProducts[probeFbIdx].subcategories = ["physiotherapy-general"];
  }

  let updatedInFb = 0;
  let insertedInFb = 0;

  for (const [slug, scraped] of scrapedBySlug.entries()) {
    const assignedCats = slugToCats[slug] || scraped.subcategories || [scraped.subcategory];
    scraped.subcategories = assignedCats;
    scraped.subcategory = assignedCats[0];

    if (fbSlugIndex.has(slug)) {
      const idx = fbSlugIndex.get(slug);
      const existing = fbProducts[idx];

      const hasCloudinary = Array.isArray(existing.images) && existing.images.some(img => typeof img === "string" && img.includes("cloudinary.com"));
      const mergedImages = hasCloudinary ? existing.images : scraped.images;
      const mergedPrimary = hasCloudinary ? (existing.primaryImage || existing.images[0]) : scraped.primaryImage;

      fbProducts[idx] = {
        ...existing,
        ...scraped,
        id: existing.id,
        title: scraped.title,
        productName: scraped.productName,
        category: "physiotherapy",
        categoryName: "Physiotherapy Machines",
        subcategory: assignedCats[0],
        subcategories: assignedCats,
        productType: scraped.productType,
        images: mergedImages,
        galleryImages: mergedImages,
        primaryImage: mergedPrimary,
        originalSourceImages: scraped.originalSourceImages,
        features: scraped.features,
        specifications: scraped.specifications,
        applications: scraped.applications,
        shortDescription: scraped.shortDescription,
        fullDescription: scraped.fullDescription,
        overview: scraped.overview,
        basePrice: scraped.basePrice,
        regularPrice: scraped.regularPrice,
        salePrice: scraped.salePrice,
        baseCurrency: "INR",
        referenceURL: scraped.referenceURL,
        status: "ACTIVE",
        reviewStatus: "CORRECT",
        inCatalogue: true,
        isRetired: false,
        updatedAt: new Date().toISOString()
      };
      updatedInFb++;
    } else {
      fbProducts.push({
        ...scraped,
        status: "ACTIVE",
        reviewStatus: "CORRECT",
        inCatalogue: true,
        isRetired: false,
        updatedAt: new Date().toISOString()
      });
      insertedInFb++;
    }
  }

  fs.writeFileSync(FALLBACK_PRODUCTS_PATH, JSON.stringify(fbProducts, null, 2), "utf8");
  fs.writeFileSync(FALLBACK_CATEGORIES_PATH, JSON.stringify(fallbackCategories, null, 2), "utf8");
  console.log(`Updated fallbackProducts.json: ${updatedInFb} updated, ${insertedInFb} newly inserted. Total products: ${fbProducts.length}`);

  // Also sync to MongoDB Atlas if configured
  if (mongoService.isConfigured()) {
    console.log("\nSynchronizing updated catalog directly to MongoDB Atlas...");
    try {
      const client = await mongoService.getClient();
      const col = client.db().collection("approved_products");

      let mongoUpsertCount = 0;
      for (const p of dbProducts) {
        if (p.category === "physiotherapy") {
          const doc = { ...p };
          delete doc._id;
          await col.updateOne(
            { id: p.id },
            { $set: doc },
            { upsert: true }
          );
          mongoUpsertCount++;
        }
      }
      console.log(`Successfully synchronized ${mongoUpsertCount} physiotherapy products to MongoDB Atlas collection 'approved_products'.`);

      // Update taxonomy in MongoDB if collection exists
      const taxCol = client.db().collection("catalogue_taxonomy");
      const hier = require("../data/catalogueHierarchy");
      await taxCol.updateOne(
        { key: "default" },
        { $set: { hierarchy: hier, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      console.log("Updated catalogue_taxonomy in MongoDB Atlas.");
    } catch (err) {
      console.error("MongoDB Atlas sync error:", err.message);
    }
  }

  console.log("\n=================================================================");
  console.log("VALIDATING PHYSIOTHERAPY RECONCILIATION AFTER IMPORT");
  console.log("=================================================================");

  const expectedCounts = [
    { name: "Ultrasound Therapy Machines", subcat: "ultrasound-therapy-machines", target: 34 },
    { name: "TENS Machines", subcat: "tens-machines", target: 11 },
    { name: "Laser Therapy Machines", subcat: "laser-therapy-machine", target: 6 },
    { name: "CPM", subcat: "cpm", target: 7 },
    { name: "Shortwave Diathermy Machine", subcat: "shortwave-diathermy-machine", target: 2 },
    { name: "Longwave Diathermy Machine", subcat: "longwave-diathermy-machine", target: 2 },
    { name: "Shockwave Therapy Machine", subcat: "shockwave-therapy-machine", target: 3 },
    { name: "Electronic Traction Machine", subcat: "electronic-traction-machine", target: 3 },
    { name: "Interferential Therapy (IFT)", subcat: "ift", target: 1 },
    { name: "Electric Muscle Stimulator", subcat: "electric-muscle-stimulator", target: 11 }
  ];

  const physioList = dbProducts.filter(p => p.category === "physiotherapy");
  console.log(`Total unique physiotherapy products in catalog: ${physioList.length}`);

  let grandTotalPlacements = 0;
  let allPass = true;

  expectedCounts.forEach((sec, idx) => {
    const matching = physioList.filter(p => 
      p.subcategory === sec.subcat || 
      (Array.isArray(p.subcategories) && p.subcategories.includes(sec.subcat))
    );
    const count = matching.length;
    grandTotalPlacements += count;
    const ok = count === sec.target;
    if (!ok) allPass = false;
    console.log(`[Category ${idx + 1}] ${sec.name} (${sec.subcat}): ${count} / ${sec.target} ${ok ? "✅ PASS" : "❌ FAIL"}`);

    // Verify images
    matching.forEach(p => {
      if (!p.primaryImage || !p.images || p.images.length === 0) {
        console.error(`  [WARN] Missing images for ${p.id} (${p.title})`);
        allPass = false;
      }
    });
  });

  console.log(`\nTotal Category Placements: ${grandTotalPlacements} (Expected: 80) ${grandTotalPlacements === 80 ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Reconciliation status: ${allPass ? "ALL 10 CATEGORIES PASSED!" : "FAILURES DETECTED"}`);

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
