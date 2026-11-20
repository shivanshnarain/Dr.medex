const { MongoClient } = require("mongodb");
const dns = require("dns");

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}

const products = require("../data/products");
const categories = require("../data/categories");
const catalogueHierarchy = require("../data/catalogueHierarchy");

async function seedStaging() {
  const uri = process.env.MONGODB_URI || "mongodb+srv://roshanofficial0009_db_user:ExUyOvI6KQ5NNJOq@cluster0.7y0dbdy.mongodb.net/?appName=Cluster0";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db("drmedex_test");
    console.log("[SeedStaging] Connected to test database: drmedex_test");

    // 1. Ensure indexes
    await db.collection("approved_products").createIndex({ id: 1 }, { unique: true });
    await db.collection("approved_products").createIndex({ slug: 1 });
    await db.collection("approved_products").createIndex({ status: 1 });
    await db.collection("orders").createIndex({ orderNumber: 1 }, { unique: true });
    await db.collection("processed_webhooks").createIndex({ eventId: 1 }, { unique: true });

    // 2. Seed disposable products with test inventory
    const existingCount = await db.collection("approved_products").countDocuments();
    if (existingCount === 0) {
      console.log(`[SeedStaging] Seeding ${products.length} disposable test products...`);
      const testProducts = products.map(p => ({
        ...p,
        isTestProduct: true,
        stock: 100,
        stockQuantity: 100,
        stockStatus: "IN_STOCK",
        updatedAt: new Date().toISOString()
      }));
      await db.collection("approved_products").insertMany(testProducts);
      console.log(`[SeedStaging] Successfully seeded ${testProducts.length} test products.`);
    } else {
      console.log(`[SeedStaging] approved_products already contains ${existingCount} items.`);
    }

    // 3. Seed catalogue taxonomy
    const existingTaxCount = await db.collection("catalogue_taxonomy").countDocuments();
    if (existingTaxCount === 0) {
      console.log(`[SeedStaging] Seeding catalogue taxonomy...`);
      await db.collection("catalogue_taxonomy").insertOne({
        type: "hierarchy",
        data: catalogueHierarchy,
        categories: categories,
        updatedAt: new Date().toISOString()
      });
      console.log("[SeedStaging] Successfully seeded taxonomy.");
    }

    console.log("[SeedStaging] Database isolation verified: drmedex_test is ready.");
  } catch (err) {
    console.error("[SeedStaging] Error:", err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  seedStaging();
}

module.exports = seedStaging;
