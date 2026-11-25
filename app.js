const STORAGE_KEY = "tiktok-pricing-calculator-v1";

const currencyMeta = {
  USD: { symbol: "$", rate: 7.2 },
  GBP: { symbol: "£", rate: 9.25 },
  EUR: { symbol: "€", rate: 8.35 },
  SGD: { symbol: "S$", rate: 5.3 },
  MYR: { symbol: "RM", rate: 1.6997 },
  THB: { symbol: "฿", rate: 0.2 },
  PHP: { symbol: "₱", rate: 0.1252 },
  VND: { symbol: "₫", rate: 0.00029 }
};

const marketPresets = {
  MY: { currency: "MYR", exchangeRate: 1.6997, platformRate: 8.46, paymentRate: 3.78, serviceRate: 0, serviceCap: 0, affiliateRate: 12, taxRate: 10, fixedOrderFee: 0, shippingSstRate: 6 },
  PH: { currency: "PHP", exchangeRate: 0.1252, platformRate: 5.96, paymentRate: 2.24, serviceRate: 5.5, serviceCap: 100, affiliateRate: 10, taxRate: 0, fixedOrderFee: 3, shippingSstRate: 0 },
  TH: { currency: "THB", exchangeRate: 0.2, platformRate: 5.35, paymentRate: 3.21, serviceRate: 5.35, serviceCap: 199, affiliateRate: 10, taxRate: 0, fixedOrderFee: 1.07, shippingSstRate: 0 },
  VN: { currency: "VND", exchangeRate: 0.00029, platformRate: 4, paymentRate: 5, serviceRate: 0, serviceCap: 0, affiliateRate: 10, taxRate: 10, fixedOrderFee: 3000, shippingSstRate: 0 },
  SG: { currency: "SGD", exchangeRate: 5.3, platformRate: 4.36, paymentRate: 3.27, serviceRate: 0, serviceCap: 0, affiliateRate: 10, taxRate: 0, fixedOrderFee: 0, shippingSstRate: 0 }
};

const currencyDigits = { VND: 0 };
const numericInputKeys = [
  "exchangeRate", "platformRate", "paymentRate", "serviceRate", "serviceCap", "fixedOrderFee",
  "affiliateRate", "adRate", "taxRate", "returnRate", "productWeight", "productLength", "productWidth",
  "productHeight", "productVolume", "profitMargin", "discountRate", "shippingSstRate"
];

const defaultState = {
  marketPreset: "custom",
  currency: "USD",
  exchangeRate: 7.2,
  costs: [
    { name: "采购成本", amount: 28 },
    { name: "头程物流", amount: 12 },
    { name: "包装耗材", amount: 2 },
    { name: "其他成本", amount: 0 }
  ],
  platformRate: 8,
  paymentRate: 2,
  serviceRate: 0,
  serviceCap: 0,
  fixedOrderFee: 0,
  affiliateRate: 10,
  adRate: 8,
  taxRate: 0,
  returnRate: 3,
  productWeight: 250,
  volumeInputMode: "dimensions",
  productLength: 0,
  productWidth: 0,
  productHeight: 0,
  productVolume: 0,
  shippingMode: "manual",
  manualShippingFee: 0,
  shippingSstRate: 6,
  profitMargin: 20,
  discountRate: 20,
  quantity: 1
};

let state = loadState();
let saveTimer;
let shippingTables = new Map();

const $ = (id) => document.getElementById(id);
const numberValue = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.costs)) return structuredClone(defaultState);
    return { ...structuredClone(defaultState), ...saved };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("saveState").textContent = "正在保存…";
    saveTimer = setTimeout(() => { $("saveState").textContent = "已自动保存"; }, 450);
  } catch {
    $("saveState").textContent = "无法自动保存";
  }
}

function getCurrencyDigits(currency) {
  return currencyDigits[currency] ?? 2;
}

function roundUpMoney(value, currency) {
  const factor = 10 ** getCurrencyDigits(currency);
  return Math.ceil(value * factor) / factor;
}

