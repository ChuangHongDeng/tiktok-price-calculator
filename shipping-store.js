(function () {
  "use strict";

  const DB_NAME = "tiktok-pricing-shipping-v1";
  const DB_VERSION = 1;
  const STORE_NAME = "market-tables";
  const CONFIG_KEY = "tiktok-shipping-config-v1";
  const DEFAULT_EFFECTIVE_DATE = "2026-01-08";
  const DEFAULT_VOLUMETRIC_DIVISOR = 6000;

  const markets = {
    MY: { name: "马来西亚", currency: "MYR", limit: 30000 },
    PH: { name: "菲律宾", currency: "PHP", limit: 30000 },
    TH: { name: "泰国", currency: "THB", limit: 20000 },
    VN: { name: "越南", currency: "VND", limit: 30000 },
    SG: { name: "新加坡", currency: "SGD", limit: 30000 }
  };

  const defaultCalculators = {
    PH: (weight) => weight * 0.45,
    MY: (weight) => weight * 0.015,
    TH: (weight) => weight * 0.1,
    VN: (weight) => 10000 + weight * 90,
    SG: (weight) => weight <= 40 ? 0.98 : 0.98 + (weight - 40) * 0.015
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "market" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let settled = false;
      let result;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        database.close();
        reject(error);
      };
      try {
        result = operation(store);
      } catch (error) {
        fail(error);
        return;
      }
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result);
      };
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error || new Error("价表保存已取消。"));
    });
  }

  async function getAllTables() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      let settled = false;
      let tables = [];
      const fail = (error) => {
        if (settled) return;
        settled = true;
        database.close();
        reject(error);
      };
      request.onsuccess = () => { tables = request.result || []; };
      request.onerror = () => fail(request.error);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(tables);
      };
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error || new Error("价表读取已取消。"));
    });
  }

  async function saveTables(tables) {
    if (!Array.isArray(tables) || tables.length === 0) return;
    await runTransaction("readwrite", (store) => {
      tables.forEach((table) => store.put(table));
    });
  }

  async function deleteTable(market) {
    await runTransaction("readwrite", (store) => store.delete(market));
  }

  function normalizeTables(tables) {
    return new Map((tables || []).map((table) => [table.market, table]));
  }

  function defaultConfig(market) {
    return {
      maxWeight: markets[market]?.limit || 0,
      maxVolume: 0,
      volumetricDivisor: DEFAULT_VOLUMETRIC_DIVISOR
    };
  }

  function normalizeConfig(market, config = {}) {
    const fallback = defaultConfig(market);
    const maxWeight = Number(config.maxWeight);
    const normalizedMaxWeight = Number.isFinite(maxWeight) && maxWeight > 0
      ? Math.floor(maxWeight / 10) * 10
      : 0;
    const maxVolume = Number(config.maxVolume);
    const volumetricDivisor = Number(config.volumetricDivisor);
    return {
      maxWeight: normalizedMaxWeight > 0 ? normalizedMaxWeight : fallback.maxWeight,
      maxVolume: Number.isFinite(maxVolume) && maxVolume > 0 ? maxVolume : 0,
      volumetricDivisor: Number.isFinite(volumetricDivisor) && volumetricDivisor > 0
        ? volumetricDivisor
        : fallback.volumetricDivisor
    };
  }

  function getConfigs() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
      saved = {};
    }
    return Object.fromEntries(Object.keys(markets).map((market) => [market, normalizeConfig(market, saved[market])]));
  }

  function getConfig(market) {
    return getConfigs()[market] || defaultConfig(market);
  }

  function saveConfig(market, config) {
    if (!markets[market]) throw new Error("不支持的市场代码。");
    const configs = getConfigs();
    configs[market] = normalizeConfig(market, config);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(configs));
    return configs[market];
  }

  function calculateBilling(market, actualWeight, volume) {
    const config = getConfig(market);
    const weight = Number(actualWeight);
    const volumeCm3 = Number(volume) || 0;
    if (!markets[market]) return { valid: false, code: "unsupportedMarket", config };
    if (!Number.isFinite(weight) || weight <= 0) return { valid: false, code: "invalidWeight", config };
    if (!Number.isFinite(volumeCm3) || volumeCm3 < 0) return { valid: false, code: "invalidVolume", config };

    const volumetricWeight = volumeCm3 > 0 ? volumeCm3 / config.volumetricDivisor * 1000 : 0;
    const chargeableWeight = Math.max(weight, volumetricWeight);
    const source = volumetricWeight > weight ? "volume" : "actual";
    if (config.maxVolume > 0 && volumeCm3 > config.maxVolume) {
      return { valid: false, code: "volumeLimit", config, actualWeight: weight, volume: volumeCm3, volumetricWeight, chargeableWeight, source };
    }
    if (config.maxWeight > 0 && chargeableWeight > config.maxWeight) {
      return { valid: false, code: "weightLimit", config, actualWeight: weight, volume: volumeCm3, volumetricWeight, chargeableWeight, source };
    }
    return {
      valid: true,
      code: "ok",
      config,
      actualWeight: weight,
      volume: volumeCm3,
      volumetricWeight,
      chargeableWeight,
      source
    };
  }

  function getQuote(market, weight, tables) {
    const marketMeta = markets[market];
    const config = getConfig(market);
    const numericWeight = Number(weight);
    if (!marketMeta || !Number.isFinite(numericWeight) || numericWeight <= 0) return null;

    const roundedWeight = Math.ceil(numericWeight / 10) * 10;
    const tableMap = tables instanceof Map ? tables : normalizeTables(tables);
    const imported = tableMap.get(market);
    if (imported?.rows?.length) {
      const importedLimit = imported.rows[imported.rows.length - 1].maxWeight;
      const limit = Math.min(importedLimit, config.maxWeight || importedLimit);
      const row = imported.rows.find((item) => item.maxWeight <= limit && item.maxWeight >= roundedWeight);
      if (!row) return null;
      return {
        fee: row.fee,
        roundedWeight,
        limit,
        source: "imported",
        sourceFile: imported.sourceFile,
        effectiveDate: row.effectiveDate || imported.effectiveDate,
        importedAt: imported.importedAt,
        matchedMaxWeight: row.maxWeight,
        note: row.note || ""
      };
    }

    const limit = Math.min(marketMeta.limit, config.maxWeight || marketMeta.limit);
    if (roundedWeight > limit) return null;
    return {
      fee: defaultCalculators[market](roundedWeight),
      roundedWeight,
      limit,
      source: "default",
      sourceFile: "内置参考价卡",
      effectiveDate: DEFAULT_EFFECTIVE_DATE,
      matchedMaxWeight: roundedWeight,
      note: ""
    };
  }

  window.ShippingPriceStore = {
    markets,
    defaultEffectiveDate: DEFAULT_EFFECTIVE_DATE,
    defaultVolumetricDivisor: DEFAULT_VOLUMETRIC_DIVISOR,
    getAllTables,
    saveTables,
    deleteTable,
    normalizeTables,
    getConfigs,
    getConfig,
    saveConfig,
    calculateBilling,
    getQuote
  };
}());
