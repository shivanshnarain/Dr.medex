const countries = require("../data/countries");

// Base currency: INR
// Fallback exchange rates relative to 1 INR (1 INR = X target currency)
const fallbackRatesAgainstINR = {
  INR: 1.0,
  USD: 0.01156,
  EUR: 0.01093,
  GBP: 0.00922,
  AED: 0.04246,
  SAR: 0.04338,
  CAD: 0.01653,
  AUD: 0.01835,
  ZAR: 0.2085,
  NGN: 18.25,
  SGD: 0.01563,
  JPY: 1.7857,
  CHF: 0.01042
};

let cachedRates = { ...fallbackRatesAgainstINR };
let lastFetchedAt = 0; // Initialize to 0 so the first call always fetches live rates
const CACHE_DURATION_MS = 1000 * 60 * 60; // 1 hour cache

// Currency symbol and locale map
const currencyMeta = {
  INR: { symbol: "₹", decimals: 0, locale: "en-IN" },
  USD: { symbol: "$", decimals: 2, locale: "en-US" },
  GBP: { symbol: "£", decimals: 2, locale: "en-GB" },
  EUR: { symbol: "€", decimals: 2, locale: "de-DE" },
  AED: { symbol: "AED", decimals: 2, locale: "ar-AE" },
  SAR: { symbol: "SAR", decimals: 2, locale: "ar-SA" },
  CAD: { symbol: "CA$", decimals: 2, locale: "en-CA" },
  AUD: { symbol: "A$", decimals: 2, locale: "en-AU" },
  ZAR: { symbol: "R", decimals: 2, locale: "en-ZA" },
  NGN: { symbol: "₦", decimals: 2, locale: "en-NG" },
  SGD: { symbol: "S$", decimals: 2, locale: "en-SG" },
  JPY: { symbol: "¥", decimals: 0, locale: "ja-JP" },
  CHF: { symbol: "CHF", decimals: 2, locale: "de-CH" }
};

async function syncLiveRates() {
  // If cache is still warm, use it
  if (Date.now() - lastFetchedAt < CACHE_DURATION_MS && Object.keys(cachedRates).length > 5) {
    return cachedRates;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch("https://open.er-api.com/v6/latest/INR", {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data && data.rates) {
        cachedRates = {
          ...fallbackRatesAgainstINR,
          INR: 1.0,
          USD: data.rates.USD || fallbackRatesAgainstINR.USD,
          EUR: data.rates.EUR || fallbackRatesAgainstINR.EUR,
          GBP: data.rates.GBP || fallbackRatesAgainstINR.GBP,
          AED: data.rates.AED || fallbackRatesAgainstINR.AED,
          SAR: data.rates.SAR || fallbackRatesAgainstINR.SAR,
          CAD: data.rates.CAD || fallbackRatesAgainstINR.CAD,
          AUD: data.rates.AUD || fallbackRatesAgainstINR.AUD,
          ZAR: data.rates.ZAR || fallbackRatesAgainstINR.ZAR,
          NGN: data.rates.NGN || fallbackRatesAgainstINR.NGN,
          SGD: data.rates.SGD || fallbackRatesAgainstINR.SGD,
          JPY: data.rates.JPY || fallbackRatesAgainstINR.JPY,
          CHF: data.rates.CHF || fallbackRatesAgainstINR.CHF
        };
        lastFetchedAt = Date.now();
      }
    }
  } catch (err) {
    // Graceful fallback to cached/fallback rates
  }

  return cachedRates;
}

function getRateForCurrency(currency) {
  const code = (currency || "INR").toUpperCase();
  return cachedRates[code] || fallbackRatesAgainstINR[code] || 1.0;
}

function convertPrice(basePriceINR, targetCurrency) {
  const code = (targetCurrency || "INR").toUpperCase();
  if (code === "INR") {
    return Math.round(basePriceINR);
  }
  const rate = getRateForCurrency(code);
  const rawConverted = basePriceINR * rate;
  const meta = currencyMeta[code] || { decimals: 2 };
  
  if (meta.decimals === 0) {
    return Math.round(rawConverted);
  }
  return Number(rawConverted.toFixed(2));
}

function getCurrencyMeta(currency) {
  return currencyMeta[currency] || { symbol: currency, decimals: 2, locale: "en-US" };
}

function formatPrice(amount, currency) {
  const code = (currency || "INR").toUpperCase();
  const meta = getCurrencyMeta(code);
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: "currency",
      currency: code === "AED" || code === "SAR" ? undefined : code,
      maximumFractionDigits: meta.decimals,
      minimumFractionDigits: meta.decimals
    }).format(amount);
  } catch (e) {
    return `${meta.symbol}${amount.toLocaleString(undefined, {
      maximumFractionDigits: meta.decimals,
      minimumFractionDigits: meta.decimals
    })}`;
  }
}

// Initial sync in background
syncLiveRates().catch(() => {});

module.exports = {
  syncLiveRates,
  getExchangeRates: () => ({
    baseCurrency: "INR",
    rates: cachedRates,
    lastFetchedAt: new Date(lastFetchedAt).toISOString(),
    supportedCurrencies: Object.keys(cachedRates).map(code => ({
      code,
      symbol: currencyMeta[code]?.symbol || code,
      rateAgainstINR: cachedRates[code],
      inrPerTarget: cachedRates[code] ? Number((1 / cachedRates[code]).toFixed(2)) : 1
    }))
  }),
  getRateForCurrency,
  convertPrice,
  formatPrice,
  getCurrencyMeta
};
