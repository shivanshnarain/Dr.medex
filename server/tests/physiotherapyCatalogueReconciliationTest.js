const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const store = require("../services/store");
const mongoService = require("../services/mongoService");

async function runTest() {
  console.log("=================================================================");
  console.log("TEST: Physiotherapy Catalogue Reconciliation & 10 Category Sections");
  console.log("=================================================================");

  store.reloadFromDisk();

  const deletedIds = mongoService.isConfigured() ? await mongoService.getDeletedProductIds() : new Set();
  let list = store.getProducts({ includeInactive: true }).filter(p => !deletedIds.has(String(p.id)));

  if (mongoService.isConfigured()) {
    try {
      const mongoList = await mongoService.getProductsFromMongo();
      const activeMongoList = mongoList.filter(m => !deletedIds.has(String(m.id)));
      const mongoMap = new Map(activeMongoList.map(m => [String(m.id), m]));
      const storeMap = new Set(list.map(p => String(p.id)));

      list = list.map(p => {
        const pid = String(p.id);
        const m = mongoMap.get(pid);
        if (m) {
          return {
            ...p,
            ...m,
            reviewStatus: (m.reviewStatus === "CORRECT" || p.reviewStatus === "CORRECT")
              ? "CORRECT"
              : (m.reviewStatus === "NEEDS_EDITING" || p.reviewStatus === "NEEDS_EDITING")
              ? "NEEDS_EDITING"
              : (m.reviewStatus || p.reviewStatus || "PENDING")
          };
        }
        return p;
      });

      activeMongoList.forEach(m => {
        const mid = String(m.id);
        if (!storeMap.has(mid)) {
          list.push({
            ...m,
            reviewStatus: m.reviewStatus || "PENDING"
          });
        }
      });
    } catch (e) {
      console.warn("Mongo query note:", e.message);
    }
  }

  // 1. Total Catalogue size (198 products total across all categories)
  console.log(`[Check 1] Total catalogue size: ${list.length} (Expected: 198)`);
  assert.strictEqual(list.length, 198, `Catalogue size must be 198, got ${list.length}`);

  // 2. Total Physiotherapy Products count
  const physioProducts = list.filter(p => p.category === "physiotherapy");
  console.log(`[Check 2] Total Physiotherapy products count: ${physioProducts.length} (Expected: 70)`);
  assert.strictEqual(physioProducts.length, 70, `Expected 70 physiotherapy products, got ${physioProducts.length}`);

  // 3. Verify CPM machine relocation to physiotherapy
  const relocatedCpm = list.find(p => p.id === "prod-wireless-remote-control-");
  assert.ok(relocatedCpm, "prod-wireless-remote-control- must exist");
  assert.strictEqual(relocatedCpm.category, "physiotherapy", "prod-wireless-remote-control- must be in physiotherapy");
  assert.strictEqual(relocatedCpm.subcategory, "cpm", "prod-wireless-remote-control- subcategory must be cpm");
  assert.ok(Array.isArray(relocatedCpm.images) && relocatedCpm.images.length > 0, "Images must be preserved for prod-wireless-remote-control-");
  console.log(`[Check 3] Verified relocated CPM machine: ${relocatedCpm.id} -> ${relocatedCpm.category}/${relocatedCpm.subcategory} (${relocatedCpm.images.length} images)`);

  // 4. Verify all 10 category counts
  const isInSubcategory = (p, subcat) => {
    return p.subcategory === subcat || (Array.isArray(p.subcategories) && p.subcategories.includes(subcat));
  };

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

  let sumSections = 0;
  expectedCounts.forEach((sec, idx) => {
    const matching = physioProducts.filter(p => isInSubcategory(p, sec.subcat));
    console.log(`[Check 4.${idx + 1}] Section ${idx + 1}: ${sec.name} -> Count: ${matching.length} (Target: ${sec.target})`);
    assert.strictEqual(matching.length, sec.target, `Section ${sec.name} count mismatch: expected ${sec.target}, got ${matching.length}`);

    // Verify no duplicates within section
    const secIds = new Set();
    matching.forEach(p => {
      assert.strictEqual(secIds.has(p.id), false, `Duplicate ID ${p.id} found within section ${sec.name}`);
      secIds.add(p.id);
    });

    sumSections += matching.length;
  });

  console.log(`[Check 5] Sum of all 10 sections: ${sumSections} (Expected: 80)`);
  assert.strictEqual(sumSections, 80, `Sum of 10 sections must equal 80, got ${sumSections}`);

  // 6. Verify multi-category overlap assignments
  const comboMachine = physioProducts.find(p => p.id === "prod-ombination-therapy-machi" || p.slug === "ombination-therapy-machine-ift-ultrasound-tens-russian-muscle-stimulator");
  assert.ok(comboMachine, "Combination therapy machine must exist");
  assert.deepStrictEqual(
    comboMachine.subcategories,
    ["ultrasound-therapy-machines", "tens-machines", "longwave-diathermy-machine", "electric-muscle-stimulator"],
    "Combination machine must belong to all 4 overlapping subcategories"
  );
  console.log(`[Check 6a] Combination machine multi-category assignment verified: 4 subcategories`);

  const tensUltrasound = physioProducts.find(p => p.id === "prod-4-channel-tens-unit-with" || p.slug === "4-channel-tens-unit-with-1-mhz-ultrasound-therapy-advanced-pain-relief-unit");
  assert.ok(tensUltrasound, "4-channel TENS ultrasound machine must exist");
  assert.deepStrictEqual(
    tensUltrasound.subcategories,
    ["ultrasound-therapy-machines", "tens-machines", "electric-muscle-stimulator"],
    "4-channel TENS ultrasound machine must belong to 3 overlapping subcategories"
  );
  console.log(`[Check 6b] 4-Channel TENS ultrasound multi-category assignment verified: 3 subcategories`);

  // Verify newly imported IFT product
  const iftProd = physioProducts.find(p => p.slug === "i-f-t-vacuum-therapy-machine-for-physiotherapy-skrilix");
  assert.ok(iftProd, "IFT machine must exist in catalog");
  assert.strictEqual(iftProd.subcategory, "ift", "IFT machine subcategory must be 'ift'");
  console.log(`[Check 6c] IFT machine verified: ${iftProd.title} (${iftProd.images.length} images)`);

  // 7. Verify Image Integrity across all physiotherapy products
  let totalPhysioImages = 0;
  physioProducts.forEach(p => {
    assert.ok(Array.isArray(p.images), `Product ${p.id} must have images array`);
    assert.ok(p.images.length > 0, `Product ${p.id} must have at least 1 image`);
    p.images.forEach(img => {
      assert.strictEqual(typeof img, "string", `Product ${p.id} image must be string URL`);
      assert.ok(img.startsWith("http://") || img.startsWith("https://") || img.startsWith("/"), `Invalid image URL in ${p.id}`);
    });
    totalPhysioImages += p.images.length;
  });
  console.log(`[Check 7] Image integrity verified across 70 physiotherapy products: ${totalPhysioImages} images intact`);

  // 8. Verify Review-Gated Publishing rule:
  // Public storefront call (includeInactive: false) must return approved physiotherapy products
  const publicStorefrontProducts = store.getProducts({ includeInactive: false });
  const publicPhysio = publicStorefrontProducts.filter(p => p.category === "physiotherapy");
  console.log(`[Check 8] Public storefront physiotherapy count: ${publicPhysio.length}`);
  assert.ok(publicPhysio.length > 0, "Public storefront must contain approved physiotherapy products");
  assert.ok(publicPhysio.every(p => p.status === "ACTIVE" && p.reviewStatus === "CORRECT"), "All public physiotherapy products must be reviewed and active");

  console.log("\n=================================================================");
  console.log("ALL 8 PHYSIOTHERAPY RECONCILIATION CHECKS PASSED SUCCESSFULLY!");
  console.log("=================================================================");
}

runTest().then(() => process.exit(0)).catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