function roundHalfUp(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatMoney(value, currency = state.currency) {
  const safe = Number.isFinite(value) ? value : 0;
  const digits = getCurrencyDigits(currency);
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      roundingMode: "halfExpand"
    }).format(safe);
  } catch {
    return `${currencyMeta[currency]?.symbol || ""}${safe.toFixed(digits)}`;
  }
}

function formatCny(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    roundingMode: "halfExpand"
  }).format(roundHalfUp(value, 2));
}

function getShippingQuote(market, weight) {
  return window.ShippingPriceStore.getQuote(market, weight, shippingTables);
}

function getProductVolume() {
  if (state.volumeInputMode === "volume") return numberValue(state.productVolume);
  return numberValue(state.productLength) * numberValue(state.productWidth) * numberValue(state.productHeight);
}

function getBillingDetails() {
  const actualWeight = numberValue(state.productWeight);
  const volume = getProductVolume();
  if (window.ShippingPriceStore.markets[state.marketPreset]) {
    return window.ShippingPriceStore.calculateBilling(state.marketPreset, actualWeight, volume);
  }
  const divisor = window.ShippingPriceStore.defaultVolumetricDivisor;
  const volumetricWeight = volume > 0 ? volume / divisor * 1000 : 0;
  return {
    valid: actualWeight > 0,
    code: actualWeight > 0 ? "ok" : "invalidWeight",
    config: { maxWeight: 0, maxVolume: 0, volumetricDivisor: divisor },
    actualWeight,
    volume,
    volumetricWeight,
    chargeableWeight: Math.max(actualWeight, volumetricWeight),
    source: volumetricWeight > actualWeight ? "volume" : "actual"
  };
}

function formatWeight(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe >= 1000
    ? `${(safe / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}kg`
    : `${safe.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}g`;
}

function renderCostRows() {
  const container = $("costRows");
  container.replaceChildren();
  state.costs.forEach((cost, index) => {
    const row = $("costRowTemplate").content.firstElementChild.cloneNode(true);
    const nameInput = row.querySelector(".cost-name");
    const amountInput = row.querySelector(".cost-amount");
    nameInput.value = cost.name;
    amountInput.value = cost.amount || "";
    nameInput.addEventListener("input", (event) => {
      state.costs[index].name = event.target.value;
      update();
    });
    amountInput.addEventListener("input", (event) => {
      state.costs[index].amount = numberValue(event.target.value);
      update();
    });
    row.querySelector(".delete-cost").addEventListener("click", () => {
      state.costs.splice(index, 1);
      renderCostRows();
      update();
    });
    container.appendChild(row);
  });
}

