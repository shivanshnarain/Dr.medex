import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { Search, AlertCircle, RefreshCw, ChevronDown } from "lucide-react";
import { Product, Category } from "../types";
import { ProductCard } from "../components/ProductCard";
import { QuickViewModal } from "../components/QuickViewModal";
import { B2BQuoteModal } from "../components/B2BQuoteModal";
import { useCurrency } from "../context/CurrencyContext";
import {
  getProducts,
  getCategories,
  getCachedProductsSync,
  fallbackCategories
} from "../services/productService";

export const ShopPage: React.FC = () => {
  const { categorySlug } = useParams<{ categorySlug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentCurrency, currentCountry, formatPrice } = useCurrency();

  const [products, setProducts] = useState<Product[]>(() => getCachedProductsSync() || []);
  const [categories, setCategories] = useState<Category[]>(() => fallbackCategories);
  const [isLoading, setIsLoading] = useState(() => !getCachedProductsSync());
  const [apiError, setApiError] = useState<string | null>(null);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  // Modals
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quoteProduct, setQuoteProduct] = useState<Product | null>(null);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);

  // Active filters from URL or local state
  const rawCategory = categorySlug || searchParams.get("category") || "";
  const selectedCategory = rawCategory;
  const selectedSubcategory = searchParams.get("subcategory") || "";
  const searchQuery = searchParams.get("search") || "";
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [sortBy, setSortBy] = useState("featured");
  const [maxPriceINR, setMaxPriceINR] = useState<number>(700000);

  const handleOpenQuote = (prod: Product) => {
    setQuoteProduct(prod);
    setIsQuoteModalOpen(true);
  };

  // Load products & categories via resilient product service
  const loadData = async () => {
    if (products.length === 0) {
      setIsLoading(true);
    }
    setApiError(null);
    try {
      const [prodRes, catRes] = await Promise.all([
        getProducts(),
        getCategories()
      ]);

      if (prodRes && Array.isArray(prodRes.products) && prodRes.products.length > 0) {
        setProducts(prodRes.products);
      }
      if (catRes && Array.isArray(catRes.categories) && catRes.categories.length > 0) {
        setCategories(catRes.categories);
      }

      if ((!prodRes || prodRes.products.length === 0) && products.length === 0) {
        setApiError("No product catalog records are currently available.");
      }
    } catch (e: any) {
      console.error("Error loading shop data:", e);
      if (products.length === 0) {
        setApiError("Unable to establish connection with medical catalog service.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const handleUpdate = () => {
      loadData();
    };
    window.addEventListener("drmedex_catalogue_updated", handleUpdate);
    return () => {
      window.removeEventListener("drmedex_catalogue_updated", handleUpdate);
    };
  }, []);

  // Reconcile stale subcategory filter when switching category
  useEffect(() => {
    if (selectedCategory && selectedSubcategory && categories.length > 0) {
      const activeCat = categories.find(
        (c) => c.slug === selectedCategory || c.id === selectedCategory
      );
      if (activeCat) {
        const subcategoryBelongs = activeCat.subcategories.some(
          (s) => s.slug === selectedSubcategory || s.id === selectedSubcategory
        );
        if (!subcategoryBelongs) {
          const params = new URLSearchParams(searchParams);
          params.delete("subcategory");
          setSearchParams(params, { replace: true });
        }
      }
    }
  }, [selectedCategory, selectedSubcategory, categories, searchParams, setSearchParams]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let list = [...products];

    // Website visibility rule: ONLY CORRECT products display on the public storefront
    list = list.filter((p) => p.reviewStatus === "CORRECT");

    // Dynamic Inventory rule: If a product has zero available inventory, do not show it as an available product in customer-facing listing
    list = list.filter((p) => {
      const stock = Number(p.stock !== undefined ? p.stock : (p.stockQuantity !== undefined ? p.stockQuantity : 1));
      return stock > 0 && p.stockStatus !== "OUT_OF_STOCK";
    });

    if (selectedCategory) {
      const activeCat = categories.find(
        (c) => c.slug === selectedCategory || c.id === selectedCategory
      );
      if (activeCat) {
        list = list.filter((p) => p.category === activeCat.id || p.category === activeCat.slug);
      } else {
        // Check if selectedCategory is a subcategory slug/id
        const parentWithSub = categories.find((c) =>
          (c.subcategories || []).some((s) => s.slug === selectedCategory || s.id === selectedCategory)
        );
        if (parentWithSub) {
          list = list.filter(
            (p) =>
              p.subcategory === selectedCategory ||
              p.subcategory === selectedCategory.replace(/-/g, " ") ||
              (Array.isArray(p.subcategories) && p.subcategories.includes(selectedCategory))
          );
        } else {
          list = list.filter((p) => p.category === selectedCategory);
        }
      }
    }

    if (selectedSubcategory) {
      const isSurgery =
        selectedSubcategory === "electrosurgical-surgery" ||
        selectedSubcategory === "electro-surgical-skin-cautery" ||
        selectedSubcategory === "cautery";
      const isGen =
        selectedSubcategory === "electrosurgical-generator" ||
        selectedSubcategory === "generators" ||
        selectedSubcategory === "electrosurgical-generators";
      const isCryoGun =
        selectedSubcategory === "cryo-guns" ||
        selectedSubcategory === "cryo-gun";

      list = list.filter((p) => {
        if (isSurgery) {
          return (
            p.subcategory === "electrosurgical-surgery" ||
            p.subcategory === "electro-surgical-skin-cautery" ||
            p.subcategory === "cautery"
          );
        }
        if (isGen) {
          return (
            p.subcategory === "electrosurgical-generator" ||
            p.subcategory === "generators" ||
            p.subcategory === "electrosurgical-generators"
          );
        }
        if (isCryoGun) {
          return p.subcategory === "cryo-guns" || p.subcategory === "cryo-gun";
        }
        return (
          p.subcategory === selectedSubcategory ||
          p.subcategory === selectedSubcategory.replace(/-/g, " ") ||
          (Array.isArray(p.subcategories) && p.subcategories.includes(selectedSubcategory))
        );
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.shortDescription.toLowerCase().includes(q) ||
          (p.applications && p.applications.some((a) => a.toLowerCase().includes(q)))
      );
    }

    return list;
  }, [products, selectedCategory, selectedSubcategory, searchQuery, categories]);

  const activeCategoryObject = categories.find((c) => c.slug === selectedCategory || c.id === selectedCategory);

  // Dynamic Category Visibility: Only display categories that have active, published, in-stock products
  const activeCategoriesWithProducts = useMemo(() => {
    return categories.filter((cat) => {
      const catSlugs = [cat.id, cat.slug, (cat.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")].filter(Boolean);
      return products.some((p) => {
        const matchesCat = catSlugs.includes(p.category) || catSlugs.includes((p as any).categorySlug);
        if (!matchesCat) return false;
        const stock = Number(p.stock !== undefined ? p.stock : (p.stockQuantity !== undefined ? p.stockQuantity : 1));
        return stock > 0 && p.stockStatus !== "OUT_OF_STOCK" && p.reviewStatus === "CORRECT";
      });
    });
  }, [categories, products]);

  // Dynamic Subcategory Visibility: Only display subcategories that have active, published, in-stock products
  const validSubcategories = useMemo(() => {
    if (!activeCategoryObject || !Array.isArray(activeCategoryObject.subcategories)) return [];
    return activeCategoryObject.subcategories.filter((sub) => {
      const catSlugs = [activeCategoryObject.id, activeCategoryObject.slug, (activeCategoryObject.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")].filter(Boolean);
      const subSlugs = [sub.id, sub.slug, (sub.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")].filter(Boolean);
      if (sub.slug === "electrosurgical-surgery" || sub.id === "electrosurgical-surgery") subSlugs.push("electro-surgical-skin-cautery", "cautery");
      if (sub.slug === "electrosurgical-generator" || sub.id === "electrosurgical-generator") subSlugs.push("generators", "electrosurgical-generators");
      if (sub.slug === "cryo-guns" || sub.id === "cryo-guns") subSlugs.push("cryo-gun");

      return products.some((p) => {
        const matchesCat = catSlugs.includes(p.category) || catSlugs.includes((p as any).categorySlug);
        if (!matchesCat) return false;
        const stock = Number(p.stock !== undefined ? p.stock : (p.stockQuantity !== undefined ? p.stockQuantity : 1));
        if (stock <= 0 || p.stockStatus === "OUT_OF_STOCK" || p.reviewStatus !== "CORRECT") return false;

        const pSub = (p.subcategory || (p as any).subcategoryId || "").toLowerCase().trim();
        const pSubs = Array.isArray(p.subcategories) ? p.subcategories.map((s) => String(s).toLowerCase().trim()) : [];
        return subSlugs.some((s) => s.toLowerCase() === pSub || pSubs.includes(s.toLowerCase()));
      });
    });
  }, [activeCategoryObject, products]);

  const handleCategoryClick = (catSlug: string) => {
    if (selectedCategory === catSlug) {
      navigate("/shop-all");
    } else {
      navigate(`/category/${catSlug}`);
    }
  };

  const handleSubcategoryClick = (subSlug: string) => {
    const params = new URLSearchParams(searchParams);
    if (selectedSubcategory === subSlug) {
      params.delete("subcategory");
    } else {
      params.set("subcategory", subSlug);
    }
    setSearchParams(params);
  };

  const handleResetFilters = () => {
    setSelectedRating(null);
    setOnlyInStock(false);
    setMaxPriceINR(700000);
    setSortBy("featured");
    navigate("/shop-all");
  };

  return (
    <div className="w-full bg-[#FAFAFA] min-h-screen py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Clean Header: Heading and professional English description */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3.5xl font-black text-[#111111] tracking-tight">
            {activeCategoryObject ? activeCategoryObject.name : "Medical Equipment & Technology"}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-600 mt-2 max-w-2xl leading-relaxed">
            {activeCategoryObject
              ? (activeCategoryObject.shortDescription || "Precision-engineered medical equipment and certified healthcare technology.")
              : "Explore our range of medical equipment and healthcare technology for hospitals, clinics and healthcare professionals."}
          </p>
        </div>

        {/* Clean Responsive Category & Subcategory Selector Dropdowns */}
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] w-full sm:w-auto">
            <label htmlFor="shop-category-select" className="sr-only">
              Select Category
            </label>
            <div className="relative">
              <select
                id="shop-category-select"
                value={selectedCategory || "all"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "all") {
                    navigate("/shop-all");
                  } else {
                    navigate(`/category/${val}`);
                  }
                }}
                className="w-full appearance-none bg-white border border-[#EAEAEA] rounded-xl px-4 py-2.5 pr-10 text-xs font-bold text-neutral-800 shadow-2xs hover:border-[#7AA05A] focus:outline-none focus:border-[#7AA05A] transition-colors cursor-pointer"
              >
                <option value="all">All Equipment & Technology</option>
                {activeCategoriesWithProducts.map((cat) => (
                  <option key={cat.id} value={cat.slug || cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500">
                <ChevronDown size={15} />
              </div>
            </div>
          </div>

          {activeCategoryObject && validSubcategories.length > 0 && (
            <div className="relative min-w-[220px] w-full sm:w-auto">
              <label htmlFor="shop-subcategory-select" className="sr-only">
                Select Subcategory
              </label>
              <div className="relative">
                <select
                  id="shop-subcategory-select"
                  value={selectedSubcategory || "all"}
                  onChange={(e) => {
                    const val = e.target.value;
                    const params = new URLSearchParams(searchParams);
                    if (val === "all") {
                      params.delete("subcategory");
                    } else {
                      params.set("subcategory", val);
                    }
                    setSearchParams(params);
                  }}
                  className="w-full appearance-none bg-white border border-[#EAEAEA] rounded-xl px-4 py-2.5 pr-10 text-xs font-bold text-neutral-800 shadow-2xs hover:border-[#7AA05A] focus:outline-none focus:border-[#7AA05A] transition-colors cursor-pointer"
                >
                  <option value="all">All {activeCategoryObject.name.replace(/Equipment|Machines|Units/i, "").trim()}</option>
                  {validSubcategories.map((sub) => (
                    <option key={sub.id} value={sub.slug || sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500">
                  <ChevronDown size={15} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Product Grid Area: Clean full width on both Shop All and Category pages */}
        <main className="w-full">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-80 bg-white rounded-xl animate-pulse border border-[#EAEAEA]" />
                ))}
              </div>
            ) : apiError && products.length === 0 ? (
              <div className="bg-white rounded-xl border border-red-200 p-16 text-center space-y-4 shadow-xs">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full border border-red-200 flex items-center justify-center mx-auto">
                  <AlertCircle size={28} />
                </div>
                <h3 className="text-base font-bold text-[#111111]">Catalogue Service Unavailable</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  {apiError}
                </p>
                <button
                  type="button"
                  onClick={loadData}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#167A4A] hover:bg-[#13673e] text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
                >
                  <RefreshCw size={14} />
                  <span>Retry Connection</span>
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#EAEAEA] p-16 text-center space-y-4">
                <div className="w-16 h-16 bg-[#FAFAFA] rounded-full border border-[#EAEAEA] flex items-center justify-center mx-auto text-neutral-400">
                  <Search size={24} />
                </div>
                <h3 className="text-base font-bold text-[#111111]">No medical devices match your criteria</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  Try adjusting your category filter, increasing the price range, or searching for general terms like "cautery", "OT light", or "ultrasound".
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-6 py-2.5 bg-[#111111] hover:bg-[#1F7A4D] text-white rounded-xl text-xs font-bold transition-colors"
                >
                  Reset All Filters
                </button>
              </div>
            ) : selectedCategory === "ot-lights" && !selectedSubcategory ? (
              <div className="space-y-12">
                {/* Quick Anchor Navigation */}
                <div className="p-4 bg-white rounded-xl border border-[#EAEAEA] shadow-2xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-extrabold uppercase tracking-wider text-neutral-400">
                      Sections:
                    </span>
                    {[
                      { id: "single-dome-ot-lights", slug: "single-dome-ot-lights", name: "Single Dome OT Lights" },
                      { id: "ot-surgical-lights-double-dome", slug: "ot-surgical-lights-double-dome", name: "Double Dome OT Lights" },
                      { id: "mobile-led-ot-lights", slug: "mobile-led-ot-lights", name: "Mobile OT Lights" }
                    ].map((sec) => {
                      const count = products.filter(
                        (p) => (p.category === "ot-lights" || p.category === "OT / Surgical Lights") && p.subcategory === sec.slug
                      ).length;
                      return (
                        <a
                          key={sec.id}
                          href={`#${sec.id}`}
                          className="px-3 py-1.5 rounded-lg bg-[#FAFAFA] hover:bg-[#7AA05A] text-[#111111] hover:text-white border border-[#EAEAEA] text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs group"
                        >
                          <span>{sec.name}</span>
                          <span className="text-3xs font-mono px-1.5 py-0.2 rounded bg-neutral-200 text-neutral-800 group-hover:bg-white/20 group-hover:text-white">
                            {count}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                  <div className="text-xs font-mono text-neutral-500">
                    <span className="font-bold text-[#111111]">
                      {products.filter((p) => p.category === "ot-lights" || p.category === "OT / Surgical Lights").length}
                    </span>{" "}
                    Total Products
                  </div>
                </div>

                {/* 3 Distinct Vertically Stacked Sections */}
                {[
                  {
                    id: "single-dome-ot-lights",
                    slug: "single-dome-ot-lights",
                    title: "Single Dome OT Lights",
                    description: "Ceiling and wall-mounted single dome shadowless surgical lighting systems engineered for focused operating theatre visibility."
                  },
                  {
                    id: "ot-surgical-lights-double-dome",
                    slug: "ot-surgical-lights-double-dome",
                    title: "Double Dome OT Lights",
                    description: "Dual-head and twin dome surgical illumination systems with balanced articulated suspension for advanced operating suites."
                  },
                  {
                    id: "mobile-led-ot-lights",
                    slug: "mobile-led-ot-lights",
                    title: "Mobile OT Lights",
                    description: "Floor-standing mobile LED operating theatre lights with smooth castors and optional emergency battery backup."
                  }
                ].map((sec) => {
                  const secProducts = filteredProducts.filter((p) => p.subcategory === sec.slug);
                  const dbTotal = products.filter(
                    (p) => (p.category === "ot-lights" || p.category === "OT / Surgical Lights") && p.subcategory === sec.slug
                  ).length;

                  return (
                    <section key={sec.id} id={sec.id} className="scroll-mt-24 space-y-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[#EAEAEA] gap-2">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h2 className="text-xl sm:text-2xl font-black text-[#111111] tracking-tight">
                              {sec.title}
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-[#EAF5EF] text-[#145A38] border border-[#1F7A4D]/20">
                              {dbTotal} Certified Products
                            </span>
                          </div>
                          <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
                            {sec.description}
                          </p>
                        </div>
                        {secProducts.length !== dbTotal && (
                          <span className="text-2xs font-mono text-neutral-400">
                            Showing {secProducts.length} of {dbTotal}
                          </span>
                        )}
                      </div>

                      {secProducts.length === 0 ? (
                        <div className="p-8 bg-white rounded-xl border border-dashed border-[#EAEAEA] text-center text-xs text-neutral-500">
                          No products match active filters in {sec.title}.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                          {secProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              onQuickView={setQuickViewProduct}
                              onOpenQuote={handleOpenQuote}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : selectedCategory === "physiotherapy" && !selectedSubcategory ? (
              <div className="space-y-12">
                {/* Quick Anchor Navigation */}
                <div className="p-4 bg-white rounded-xl border border-[#EAEAEA] shadow-2xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-extrabold uppercase tracking-wider text-neutral-400">
                      Sections:
                    </span>
                    {[
                      { id: "ultrasound-therapy-machines", slug: "ultrasound-therapy-machines", name: "Ultrasound Therapy Machines" },
                      { id: "tens-machines", slug: "tens-machines", name: "TENS Machines" },
                      { id: "laser-therapy-machine", slug: "laser-therapy-machine", name: "Laser Therapy Machines" },
                      { id: "cpm", slug: "cpm", name: "CPM Machines" },
                      { id: "shortwave-diathermy-machine", slug: "shortwave-diathermy-machine", name: "Short Wave Diathermy Machines" },
                      { id: "longwave-diathermy-machine", slug: "longwave-diathermy-machine", name: "Long Wave Diathermy Machines" },
                      { id: "shockwave-therapy-machine", slug: "shockwave-therapy-machine", name: "Shock Wave Therapy Machines" },
                      { id: "electronic-traction-machine", slug: "electronic-traction-machine", name: "Electronic Traction Machines" },
                      { id: "electric-muscle-stimulator", slug: "electric-muscle-stimulator", name: "Electric Muscle Stimulators" }
                    ].map((sec) => {
                      const count = products.filter(
                        (p) =>
                          (p.category === "physiotherapy" || p.category === "Physiotherapy Machines") &&
                          (p.subcategory === sec.slug || (Array.isArray(p.subcategories) && p.subcategories.includes(sec.slug))) &&
                          p.reviewStatus === "CORRECT"
                      ).length;
                      return (
                        <a
                          key={sec.id}
                          href={`#${sec.id}`}
                          className="px-3 py-1.5 rounded-lg bg-[#FAFAFA] hover:bg-[#7AA05A] text-[#111111] hover:text-white border border-[#EAEAEA] text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs group"
                        >
                          <span>{sec.name}</span>
                          <span className="text-3xs font-mono px-1.5 py-0.2 rounded bg-neutral-200 text-neutral-800 group-hover:bg-white/20 group-hover:text-white">
                            {count}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                  <div className="text-xs font-mono text-neutral-500">
                    <span className="font-bold text-[#111111]">
                      {products.filter((p) => (p.category === "physiotherapy" || p.category === "Physiotherapy Machines") && p.reviewStatus === "CORRECT").length}
                    </span>{" "}
                    Published Products
                  </div>
                </div>

                {/* 9 Distinct Vertically Stacked Sections in Exact Order */}
                {[
                  {
                    id: "ultrasound-therapy-machines",
                    slug: "ultrasound-therapy-machines",
                    title: "1. Ultrasound Therapy Machines",
                    description: "High-frequency therapeutic ultrasound systems engineered for deep-tissue heating, soft tissue rehabilitation, and pain management."
                  },
                  {
                    id: "tens-machines",
                    slug: "tens-machines",
                    title: "2. TENS Machines",
                    description: "Transcutaneous Electrical Nerve Stimulation devices for effective non-invasive electro-analgesia and chronic pain relief."
                  },
                  {
                    id: "laser-therapy-machine",
                    slug: "laser-therapy-machine",
                    title: "3. Laser Therapy Machines",
                    description: "Clinical cold laser and photobiomodulation therapy units for accelerated tissue healing, anti-inflammatory therapy, and rehabilitation."
                  },
                  {
                    id: "cpm",
                    slug: "cpm",
                    title: "4. CPM Machines",
                    description: "Continuous Passive Motion rehabilitation equipment for post-operative joint recovery of knee, hip, shoulder, and ankle joints."
                  },
                  {
                    id: "shortwave-diathermy-machine",
                    slug: "shortwave-diathermy-machine",
                    title: "5. Short Wave Diathermy Machines",
                    description: "High-frequency solid-state 500W shortwave diathermy generators delivering deep heating for extensive muscle and tendon conditions."
                  },
                  {
                    id: "longwave-diathermy-machine",
                    slug: "longwave-diathermy-machine",
                    title: "6. Long Wave Diathermy Machines",
                    description: "Targeted longwave RF capacitive/resistive diathermy systems designed for deep pain relief and localized physiological recovery."
                  },
                  {
                    id: "shockwave-therapy-machine",
                    slug: "shockwave-therapy-machine",
                    title: "7. Shock Wave Therapy Machines",
                    description: "Extracorporeal Shock Wave Therapy (ESWT) ballistic and radial devices for musculoskeletal conditions and plantar fasciitis."
                  },
                  {
                    id: "electronic-traction-machine",
                    slug: "electronic-traction-machine",
                    title: "8. Electronic Traction Machines",
                    description: "Microprocessor-controlled decompression and electronic traction systems for cervical and lumbar spinal rehabilitation."
                  },
                  {
                    id: "electric-muscle-stimulator",
                    slug: "electric-muscle-stimulator",
                    title: "9. Electric Muscle Stimulators",
                    description: "Neuromuscular electrical stimulation (NMES), galvanic, and faradic current units for muscle re-education and atrophy prevention."
                  }
                ].map((sec) => {
                  const secProducts = filteredProducts.filter((p) => p.subcategory === sec.slug || (Array.isArray(p.subcategories) && p.subcategories.includes(sec.slug)));
                  const dbTotal = products.filter(
                    (p) =>
                      (p.category === "physiotherapy" || p.category === "Physiotherapy Machines") &&
                      (p.subcategory === sec.slug || (Array.isArray(p.subcategories) && p.subcategories.includes(sec.slug))) &&
                      p.reviewStatus === "CORRECT"
                  ).length;

                  return (
                    <section key={sec.id} id={sec.id} className="scroll-mt-24 space-y-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[#EAEAEA] gap-2">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h2 className="text-xl sm:text-2xl font-black text-[#111111] tracking-tight">
                              {sec.title}
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-2xs font-mono font-bold bg-[#EAF5EF] text-[#145A38] border border-[#1F7A4D]/20">
                              {dbTotal} Verified Products
                            </span>
                          </div>
                          <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
                            {sec.description}
                          </p>
                        </div>
                        {secProducts.length !== dbTotal && (
                          <span className="text-2xs font-mono text-neutral-400">
                            Showing {secProducts.length} of {dbTotal}
                          </span>
                        )}
                      </div>

                      {secProducts.length === 0 ? (
                        <div className="p-8 bg-white rounded-xl border border-dashed border-[#EAEAEA] text-center text-xs text-neutral-500">
                          No reviewed products are currently published in {sec.title}.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                          {secProducts.map((p) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              onQuickView={setQuickViewProduct}
                              onOpenQuote={handleOpenQuote}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                {filteredProducts.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onQuickView={setQuickViewProduct}
                    onOpenQuote={handleOpenQuote}
                  />
                ))}
              </div>
            )}
          </main>
      </div>

      {/* Modals */}
      <QuickViewModal
        product={quickViewProduct}
        onClose={() => setQuickViewProduct(null)}
        onOpenQuote={handleOpenQuote}
      />

      <B2BQuoteModal
        product={quoteProduct}
        isOpen={isQuoteModalOpen}
        onClose={() => setIsQuoteModalOpen(false)}
      />
    </div>
  );
};
