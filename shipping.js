(function () {
  "use strict";

  const store = window.ShippingPriceStore;
  const markets = store.markets;
  const pageSize = 50;
  const state = {
    tables: new Map(),
    configs: store.getConfigs(),
    selectedMarket: "MY",
    page: 1,
    pendingTables: []
  };

  const $ = (id) => document.getElementById(id);
  const marketAliases = {
    MY: "MY", MALAYSIA: "MY", 马来西亚: "MY",
    PH: "PH", PHILIPPINES: "PH", 菲律宾: "PH",
    TH: "TH", THAILAND: "TH", 泰国: "TH",
    VN: "VN", VIETNAM: "VN", 越南: "VN",
    SG: "SG", SINGAPORE: "SG", 新加坡: "SG"
  };
  const headerAliases = {
    market: ["市场代码", "市场", "国家代码", "国家", "market", "marketcode", "country", "countrycode"],
    currency: ["币种", "货币", "currency", "currencycode"],
    maxWeight: ["重量克", "重量上限g", "重量上限", "最大重量g", "最大重量", "计费重量g", "计费重量", "maxweightg", "maxweight", "weightg", "weight"],
    fee: ["全境当地货币", "物流费", "运费", "价格", "费用", "shippingfee", "freight", "fee", "price"],
    effectiveDate: ["生效日期", "更新日期", "日期", "effectivedate", "updatedate", "date"],
    note: ["备注", "说明", "note", "notes", "remark", "remarks"]
  };

  function normalizeText(value) {
    return String(value ?? "").trim().replace(/[\s_()（）/\\-]/g, "").toLowerCase();
  }

  const normalizedHeaderAliases = Object.fromEntries(
    Object.entries(headerAliases).map(([field, aliases]) => [field, aliases.map(normalizeText)])
  );

  function resolveColumns(headers) {
    const normalized = headers.map(normalizeText);
    const columns = {};
    Object.entries(normalizedHeaderAliases).forEach(([field, aliases]) => {
      columns[field] = normalized.findIndex((header) => aliases.includes(header));
    });
    return columns;
  }

  function findHeaderRow(rows) {
    const maxRows = Math.min(rows.length, 20);
    for (let index = 0; index < maxRows; index += 1) {
      const columns = resolveColumns(rows[index]);
      if (columns.maxWeight >= 0 && columns.fee >= 0) {
        return { index, columns };
      }
    }
    return null;
  }

  function parseMarket(value) {
    const raw = String(value ?? "").trim();
    return marketAliases[raw.toUpperCase()] || marketAliases[raw] || "";
  }

  function parseNumber(value, useLastNumber = false) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    const pattern = useLastNumber ? /\d+(?:\.\d+)?/g : /-?\d+(?:\.\d+)?/g;
    const matches = String(value ?? "").replace(/,/g, "").match(pattern);
    if (!matches?.length) return NaN;
    return Number(useLastNumber ? matches[matches.length - 1] : matches[0]);
  }

  function formatDate(value) {
    if (!value) return "";
    let date = value;
    if (typeof value === "number" && window.XLSX?.SSF) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) date = new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    if (!(date instanceof Date)) {
      const normalized = String(value).trim().replace(/[./]/g, "-");
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) return normalized;
      date = parsed;
    }
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatFee(value, currency) {
    const digits = currency === "VND" ? 0 : 2;
    return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) });
  }

  function escapeText(value) {
    const element = document.createElement("span");
    element.textContent = String(value ?? "");
    return element.innerHTML;
  }

  function parseWorkbook(workbook, sourceFile, configs) {
    const grouped = new Map();
    const errors = [];
    let parsedRows = 0;
    let ignoredRows = 0;
    let recognizedSheets = 0;

    workbook.SheetNames.forEach((sheetName) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      const header = findHeaderRow(rows);
      if (!header) return;
      recognizedSheets += 1;
      const { columns } = header;
      const inferredMarket = parseMarket(sheetName) || parseMarket(rows[0]?.[0]);
      for (let rowIndex = header.index + 1; rowIndex < rows.length; rowIndex += 1) {
        const sourceRow = rows[rowIndex];
        if (sourceRow.every((value) => String(value ?? "").trim() === "")) continue;
        const market = columns.market >= 0 ? parseMarket(sourceRow[columns.market]) : inferredMarket;
        const maxWeight = parseNumber(sourceRow[columns.maxWeight], true);
        const fee = parseNumber(sourceRow[columns.fee]);
        const rowLabel = `${sheetName} 第 ${rowIndex + 1} 行`;
        if (!market) {
          errors.push(`${rowLabel}：无法从工作表名称或市场列识别市场。`);
          continue;
        }
        if (!Number.isFinite(maxWeight) || maxWeight <= 0) {
          errors.push(`${rowLabel}：重量必须大于 0。`);
          continue;
        }
        if (!Number.isFinite(fee) || fee < 0) {
          errors.push(`${rowLabel}：物流费必须是非负数。`);
          continue;
        }
        const maxConfiguredWeight = configs[market]?.maxWeight || markets[market].limit;
        if (maxWeight > maxConfiguredWeight) {
          ignoredRows += 1;
          continue;
        }
        const expectedCurrency = markets[market].currency;
        const currency = columns.currency >= 0 && sourceRow[columns.currency]
          ? String(sourceRow[columns.currency]).trim().toUpperCase()
          : expectedCurrency;
        if (currency !== expectedCurrency) {
          errors.push(`${rowLabel}：${market} 的币种应为 ${expectedCurrency}。`);
          continue;
        }
        if (!grouped.has(market)) grouped.set(market, []);
        grouped.get(market).push({
          maxWeight: Math.ceil(maxWeight),
          fee,
          effectiveDate: columns.effectiveDate >= 0 ? formatDate(sourceRow[columns.effectiveDate]) : "",
          note: columns.note >= 0 ? String(sourceRow[columns.note] ?? "").trim() : ""
        });
        parsedRows += 1;
      }
    });

    if (recognizedSheets === 0) {
      throw new Error("未找到可识别的工作表。请使用下载的模板，并保留重量（克）和全境(当地货币)两列。 ");
    }
    if (errors.length) {
      const visibleErrors = errors.slice(0, 8).join("\n");
      const remaining = errors.length > 8 ? `\n另有 ${errors.length - 8} 条错误。` : "";
      throw new Error(`${visibleErrors}${remaining}`);
    }
    if (parsedRows === 0) {
      throw new Error(ignoredRows > 0 ? "所有价格行都超过当前重量上限，请先提高计费范围。" : "没有读取到有效的物流价格数据。 ");
    }

    const importedAt = new Date().toISOString();
    const tables = Array.from(grouped.entries()).map(([market, rows]) => {
      rows.sort((left, right) => left.maxWeight - right.maxWeight);
      const duplicate = rows.find((row, index) => index > 0 && row.maxWeight === rows[index - 1].maxWeight);
      if (duplicate) throw new Error(`${market} 存在重复的重量 ${duplicate.maxWeight}g。`);
      const dates = [...new Set(rows.map((row) => row.effectiveDate).filter(Boolean))];
      return {
        market,
        currency: markets[market].currency,
        effectiveDate: dates.length === 1 ? dates[0] : dates.length > 1 ? "多个日期" : "",
        sourceFile,
        importedAt,
        rows
      };
    });
    return { tables, stats: { parsedRows, ignoredRows, recognizedSheets } };
  }

  function renderMarketOptions() {
    const options = Object.entries(markets)
      .map(([code, market]) => `<option value="${code}">${market.name}（${code}）</option>`)
      .join("");
    $("marketFilter").innerHTML = options;
    $("settingsMarket").innerHTML = options;
    $("marketFilter").value = state.selectedMarket;
    $("settingsMarket").value = state.selectedMarket;
  }

  function renderStatuses() {
    $("marketStatusGrid").innerHTML = Object.entries(markets).map(([code, market]) => {
      const table = state.tables.get(code);
      const config = state.configs[code];
      const activeRows = table?.rows.filter((row) => row.maxWeight <= config.maxWeight) || [];
      const date = table ? (table.effectiveDate || "未填写日期") : store.defaultEffectiveDate;
      const volumeLimit = config.maxVolume > 0 ? `${config.maxVolume.toLocaleString("zh-CN")}cm³` : "不限体积";
      const detail = table ? `${activeRows.length.toLocaleString("zh-CN")} 个重量档 · ${date}` : `内置公式 · ${date}`;
      return `<div class="market-status-item"><strong>${market.name}</strong><span>${escapeText(detail)}</span><span>上限 ${config.maxWeight / 1000}kg · ${volumeLimit}</span><span class="source-pill${table ? " imported" : ""}">${table ? "Excel 导入" : "内置价表"}</span></div>`;
    }).join("");
  }

  function renderSettings(message = "", success = false) {
    const config = state.configs[state.selectedMarket];
    $("settingsMarket").value = state.selectedMarket;
    $("maxWeightSetting").value = config.maxWeight / 1000;
    $("maxVolumeSetting").value = config.maxVolume;
    $("volumetricDivisorSetting").value = config.volumetricDivisor;
    $("limitNote").textContent = message || `体积重(kg) = 体积(cm³) ÷ ${config.volumetricDivisor.toLocaleString("zh-CN")}；重新导入时会忽略超过 ${config.maxWeight / 1000}kg 的价格行。`;
    $("limitNote").classList.toggle("is-success", success);
  }

  function saveSettings() {
    const maxWeightKg = Number($("maxWeightSetting").value);
    const maxWeight = Math.round(maxWeightKg * 1000);
    const maxVolume = Number($("maxVolumeSetting").value);
    const volumetricDivisor = Number($("volumetricDivisorSetting").value);
    if (!Number.isFinite(maxWeightKg) || maxWeightKg <= 0 || !Number.isFinite(maxVolume) || maxVolume < 0 || !Number.isFinite(volumetricDivisor) || volumetricDivisor <= 0) {
      renderSettings("请输入有效的重量上限、体积上限和体积重系数。", false);
      return;
    }
    if (maxWeight % 10 !== 0) {
      renderSettings("最大计费重必须按 10g 递增。", false);
      return;
    }
    try {
      store.saveConfig(state.selectedMarket, { maxWeight, maxVolume, volumetricDivisor });
    } catch {
      renderSettings("设置保存失败，请检查浏览器是否允许本地存储。", false);
      return;
    }
    state.configs = store.getConfigs();
    state.page = 1;
    renderStatuses();
    renderSettings("设置已保存；下次导入会按新上限过滤价格行。", true);
    renderTable();
    queryPrice();
  }

  function getSelectedData() {
    const market = state.selectedMarket;
    const marketMeta = markets[market];
    const table = state.tables.get(market);
    const config = state.configs[market];
    const activeRows = table ? table.rows.filter((row) => row.maxWeight <= config.maxWeight) : null;
    const defaultLimit = Math.min(marketMeta.limit, config.maxWeight);
    const totalRows = activeRows ? activeRows.length : Math.floor(defaultLimit / 10);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    state.page = Math.min(state.page, totalPages);
    const startIndex = (state.page - 1) * pageSize;
    const endIndex = Math.min(totalRows, startIndex + pageSize);
    const rows = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      if (table) {
        rows.push(activeRows[index]);
      } else {
        const maxWeight = (index + 1) * 10;
        const quote = store.getQuote(market, maxWeight, state.tables);
        rows.push({ maxWeight, fee: quote.fee, effectiveDate: store.defaultEffectiveDate, note: "" });
      }
    }
    return { market, marketMeta, table, activeRows, config, totalRows, totalPages, startIndex, rows };
  }

  function renderTable() {
    const data = getSelectedData();
    $("tableTitle").textContent = `${data.marketMeta.name}物流价表`;
    $("tableSource").textContent = data.table
      ? `${data.table.sourceFile} · 导入于 ${new Date(data.table.importedAt).toLocaleString("zh-CN")}`
      : `内置参考价卡 · ${store.defaultEffectiveDate}`;
    $("rowCount").textContent = `共 ${data.totalRows.toLocaleString("zh-CN")} 个重量档`;
    $("restoreDefaultButton").disabled = !data.table;
    $("priceRows").innerHTML = data.rows.map((row, localIndex) => {
      const globalIndex = data.startIndex + localIndex;
      const previousMax = data.table
        ? (globalIndex === 0 ? 0 : data.activeRows[globalIndex - 1].maxWeight)
        : globalIndex * 10;
      return `<tr><td>&gt; ${previousMax.toLocaleString("zh-CN")} – ${row.maxWeight.toLocaleString("zh-CN")}g</td><td>${row.maxWeight.toLocaleString("zh-CN")}</td><td>${formatFee(row.fee, data.marketMeta.currency)}</td><td>${data.marketMeta.currency}</td><td>${escapeText(row.effectiveDate || data.table?.effectiveDate || "-")}</td><td>${escapeText(row.note || "-")}</td></tr>`;
    }).join("") || '<tr class="empty-row"><td colspan="6">暂无价表数据</td></tr>';
    $("pageState").textContent = `第 ${state.page} / ${data.totalPages} 页`;
    $("previousPage").disabled = state.page <= 1;
    $("nextPage").disabled = state.page >= data.totalPages;
  }

  function queryPrice() {
    const weight = Number($("weightQuery").value);
    const quote = store.getQuote(state.selectedMarket, weight, state.tables);
    if (!quote) {
      const data = getSelectedData();
      const priceLimit = data.table ? data.activeRows.at(-1)?.maxWeight : Math.min(data.marketMeta.limit, data.config.maxWeight);
      $("quoteResult").textContent = priceLimit ? `未找到该重量档，当前价表最大支持 ${priceLimit}g` : "当前范围内没有价格数据";
      return;
    }
    $("quoteResult").textContent = `${quote.roundedWeight}g → ${formatFee(quote.fee, markets[state.selectedMarket].currency)} ${markets[state.selectedMarket].currency}`;
  }

  function resetImportPreview() {
    state.pendingTables = [];
    $("importPreview").hidden = true;
    $("importMessage").hidden = true;
    $("excelFile").value = "";
    $("selectedFileName").textContent = "尚未选择文件";
  }

  async function handleFile(file) {
    resetImportPreview();
    $("selectedFileName").textContent = file.name;
    try {
      if (!window.XLSX) throw new Error("Excel 解析组件未加载，请刷新页面后重试。 ");
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true });
      const parsed = parseWorkbook(workbook, file.name, state.configs);
      state.pendingTables = parsed.tables;
      const totalRows = state.pendingTables.reduce((sum, table) => sum + table.rows.length, 0);
      const ignored = parsed.stats.ignoredRows > 0 ? `，按重量上限忽略 ${parsed.stats.ignoredRows.toLocaleString("zh-CN")} 行` : "";
      $("previewSummary").textContent = `已读取 ${state.pendingTables.length} 个市场、${totalRows.toLocaleString("zh-CN")} 个重量档${ignored}。确认后将替换这些市场的当前导入价表。`;
      $("previewRows").innerHTML = state.pendingTables.flatMap((table) => table.rows.slice(0, 3).map((row) =>
        `<tr><td>${markets[table.market].name}</td><td>${row.maxWeight.toLocaleString("zh-CN")}g</td><td>${formatFee(row.fee, table.currency)}</td><td>${table.currency}</td><td>${escapeText(row.effectiveDate || "-")}</td></tr>`
      )).join("");
      $("importPreview").hidden = false;
    } catch (error) {
      $("importMessage").textContent = error.message || "Excel 文件读取失败。";
      $("importMessage").hidden = false;
    }
  }

  async function confirmImport() {
    if (!state.pendingTables.length) return;
    $("confirmImportButton").disabled = true;
    try {
      await store.saveTables(state.pendingTables);
      $("storageState").textContent = "价表已更新";
      resetImportPreview();
      await reloadTables();
    } catch (error) {
      $("importMessage").textContent = `保存失败：${error.message || "浏览器存储不可用"}`;
      $("importMessage").hidden = false;
    } finally {
      $("confirmImportButton").disabled = false;
    }
  }

  async function removeImportedTable() {
    const marketName = markets[state.selectedMarket].name;
    if (!window.confirm(`移除${marketName}的导入价表并恢复内置参考价卡吗？`)) return;
    try {
      await store.deleteTable(state.selectedMarket);
      $("storageState").textContent = "已恢复内置价表";
      await reloadTables();
    } catch {
      $("storageState").textContent = "恢复失败";
    }
  }

  async function reloadTables() {
    state.tables = store.normalizeTables(await store.getAllTables());
    state.page = 1;
    renderStatuses();
    renderTable();
    queryPrice();
  }

  function selectMarket(market) {
    state.selectedMarket = market;
    state.page = 1;
    $("settingsMarket").value = market;
    $("marketFilter").value = market;
    renderSettings();
    renderTable();
    queryPrice();
  }

  function bindEvents() {
    $("chooseFileButton").addEventListener("click", () => $("excelFile").click());
    $("excelFile").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) handleFile(file);
    });
    $("cancelImportButton").addEventListener("click", resetImportPreview);
    $("confirmImportButton").addEventListener("click", confirmImport);
    $("saveLimitsButton").addEventListener("click", saveSettings);
    $("settingsMarket").addEventListener("change", (event) => {
      selectMarket(event.target.value);
    });
    $("marketFilter").addEventListener("change", (event) => {
      selectMarket(event.target.value);
    });
    $("queryPriceButton").addEventListener("click", queryPrice);
    $("weightQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") queryPrice();
    });
    $("previousPage").addEventListener("click", () => { state.page -= 1; renderTable(); });
    $("nextPage").addEventListener("click", () => { state.page += 1; renderTable(); });
    $("restoreDefaultButton").addEventListener("click", removeImportedTable);
  }

  async function initialize() {
    renderMarketOptions();
    bindEvents();
    try {
      state.tables = store.normalizeTables(await store.getAllTables());
      $("storageState").textContent = "本机价表";
    } catch {
      $("storageState").textContent = "使用内置价表";
    }
    renderStatuses();
    renderSettings();
    renderTable();
    queryPrice();
  }

  initialize();
}());