function getCalculation() {
  const fixedCostCny = state.costs.reduce((sum, cost) => sum + numberValue(cost.amount), 0);
  const exchangeRate = numberValue(state.exchangeRate);
  const fixedCost = exchangeRate > 0 ? fixedCostCny / exchangeRate : 0;
  const billing = getBillingDetails();
  const shippingQuote = billing.valid ? getShippingQuote(state.marketPreset, billing.chargeableWeight) : null;
  const shippingCost = state.shippingMode === "official" ? (shippingQuote?.fee || 0) : numberValue(state.manualShippingFee);
  const shippingSstRate = numberValue(state.shippingSstRate) / 100;
  const rawShippingSst = shippingCost * shippingSstRate;
  const shippingSst = rawShippingSst ? roundHalfUp(rawShippingSst, getCurrencyDigits(state.currency)) : 0;
  const feeRate = ["platformRate", "paymentRate", "affiliateRate", "adRate", "taxRate", "returnRate"]
    .reduce((sum, key) => sum + numberValue(state[key]), 0) / 100;
  const serviceRate = numberValue(state.serviceRate) / 100;
  const serviceCap = numberValue(state.serviceCap);
  const fixedOrderFee = numberValue(state.fixedOrderFee);
  const profitRate = numberValue(state.profitMargin) / 100;
  const discountRate = Math.min(99, numberValue(state.discountRate)) / 100;
  const baseCost = fixedCost + shippingCost + shippingSst + fixedOrderFee;
  const uncappedDenominator = 1 - feeRate - serviceRate - profitRate;
  const cappedDenominator = 1 - feeRate - profitRate;
  let salePrice = 0;
  let error = "";

  if (exchangeRate <= 0) {
    error = "汇率必须大于 0。";
  } else if (state.shippingMode === "official" && !window.ShippingPriceStore.markets[state.marketPreset]) {
    error = "请先选择支持参考价卡的东南亚市场。";
  } else if (state.shippingMode === "official" && !billing.valid) {
    if (billing.code === "volumeLimit") {
      error = `商品体积不能超过 ${billing.config.maxVolume.toLocaleString("zh-CN")} cm³。`;
    } else if (billing.code === "weightLimit") {
      error = `计费重不能超过 ${billing.config.maxWeight / 1000} kg。`;
    } else {
      error = "商品实重必须大于 0。";
    }
  } else if (state.shippingMode === "official" && !shippingQuote) {
    const importedTable = shippingTables.get(state.marketPreset);
    const config = window.ShippingPriceStore.getConfig(state.marketPreset);
    const tableLimit = importedTable?.rows?.filter((row) => row.maxWeight <= config.maxWeight).at(-1)?.maxWeight;
    const limit = tableLimit || Math.min(config.maxWeight, window.ShippingPriceStore.markets[state.marketPreset].limit);
    error = `当前价表没有覆盖 ${formatWeight(billing.chargeableWeight)}，最大价格档为 ${formatWeight(limit)}。`;
  } else if (uncappedDenominator <= 0 && serviceCap <= 0) {
    error = "各项费率与目标利润率合计必须小于 100%。";
  } else if (cappedDenominator <= 0) {
    error = "除项目服务费外的费率与目标利润率合计必须小于 100%。";
  } else {
    const uncappedPrice = uncappedDenominator > 0 ? baseCost / uncappedDenominator : Number.POSITIVE_INFINITY;
    const hitsCap = serviceCap > 0 && uncappedPrice * serviceRate > serviceCap;
    salePrice = hitsCap ? (baseCost + serviceCap) / cappedDenominator : uncappedPrice;
  }

  if (!error && !Number.isFinite(salePrice)) {
    error = "各项费率与目标利润率合计必须小于 100%。";
  }
  if (!error && Number.isFinite(salePrice)) salePrice = roundUpMoney(salePrice, state.currency);
  const valid = !error && Number.isFinite(salePrice) && salePrice >= 0;
  const listPrice = valid ? roundUpMoney(salePrice / (1 - discountRate), state.currency) : 0;
  const percentageFees = valid ? salePrice * feeRate : 0;
  const rawServiceFee = valid ? salePrice * serviceRate : 0;
  const serviceFee = serviceCap > 0 ? Math.min(rawServiceFee, serviceCap) : rawServiceFee;
  const fees = valid ? percentageFees + serviceFee + fixedOrderFee : 0;
  const profit = valid ? salePrice - fixedCost - shippingCost - shippingSst - fees : 0;
  const unitCost = valid ? fixedCost + shippingCost + shippingSst + fees : 0;
  const costRate = salePrice > 0 ? unitCost / salePrice : 0;
  const quantity = Math.max(1, Math.round(numberValue(state.quantity)));
  const totalFixedCostCny = valid ? fixedCostCny * quantity : 0;
  const totalFixedCost = valid ? fixedCost * quantity : 0;
  const totalShippingCost = valid ? shippingCost * quantity : 0;
  const totalShippingSst = valid ? shippingSst * quantity : 0;
  const totalFees = valid ? fees * quantity : 0;
  const totalCost = valid ? unitCost * quantity : 0;
  const totalSalePrice = valid ? salePrice * quantity : 0;
  const totalListPrice = valid ? listPrice * quantity : 0;
  const totalProfit = valid ? profit * quantity : 0;
  const totalListPriceCny = valid ? listPrice * exchangeRate * quantity : 0;
  const totalSalePriceCny = valid ? salePrice * exchangeRate * quantity : 0;
  const totalProfitCny = valid ? profit * exchangeRate * quantity : 0;
  return {
    fixedCostCny, fixedCost, exchangeRate, billing, shippingQuote, shippingCost, shippingSst, shippingSstRate, feeRate, serviceRate, serviceCap,
    serviceFee, fixedOrderFee, profitRate, discountRate, valid, error, salePrice, listPrice, fees, profit, costRate, quantity,
    totalFixedCostCny, totalFixedCost, totalShippingCost, totalShippingSst, totalFees, totalCost,
    totalSalePrice, totalListPrice, totalProfit, totalListPriceCny, totalSalePriceCny, totalProfitCny
  };
}

function updateResults() {
  const calc = getCalculation();
  $("forwardCurrencyLabel").textContent = `1 ${state.currency} =`;
  $("reverseRate").textContent = calc.exchangeRate > 0
    ? `1 CNY = ${(1 / calc.exchangeRate).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} ${state.currency}`
    : `1 CNY = — ${state.currency}`;
  document.querySelectorAll(".currency-unit").forEach((unit) => { unit.textContent = state.currency; });
  const autoShipping = state.shippingMode === "official";
  $("shippingFee").readOnly = autoShipping;
  if (autoShipping) $("shippingFee").value = calc.shippingQuote?.fee ?? "";
  else if (document.activeElement !== $("shippingFee")) $("shippingFee").value = state.manualShippingFee;
  $("roundedWeightLabel").textContent = autoShipping && calc.shippingQuote ? `按计费重 ${calc.shippingQuote.roundedWeight}g` : "";
  $("calculatedVolume").textContent = `${calc.billing.volume.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} cm³`;
  $("volumetricWeightValue").textContent = formatWeight(calc.billing.volumetricWeight);
  $("chargeableWeightValue").textContent = formatWeight(calc.billing.chargeableWeight);
  $("chargeableReason").textContent = calc.billing.source === "volume" ? "按体积重" : "按实重";
  $("shippingReference").textContent = state.marketPreset === "custom"
    ? "支持手动填写，东南亚市场可按 10g 向上取整估算"
    : calc.shippingQuote?.source === "imported"
      ? `${window.ShippingPriceStore.markets[state.marketPreset].name}当前使用 ${calc.shippingQuote.sourceFile} · 体积重系数 ${calc.billing.config.volumetricDivisor} cm³/kg`
      : `${window.ShippingPriceStore.markets[state.marketPreset].name}内置参考价卡 · 体积重系数 ${calc.billing.config.volumetricDivisor} cm³/kg`;
  $("fixedCostTotal").textContent = formatCny(calc.fixedCostCny);
  $("shippingSstAmount").textContent = `+${formatMoney(calc.shippingSst)}`;
  $("listPrice").textContent = formatMoney(calc.listPrice);
  $("salePrice").textContent = formatMoney(calc.salePrice);
  $("listPriceCny").textContent = formatCny(calc.listPrice * calc.exchangeRate);
  $("salePriceCny").textContent = formatCny(calc.salePrice * calc.exchangeRate);
  $("quantityLabel").textContent = `共 ${calc.quantity} 件`;
  $("totalListPrice").textContent = formatMoney(calc.totalListPrice);
  $("totalSalePrice").textContent = formatMoney(calc.totalSalePrice);
  $("totalCost").textContent = formatMoney(calc.totalCost);
  $("totalProfit").textContent = formatMoney(calc.totalProfit);
  $("totalSalePriceCny").textContent = formatCny(calc.totalSalePriceCny);
  $("totalProfitCny").textContent = `约 ${formatCny(calc.totalProfitCny)}`;
  $("profitValue").textContent = formatMoney(calc.profit);
  $("profitValueCny").textContent = `约 ${formatCny(calc.profit * calc.exchangeRate)}`;
  $("costRate").textContent = `${(calc.costRate * 100).toFixed(1)}%`;
  $("costValue").textContent = formatMoney(calc.fixedCost);
  $("shippingValue").textContent = formatMoney(calc.shippingCost);
  $("shippingSstValue").textContent = formatMoney(calc.shippingSst);
  $("feeValue").textContent = formatMoney(calc.fees);
  $("profitBreakdown").textContent = formatMoney(calc.profit);
  $("salePriceLabel").textContent = `成交价 ${formatMoney(calc.salePrice)}`;
  $("discountBadge").textContent = calc.discountRate === 0 ? "无折扣" : `${((1 - calc.discountRate) * 10).toFixed(1).replace(".0", "")} 折`;

  const total = calc.valid && calc.salePrice ? calc.salePrice : 1;
  $("stackedBar").classList.toggle("is-invalid", !calc.valid);
  $("stackedBar").querySelector(".bar-cost").style.width = `${(calc.valid ? calc.fixedCost : 0) / total * 100}%`;
  $("stackedBar").querySelector(".bar-shipping").style.width = `${(calc.valid ? calc.shippingCost : 0) / total * 100}%`;
  $("stackedBar").querySelector(".bar-sst").style.width = `${(calc.valid ? calc.shippingSst : 0) / total * 100}%`;
  $("stackedBar").querySelector(".bar-fee").style.width = `${(calc.valid ? calc.fees : 0) / total * 100}%`;
  $("stackedBar").querySelector(".bar-profit").style.width = `${(calc.valid ? Math.max(0, calc.profit) : 0) / total * 100}%`;

  $("validationMessage").textContent = calc.error;
  $("copyButton").disabled = !calc.valid || calc.fixedCost + calc.shippingCost <= 0;
}

function update() {
  updateResults();
  saveState();
}

function renderVolumeInputMode() {
  const directVolume = state.volumeInputMode === "volume";
  $("dimensionsFields").hidden = directVolume;
  $("directVolumeField").hidden = !directVolume;
  $("dimensionsModeButton").setAttribute("aria-pressed", String(!directVolume));
  $("volumeModeButton").setAttribute("aria-pressed", String(directVolume));
}

function bindInputs() {
  numericInputKeys.forEach((key) => {
    $(key).value = state[key];
    $(key).addEventListener("input", (event) => {
      state[key] = numberValue(event.target.value);
      update();
    });
  });

  $("marketPreset").value = state.marketPreset;
  $("marketPreset").addEventListener("change", (event) => {
    state.marketPreset = event.target.value;
    const preset = marketPresets[state.marketPreset];
    if (preset) {
      Object.assign(state, preset, { shippingMode: "official" });
      bindStateToInputs();
    } else {
      state.shippingMode = "manual";
      $("shippingMode").value = state.shippingMode;
    }
    update();
  });

  $("currency").value = state.currency;
  $("currency").addEventListener("change", (event) => {
    state.currency = event.target.value;
    state.exchangeRate = currencyMeta[state.currency].rate;
    state.marketPreset = "custom";
    state.shippingMode = "manual";
    $("exchangeRate").value = state.exchangeRate;
    $("marketPreset").value = state.marketPreset;
    $("shippingMode").value = state.shippingMode;
    update();
  });

  $("shippingMode").value = state.shippingMode;
  $("shippingMode").addEventListener("change", (event) => {
    state.shippingMode = event.target.value;
    $("shippingFee").value = state.shippingMode === "manual" ? state.manualShippingFee : "";
    update();
  });

  $("shippingFee").value = state.manualShippingFee;
  $("shippingFee").addEventListener("input", (event) => {
    if (state.shippingMode !== "manual") return;
    state.manualShippingFee = numberValue(event.target.value);
    update();
  });

  $("quantity").value = state.quantity;
  $("quantity").addEventListener("input", (event) => {
    state.quantity = Math.max(1, Math.round(numberValue(event.target.value)));
    update();
  });

  $("dimensionsModeButton").addEventListener("click", () => {
    state.volumeInputMode = "dimensions";
    renderVolumeInputMode();
    update();
  });
  $("volumeModeButton").addEventListener("click", () => {
    state.volumeInputMode = "volume";
    renderVolumeInputMode();
    update();
  });
  renderVolumeInputMode();

  $("addCostButton").addEventListener("click", () => {
    state.costs.push({ name: "新成本", amount: 0 });
    renderCostRows();
    update();
    document.querySelector(".cost-row:last-child .cost-name").select();
  });

  $("resetButton").addEventListener("click", () => {
    if (!window.confirm("确定恢复默认数据吗？当前输入会被清除。")) return;
    state = structuredClone(defaultState);
    renderCostRows();
    bindStateToInputs();
    update();
  });

  $("copyButton").addEventListener("click", async () => {
    const calc = getCalculation();
    const details = [
      `TikTok 定价结果（${state.currency}）`,
      `商品原价：${formatMoney(calc.listPrice)}`,
      `商品原价人民币：${formatCny(calc.listPrice * calc.exchangeRate)}`,
      `活动折扣：${numberValue(state.discountRate)}%`,
      `折后售价：${formatMoney(calc.salePrice)}`,
      `折后售价人民币：${formatCny(calc.salePrice * calc.exchangeRate)}`,
      `销售数量：${calc.quantity} 件`,
      `总商品原价：${formatMoney(calc.totalListPrice)}`,
      `总成交额：${formatMoney(calc.totalSalePrice)}`,
      `总成交额人民币：${formatCny(calc.totalSalePriceCny)}`,
      `预计单件利润：${formatMoney(calc.profit)}`,
      `预计单件利润人民币：${formatCny(calc.profit * calc.exchangeRate)}`,
      `预计总利润：${formatMoney(calc.totalProfit)}`,
      `预计总利润人民币：${formatCny(calc.totalProfitCny)}`,
      `固定成本：${formatCny(calc.fixedCostCny)}`,
      `跨境物流：${formatMoney(calc.shippingCost)}`,
      `尾程运费 SST：${formatMoney(calc.shippingSst)}（${(calc.shippingSstRate * 100).toFixed(1)}%）`,
      `商品实重：${formatWeight(calc.billing.actualWeight)}`,
      `商品体积：${calc.billing.volume.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} cm³`,
      `体积重：${formatWeight(calc.billing.volumetricWeight)}`,
      `物流计费重：${formatWeight(calc.billing.chargeableWeight)}`,
      `比例费率：${(calc.feeRate * 100).toFixed(1)}%`,
      `项目服务费：${formatMoney(calc.serviceFee)}`,
      `每单固定费：${formatMoney(calc.fixedOrderFee)}`,
      `目标利润率：${numberValue(state.profitMargin).toFixed(1)}%`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      $("copyButton").textContent = "已复制";
      setTimeout(() => { $("copyButton").textContent = "复制定价结果"; }, 1200);
    } catch {
      window.prompt("复制下面的定价结果", details);
    }
  });
}

function bindStateToInputs() {
  numericInputKeys.forEach((key) => { $(key).value = state[key]; });
  $("marketPreset").value = state.marketPreset;
  $("currency").value = state.currency;
  $("shippingMode").value = state.shippingMode;
  $("shippingFee").value = state.manualShippingFee;
  $("quantity").value = state.quantity;
  renderVolumeInputMode();
}

async function loadShippingPriceTables() {
  try {
    const tables = await window.ShippingPriceStore.getAllTables();
    shippingTables = window.ShippingPriceStore.normalizeTables(tables);
    updateResults();
  } catch {
    shippingTables = new Map();
  }
}

renderCostRows();
bindInputs();
updateResults();
loadShippingPriceTables();
