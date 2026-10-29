<script lang="ts">
  import { onMount } from "svelte";
  import {
    initBinanceClient,
    testConnection,
    fetchAndAnalyze,
    fetchAndAnalyzeWithParams,
    getBalance,
    executeMarketOrder,
    saveAnalyzedCsv,
    setExchangeConfig,
    simulateStrategy,
    errMsg,
  } from "./lib/wails";
  import { exchange, environment, symbolsFor, exchangeLabel } from "./lib/exchange";
  import {
    tableForInterval,
    type AnalyzedRow,
  } from "./db/analyzed";
  import { getApiKey, setApiKey } from "./db/api_keys";
  import {
    getAllAdjustments,
    loadParamsForTable,
    type IndicatorAdjustment,
  } from "./db/indicator_adjustments";
  import {
    getScheduleTasks,
    upsertScheduleTask,
    deleteScheduleTask,
    type ScheduleTask,
  } from "./db/schedule";
  import Sidebar from "./components/Sidebar.svelte";
  import CandleChart from "./components/CandleChart.svelte";
  import DataTable from "./components/DataTable.svelte";
  import AIDecidedTrade from "./components/AIDecidedTrade.svelte";
  import BalanceView from "./components/BalanceView.svelte";
  import OrderablesView from "./components/OrderablesView.svelte";
  import TradesView from "./components/TradesView.svelte";
  import StatisticsView from "./components/StatisticsView.svelte";
  import CsvFiles from "./components/CsvFiles.svelte";
  import DbDebug from "./components/DbDebug.svelte";
  import Scheduler from "./components/Scheduler.svelte";
  import OrderTestView from "./components/OrderTestView.svelte";
  import IndicatorAdjustments from "./components/IndicatorAdjustments.svelte";
  import IndicatorSettingsBar from "./components/IndicatorSettingsBar.svelte";
  import IndicatorSettingsPage from "./components/IndicatorSettingsPage.svelte";
  import type { models } from "../wailsjs/go/models";

  function signalClass(v: string): string {
    if (!v) return "hold";
    const s = v.toLowerCase();
    if (s === "buy" || s === "long") return "buy";
    if (s === "sell" || s === "short") return "sell";
    return "hold";
  }

  let activeView = "chart";

  let apiKey = "";
  let secretKey = "";
  let apiConnected = false;
  let connecting = false;
  let connError = "";
  let checkedSavedKeys = false;
  let pepperDir = "";

  onMount(async () => {
    try {
      const savedEx = await getApiKey("exchange");
      const savedEnv = await getApiKey("trading_environment");
      const savedDir = await getApiKey("pepperstone_dir");
      if (savedEx === "pepperstone" || savedEx === "binance") {
        exchange.set(savedEx);
      }
      if (savedEnv === "live" || savedEnv === "demo") {
        environment.set(savedEnv);
      } else if ($exchange === "binance") {
        environment.set("live");
      }
      if (savedDir) pepperDir = savedDir;
      await connectApi();
    } catch (e) {
      console.log("No saved settings");
      await connectApi();
    } finally {
      checkedSavedKeys = true;
    }
  });

  async function persistExchangeSettings() {
    await setApiKey("exchange", $exchange);
    await setApiKey("trading_environment", $exchange === "binance" ? "live" : $environment);
    await setApiKey("pepperstone_dir", pepperDir);
    try {
      await setExchangeConfig($exchange, $environment, pepperDir);
    } catch (e: any) {
      connError = errMsg(e, "Failed to apply exchange settings");
    }
  }

  async function connectApi() {
    connecting = true;
    connError = "";
    apiConnected = false;
    try {
      await persistExchangeSettings();
      if ($exchange === "binance") {
        if (!apiKey || !secretKey) {
          const savedKey = await getApiKey("binance_api_key");
          const savedSecret = await getApiKey("binance_secret_key");
          if (savedKey && savedSecret) { apiKey = savedKey; secretKey = savedSecret; }
        }
        if (!apiKey || !secretKey) throw new Error("Binance API key and secret required");
        await initBinanceClient(apiKey, secretKey);
        await setApiKey("binance_api_key", apiKey);
        await setApiKey("binance_secret_key", secretKey);
      }
      await testConnection();
      apiConnected = true;
    } catch (e: any) {
      connError = errMsg(e, "Connection failed");
    } finally {
      connecting = false;
    }
  }

  async function onExchangeChange() {
    if ($exchange === "binance") environment.set("live");
    apiConnected = false;
    await persistExchangeSettings();
  }

  // Chart view state
  let symbol = "ETHUSDT";
  let interval = "1h";
  let lookback = 500;
  let loading = false;
  let error = "";
  let chartData: models.AnalyzedRow[] = [];
  let dbRows: AnalyzedRow[] = [];
  let dbCount = 0;
  let page = 1;
  let pageSize = 4;
  let showBuyModal = false;
  let buyQuantity = 0;
  let usdtBalance = 0;
  let signalField = "trade";
  let showSignals = false;
  let showIndicators = {
    macd: true,
    rsi: true,
    stochastic: true,
    sma: true,
    ema: true,
    bb: true,
    hma: true,
  };
  const signalOptions = [
    "macd_trade",
    "rsi_trade",
    "stochastic_trade",
    "ema_trade",
    "sma_trade",
    "ma_trade",
    "hma_trade",
    "trade",
  ];

  let chartParams: Record<string, number> = {};
  let adjustments: IndicatorAdjustment[] = [];
  let selectedAdjustId = 0;

  $: {
    const opts = symbolsFor($exchange);
    if (opts.length && !opts.includes(symbol)) symbol = opts[0];
    if (opts.length && !opts.includes(schedCurrency)) schedCurrency = opts[0];
  }

  async function loadIndicatorSettings() {
    try {
      chartParams = await loadParamsForTable(tableForInterval(interval));
    } catch (_) {}
  }

  onMount(async () => {
    try {
      adjustments = await getAllAdjustments();
      await loadIndicatorSettings();
      await loadSchedTasks();
    } catch (_) {}
  });

  $: totalPages = Math.max(1, Math.ceil(dbCount / pageSize));
  $: pageRows = dbRows.slice((page - 1) * pageSize, page * pageSize);
  $: if (interval) loadIndicatorSettings();

  async function loadChart() {
    loading = true;
    error = "";
    page = 1;
    simPoints = [];
    simTrades = [];
    simBalance = 0;
    console.log("loadChart: start", {
      symbol,
      interval,
      lookback,
      selectedAdjustId,
      chartParams,
    });
    let r: any;
    try {
      const adj = adjustments.find((a) => a.id === selectedAdjustId);
      const merged = { ...chartParams };
      if (adj) {
        Object.assign(merged, JSON.parse(adj.params || "{}"));
      }
      r = await fetchAndAnalyzeWithParams(symbol, interval, lookback, merged);
      console.log("loadChart: fetch returned", {
        candles: r.candles?.length,
        analyzed: r.analyzed?.length,
        table: r.table_name,
      });
      chartData = r.analyzed;
      simPoints = computeSlopeMarkers(chartData || []);
      // show chart + table immediately, persist in background
      dbRows = r.analyzed.map((a: models.AnalyzedRow) => ({
        time: new Date((a.time as number) * 1000).toISOString(),
        open: a.open,
        high: a.high,
        low: a.low,
        close: a.close,
        volume: a.volume,
        currency: a.currency,
        macd: a.macd,
        macd_signal: a.macd_signal,
        macd_hist: a.macd_hist,
        rsi: a.rsi,
        rsi_short: a.rsi_short,
        rsi_middle: a.rsi_middle,
        rsi_long: a.rsi_long,
        ema: a.ema,
        ema_short: a.ema_short,
        ema_middle: a.ema_middle,
        ema_long: a.ema_long,
        ma_short: a.ma_short,
        ma_middle: a.ma_middle,
        ma_long: a.ma_long,
        sma_short: a.sma_short,
        sma_long: a.sma_long,
        hma: a.hma,
        stochastic_k: a.stochastic_K,
        stochastic_d: a.stochastic_D,
        bb_middle: a.bb_middle,
        bb_upper: a.bb_upper,
        bb_lower: a.bb_lower,
        bb_upper_75: a.bb_upper_75,
        bb_lower_25: a.bb_lower_25,
        bb_sell_crossover: a.bb_sell_crossover,
        bb_buy_crossover: a.bb_buy_crossover,
        bb_trend: a.bb_trend,
        bb_signal: a.bb_signal,
        bb_trade: a.bb_trade,
        near_bb_support: 0,
        near_bb_resistance: 0,
        macd_trade: a.macd_trade,
        rsi_trade: a.rsi_trade,
        stochastic_trade: a.stochastic_trade,
        channel_trade: a.channel_trade,
        ema_trade: a.ema_trade,
        sma_trade: a.sma_trade,
        ma_trade: a.ma_trade,
        hma_trade: a.hma_trade,
        trade: a.trade,
        last4candle_trend: a.last4candle_trend,
        bullish_crossover: a.bullish_crossover,
        bearish_crossover: a.bearish_crossover,
        is_Bottom: a.is_Bottom,
        is_Peak: a.is_Peak,
        up_trend_before_Peak: a.up_trend_before_Peak,
        down_trend_before_Bottom: a.down_trend_before_Bottom,
        buy_on_Bottom: a.buy_on_Bottom,
        sell_on_Peak: a.sell_on_Peak,
        sma_short_uptrend: a.sma_short_uptrend,
        sma_short_downtrend: a.sma_short_downtrend,
        sma_long_uptrend: a.sma_long_uptrend,
        sma_long_downtrend: a.sma_long_downtrend,
      }));
      dbCount = dbRows.length;

      // background: save the analyzed window to CSV
      try {
        await saveAnalyzedCsv(symbol, interval, r.analyzed);
        console.log("loadChart: csv saved");
      } catch (csvErr) {
        console.warn("loadChart: csv save failed", csvErr);
      }

      if (apiConnected) {
        usdtBalance = await getBalance("USDT");
      }
    } catch (e: any) {
      console.error("loadChart: error", e);
      error = e.message || "Fetch failed";
    } finally {
      loading = false;
    }
  }

  function onParamChange(updated: Record<string, number>) {
    chartParams = updated;
    loadChart();
  }

  async function buy() {
    try {
      await executeMarketOrder(symbol, "BUY", buyQuantity);
      showBuyModal = false;
      await loadChart();
    } catch (e: any) {
      error = e.message;
    }
  }

  // Schedule analysis state
  let showSchedAnalysis = false;
  let schedTasks: ScheduleTask[] = [];
  let schedEditId: number | null = null;
  let schedName = "";
  let schedCurrency = "ETHUSDT";
  let schedTable = "analyzed1hs";
  const schedSignalCols = [
    "macd_trade",
    "rsi_trade",
    "stochastic_trade",
    "ema_trade",
    "sma_trade",
    "ma_trade",
    "hma_trade",
  ];
  const schedSignalVals = ["", "buy", "sell", "hold"];
  let schedBuySignals: Record<string, string> = {};
  let schedSellSignals: Record<string, string> = {};
  schedSignalCols.forEach((c) => {
    schedBuySignals[c] = "";
    schedSellSignals[c] = "";
  });
  let schedBuyRsi = "";
  let schedSellRsi = "";
  const maCompFields: Record<string, string> = {
    ema: "EMA",
    ema_short: "EMA short",
    ema_middle: "EMA middle",
    ema_long: "EMA long",
    ma_short: "MA short",
    ma_middle: "MA middle",
    ma_long: "MA long",
    sma_short: "SMA short",
    sma_long: "SMA long",
    hma: "HMA",
  };
  let schedBuyMaCompA = "";
  let schedBuyMaCompB = "";
  let schedSellMaCompA = "";
  let schedSellMaCompB = "";
  const maPriceFields: Record<string, string> = {
    ema_trade: "ema_middle",
    sma_trade: "sma_short",
    ma_trade: "ma_middle",
    hma_trade: "hma",
  };
  let schedBuySlopes: Record<string, boolean> = {};
  let schedSellSlopes: Record<string, boolean> = {};
  schedSignalCols.forEach((c) => {
    schedBuySlopes[c] = false;
    schedSellSlopes[c] = false;
  });

  function resetSchedForm() {
    schedEditId = null;
    schedName = "";
    schedCurrency = "ETHUSDT";
    schedTable = "analyzed1hs";
    schedSignalCols.forEach((c) => {
      schedBuySignals[c] = "";
      schedSellSignals[c] = "";
      schedBuySlopes[c] = false;
      schedSellSlopes[c] = false;
    });
    schedBuyRsi = "";
    schedSellRsi = "";
    schedBuyMaCompA = "";
    schedBuyMaCompB = "";
    schedSellMaCompA = "";
    schedSellMaCompB = "";
  }

  async function loadSchedTasks() {
    try {
      schedTasks = await getScheduleTasks();
    } catch (_) {}
  }

  function editSchedTask(t: ScheduleTask) {
    schedEditId = t.id;
    schedName = t.task_name;
    schedCurrency = t.currency;
    schedTable = t.analyzed_table_name;
    try {
      const b = JSON.parse(t.buy_criteria || "{}");
      const s = JSON.parse(t.sell_criteria || "{}");
      schedSignalCols.forEach((c) => {
        schedBuySignals[c] = b[c] || "";
        schedSellSignals[c] = s[c] || "";
        const sk = c.replace("_trade", "_slope");
        schedBuySlopes[c] = b[sk] === "1";
        schedSellSlopes[c] = s[sk] === "1";
      });
      schedBuyRsi = b["rsi_level"] != null ? String(b["rsi_level"]) : "";
      schedSellRsi = s["rsi_level"] != null ? String(s["rsi_level"]) : "";
      schedBuyMaCompA = b["ma_comp_a"] || "";
      schedBuyMaCompB = b["ma_comp_b"] || "";
      schedSellMaCompA = s["ma_comp_a"] || "";
      schedSellMaCompB = s["ma_comp_b"] || "";
    } catch {}
    showSchedAnalysis = true;
  }

  async function saveSchedTask() {
    const buyCrit: Record<string, any> = {};
    const sellCrit: Record<string, any> = {};
    schedSignalCols.forEach((c) => {
      buyCrit[c] = schedBuySignals[c];
      sellCrit[c] = schedSellSignals[c];
      if (schedBuySlopes[c]) buyCrit[c.replace("_trade", "_slope")] = "1";
      if (schedSellSlopes[c]) sellCrit[c.replace("_trade", "_slope")] = "1";
    });
    if (schedBuyRsi) buyCrit["rsi_level"] = parseFloat(schedBuyRsi);
    if (schedSellRsi) sellCrit["rsi_level"] = parseFloat(schedSellRsi);
    if (schedBuyMaCompA && schedBuyMaCompB) {
      buyCrit["ma_comp_a"] = schedBuyMaCompA;
      buyCrit["ma_comp_b"] = schedBuyMaCompB;
    }
    if (schedSellMaCompA && schedSellMaCompB) {
      sellCrit["ma_comp_a"] = schedSellMaCompA;
      sellCrit["ma_comp_b"] = schedSellMaCompB;
    }
    await upsertScheduleTask(schedEditId, {
      task_name: schedName || "Untitled",
      interval: 5,
      analyzed_table_name: schedTable,
      buy_criteria: JSON.stringify(buyCrit),
      sell_criteria: JSON.stringify(sellCrit),
      currency: schedCurrency,
      trade_balance_percentage: 10,
      balance_type: "percentage",
      sell_if_greater_than: 0.5,
      max_open_trades: 1,
    });
    resetSchedForm();
    await loadSchedTasks();
  }

  async function analyzeSchedTask(t: ScheduleTask) {
    loading = true;
    error = "";
    simPoints = [];
    simTrades = [];
    simBalance = 0;
    try {
      const merged = await loadParamsForTable(t.analyzed_table_name);
      const tblInterval =
        t.analyzed_table_name === "analyzed_months"
          ? "1M"
          : t.analyzed_table_name.replace("analyzed", "").replace(/s$/, "");
      const r = await fetchAndAnalyzeWithParams(
        t.currency,
        tblInterval,
        lookback,
        merged,
      );
      if (!r.analyzed?.length) {
        error = "No data returned";
        loading = false;
        return;
      }
      chartData = r.analyzed;
      dbRows = r.analyzed.map((a: models.AnalyzedRow) => ({
        time: new Date((a.time as number) * 1000).toISOString(),
        open: a.open,
        high: a.high,
        low: a.low,
        close: a.close,
        volume: a.volume,
        currency: a.currency,
        macd: a.macd,
        macd_signal: a.macd_signal,
        macd_hist: a.macd_hist,
        rsi: a.rsi,
        rsi_short: a.rsi_short,
        rsi_middle: a.rsi_middle,
        rsi_long: a.rsi_long,
        ema: a.ema,
        ema_short: a.ema_short,
        ema_middle: a.ema_middle,
        ema_long: a.ema_long,
        ma_short: a.ma_short,
        ma_middle: a.ma_middle,
        ma_long: a.ma_long,
        sma_short: a.sma_short,
        sma_long: a.sma_long,
        hma: a.hma,
        stochastic_k: a.stochastic_K,
        stochastic_d: a.stochastic_D,
        bb_middle: a.bb_middle,
        bb_upper: a.bb_upper,
        bb_lower: a.bb_lower,
        bb_upper_75: a.bb_upper_75,
        bb_lower_25: a.bb_lower_25,
        bb_sell_crossover: a.bb_sell_crossover,
        bb_buy_crossover: a.bb_buy_crossover,
        bb_trend: a.bb_trend,
        bb_signal: a.bb_signal,
        bb_trade: a.bb_trade,
        near_bb_support: 0,
        near_bb_resistance: 0,
        macd_trade: a.macd_trade,
        rsi_trade: a.rsi_trade,
        stochastic_trade: a.stochastic_trade,
        channel_trade: a.channel_trade,
        ema_trade: a.ema_trade,
        sma_trade: a.sma_trade,
        ma_trade: a.ma_trade,
        hma_trade: a.hma_trade,
        trade: a.trade,
        last4candle_trend: a.last4candle_trend,
        bullish_crossover: a.bullish_crossover,
        bearish_crossover: a.bearish_crossover,
        is_Bottom: a.is_Bottom,
        is_Peak: a.is_Peak,
        up_trend_before_Peak: a.up_trend_before_Peak,
        down_trend_before_Bottom: a.down_trend_before_Bottom,
        buy_on_Bottom: a.buy_on_Bottom,
        sell_on_Peak: a.sell_on_Peak,
        sma_short_uptrend: a.sma_short_uptrend,
        sma_short_downtrend: a.sma_short_downtrend,
        sma_long_uptrend: a.sma_long_uptrend,
        sma_long_downtrend: a.sma_long_downtrend,
      }));
      dbCount = dbRows.length;
      page = 1;
      const buyCrit = JSON.parse(t.buy_criteria || "{}");
      const sellCrit = JSON.parse(t.sell_criteria || "{}");
      const sim = await simulateStrategy(r.analyzed, buyCrit, sellCrit);
      simPoints = [...(sim.points as any), ...computeSlopeMarkers(r.analyzed)];
      simTrades = sim.trades as any;
      simBalance = sim.balance;
    } catch (e: any) {
      error = e.message || "Analyze failed";
    }
    loading = false;
  }

  // Trade simulation state
  let simPoints: { x: string; y: number; type: "buy" | "sell" | "rising" | "falling" }[] = [];
  let simTrades: {
    buyPrice: number;
    sellPrice: number;
    profitPct: number;
    profitUsdt: number;
  }[] = [];
  let simBalance = 0;

  function computeSlopeMarkers(
    rows: any[],
  ): { x: string; y: number; type: "rising" | "falling" }[] {
    const markers: { x: string; y: number; type: "rising" | "falling" }[] = [];
    const fields = Object.values(maPriceFields);
    for (let i = 5; i < rows.length; i++) {
      const row = rows[i];
      const p1 = rows[i - 1], p2 = rows[i - 2], p3 = rows[i - 3], p4 = rows[i - 4], p5 = rows[i - 5];
      const date = new Date((row.time as number) * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      let hasRise = false;
      let hasFall = false;
      for (const f of fields) {
        const v = [p5[f], p4[f], p3[f], p2[f], p1[f], row[f]];
        if (v.every((x) => x !== undefined)) {
          const s1 = v[5] - v[4], s2 = v[4] - v[3];
          const s3 = v[3] - v[2], s4 = v[2] - v[1], s5 = v[1] - v[0];
          if (s1 > 0 && s2 > 0 && s3 < 0 && s4 < 0 && s5 < 0) hasRise = true;
          if (s1 < 0 && s2 < 0 && s3 > 0 && s4 > 0 && s5 > 0) hasFall = true;
        }
      }
      if (hasRise) markers.push({ x: date, y: row.low, type: "rising" });
      if (hasFall) markers.push({ x: date, y: row.high, type: "falling" });
    }
    return markers;
  }

  let selectedCandleIdx = -1;
  $: selectedCandle =
    selectedCandleIdx >= 0 && selectedCandleIdx < chartData.length
      ? chartData[selectedCandleIdx]
      : chartData.length > 0
        ? chartData[chartData.length - 1]
        : null;

  function selVal(e: Event): string { return (e.target as HTMLSelectElement).value; }
  function inpVal(e: Event): string { return (e.target as HTMLInputElement).value; }
  function chkVal(e: Event): boolean { return (e.target as HTMLInputElement).checked; }

  const intervals = [
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "4h",
    "8h",
    "1d",
    "3d",
    "1w",
    "1M",
  ];
</script>

<div class="layout">
  <Sidebar bind:active={activeView} {apiConnected} />

  <main class="content">
    {#if activeView === "chart"}
      <header class="toolbar">
        <select bind:value={symbol}>
          {#each symbolsFor($exchange) as s}
            <option value={s}>{s}</option>
          {/each}
        </select>
        <select bind:value={interval}>
          {#each intervals as iv}
            <option value={iv}>{iv}</option>
          {/each}
        </select>
        <input
          type="number"
          bind:value={lookback}
          min="100"
          max="1000"
          step="100"
        />
        <button on:click={loadChart} disabled={loading}
          >{loading ? "Loading..." : "Fetch"}</button
        >
        <select bind:value={signalField}>
          {#each signalOptions as s}
            <option value={s}>{s}</option>
          {/each}
        </select>
        <button
          on:click={() => (showSignals = !showSignals)}
          class:active={showSignals}>Signals</button
        >
        <label class="ind-chk"
          ><input
            type="checkbox"
            bind:checked={showIndicators.macd}
          />MACD</label
        >
        <label class="ind-chk"
          ><input type="checkbox" bind:checked={showIndicators.rsi} />RSI</label
        >
        <label class="ind-chk"
          ><input
            type="checkbox"
            bind:checked={showIndicators.stochastic}
          />Stoch</label
        >
        <label class="ind-chk"
          ><input type="checkbox" bind:checked={showIndicators.sma} />SMA</label
        >
        <label class="ind-chk"
          ><input type="checkbox" bind:checked={showIndicators.ema} />EMA</label
        >
        <label class="ind-chk"
          ><input type="checkbox" bind:checked={showIndicators.hma} />HMA</label
        >
        <label class="ind-chk"
          ><input type="checkbox" bind:checked={showIndicators.bb} />BB</label
        >
        {#if adjustments.length > 0}
          <select
            value={selectedAdjustId}
            on:change={(e) => (selectedAdjustId = parseInt(selVal(e)) || 0)}
          >
            <option value={0}>Default params</option>
            {#each adjustments as a}
              <option value={a.id}>{a.name}</option>
            {/each}
          </select>
        {/if}
        {#if apiConnected}
          <button on:click={() => (showBuyModal = true)}>Buy</button>
          <span class="balance">USDT: {usdtBalance.toFixed(2)}</span>
        {/if}
      </header>

      {#if error}<div class="error-banner">{error}</div>{/if}

      <IndicatorSettingsBar
        {interval}
        params={chartParams}
        onChange={onParamChange}
      />

      <div class="sched-analysis">
        <button
          class="toggle"
          on:click={() => (showSchedAnalysis = !showSchedAnalysis)}
        >
          <span class="arrow">{showSchedAnalysis ? "▼" : "▶"}</span>
          Schedule Analysis
        </button>

        {#if showSchedAnalysis}
          <div class="sa-form">
            <div class="sa-grid">
              <label
                >Name <input
                  value={schedName}
                  on:input={(e) => (schedName = inpVal(e))}
                /></label
              >
              <label
                >Currency
                <select
                  value={schedCurrency}
                  on:change={(e) => (schedCurrency = selVal(e))}
                >
                  {#each symbolsFor($exchange) as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <label
                >Table
                <select
                  value={schedTable}
                  on:change={(e) => (schedTable = selVal(e))}
                >
                  {#each ["analyzed1ms", "analyzed5ms", "analyzed15ms", "analyzed30ms", "analyzed1hs", "analyzed4hs", "analyzed8hs", "analyzed1ds", "analyzed3ds", "analyzed1ws", "analyzed_months"] as tbl}
                    <option value={tbl}>{tbl}</option>
                  {/each}
                </select>
              </label>
            </div>
            <div class="sa-criteria-row">
              <fieldset class="sa-crit sa-buy">
                <legend>Buy Criteria</legend>
                <div class="sa-sig-grid">
                  {#each schedSignalCols as col}
                    <div class="sig-cell">
                      <span>{col}</span>
                      <select
                        value={schedBuySignals[col]}
                        on:change={(e) => (schedBuySignals[col] = selVal(e))}
                      >
                        {#each schedSignalVals as v}
                          <option value={v}>{v || "(any)"}</option>
                        {/each}
                      </select>
                      {#if maPriceFields[col]}
                        <label class="slope-label">
                          <input
                            type="checkbox"
                            checked={schedBuySlopes[col]}
                            on:change={(e) =>
                              (schedBuySlopes[col] = chkVal(e))}
                          />
                          slope
                        </label>
                      {/if}
                    </div>
                  {/each}
                </div>
                <label class="sa-thresh"
                  >RSI &lt; <input
                    type="number"
                    value={schedBuyRsi}
                    on:input={(e) => (schedBuyRsi = inpVal(e))}
                  /></label
                >
                <div class="sa-ma-comp">
                  <span>MA comp:</span>
                  <select
                    value={schedBuyMaCompA}
                    on:change={(e) => (schedBuyMaCompA = selVal(e))}
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(maCompFields) as [key, label]}
                      <option value={key}>{label}</option>
                    {/each}
                  </select>
                  <span class="sa-ma-comp-op">&gt;</span>
                  <select
                    value={schedBuyMaCompB}
                    on:change={(e) => (schedBuyMaCompB = selVal(e))}
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(maCompFields) as [key, label]}
                      <option value={key}>{label}</option>
                    {/each}
                  </select>
                </div>
              </fieldset>
              <fieldset class="sa-crit sa-sell">
                <legend>Sell Criteria</legend>
                <div class="sa-sig-grid">
                  {#each schedSignalCols as col}
                    <div class="sig-cell">
                      <span>{col}</span>
                      <select
                        value={schedSellSignals[col]}
                        on:change={(e) => (schedSellSignals[col] = selVal(e))}
                      >
                        {#each schedSignalVals as v}
                          <option value={v}>{v || "(any)"}</option>
                        {/each}
                      </select>
                      {#if maPriceFields[col]}
                        <label class="slope-label">
                          <input
                            type="checkbox"
                            checked={schedSellSlopes[col]}
                            on:change={(e) => (schedSellSlopes[col] = chkVal(e))}
                          />
                          slope
                        </label>
                      {/if}
                    </div>
                  {/each}
                </div>
                <label class="sa-thresh"
                  >RSI &gt; <input
                    type="number"
                    value={schedSellRsi}
                    on:input={(e) => (schedSellRsi = inpVal(e))}
                  /></label
                >
                <div class="sa-ma-comp">
                  <span>MA comp:</span>
                  <select
                    value={schedSellMaCompA}
                    on:change={(e) => (schedSellMaCompA = selVal(e))}
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(maCompFields) as [key, label]}
                      <option value={key}>{label}</option>
                    {/each}
                  </select>
                  <span class="sa-ma-comp-op">&lt;</span>
                  <select
                    value={schedSellMaCompB}
                    on:change={(e) => (schedSellMaCompB = selVal(e))}
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(maCompFields) as [key, label]}
                      <option value={key}>{label}</option>
                    {/each}
                  </select>
                </div>
              </fieldset>
            </div>
            <div class="sa-actions">
              <button class="btn-save" on:click={saveSchedTask}>Save</button>
              <button on:click={resetSchedForm}>Reset</button>
            </div>
          </div>

          <div class="sa-list">
            {#if schedTasks.length === 0}
              <p class="muted">No saved tasks.</p>
            {:else}
              {#each schedTasks as t}
                <div class="sa-card">
                  <div class="sa-card-top">
                    <strong>{t.task_name || t.currency}</strong>
                    <span class="sa-tbl">{t.analyzed_table_name}</span>
                    <span class="sa-ccy">{t.currency}</span>
                  </div>
                  {#if t.buy_criteria && t.buy_criteria !== "{}"}
                    {@const b = JSON.parse(t.buy_criteria || "{}")}
                    <div class="sa-tags">
                      <span class="tag-buy">BUY</span>
                      {#each schedSignalCols as col}
                        {#if b[col]}<span class="tag">{col}={b[col]}</span>{/if}
                      {/each}
                      {#if b["rsi_level"]}<span class="tag"
                          >RSI&lt;{b["rsi_level"]}</span
                        >{/if}
                      {#if b["ma_comp_a"] && b["ma_comp_b"]}
                        <span class="tag"
                          >{b["ma_comp_a"]}&gt;{b["ma_comp_b"]}</span
                        >
                      {/if}
                    </div>
                  {/if}
                  {#if t.sell_criteria && t.sell_criteria !== "{}"}
                    {@const s = JSON.parse(t.sell_criteria || "{}")}
                    <div class="sa-tags">
                      <span class="tag-sell">SELL</span>
                      {#each schedSignalCols as col}
                        {#if s[col]}<span class="tag">{col}={s[col]}</span>{/if}
                      {/each}
                      {#if s["rsi_level"]}<span class="tag"
                          >RSI&gt;{s["rsi_level"]}</span
                        >{/if}
                      {#if s["ma_comp_a"] && s["ma_comp_b"]}
                        <span class="tag"
                          >{s["ma_comp_a"]}&lt;{s["ma_comp_b"]}</span
                        >
                      {/if}
                    </div>
                  {/if}
                  <div class="sa-card-actions">
                    <button
                      class="btn-analyze"
                      on:click={() => analyzeSchedTask(t)}
                      disabled={loading}>Analyze</button
                    >
                    <button on:click={() => editSchedTask(t)}>Edit</button>
                    <button
                      class="btn-del"
                      on:click={async () => {
                        await deleteScheduleTask(t.id);
                        await loadSchedTasks();
                      }}>Delete</button
                    >
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      {#if dbRows.length > 0}
        <div class="table-section">
          <div class="section-header">
            <h3>Analyzed Data ({dbCount} rows)</h3>
            <div class="pagination">
              <button
                disabled={page <= 1}
                on:click={() => (page = Math.max(1, page - 1))}>Prev</button
              >
              <span>{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                on:click={() => (page = Math.min(totalPages, page + 1))}
                >Next</button
              >
            </div>
          </div>
          <DataTable rows={pageRows} />
        </div>

        <div class="chart-section">
          <div class="signal-box">
            <span class="sb-title">Signal Selection</span>
            <select bind:value={selectedCandleIdx}>
              <option value={-1}>Latest candle</option>
              {#each chartData as _, i}
                <option value={i}>Candle {i + 1}</option>
              {/each}
            </select>
            {#if selectedCandle}
              <div class="signal-grid">
                <span class="sg-info"
                  >Time: {new Date(selectedCandle.time * 1000).toLocaleString()}
                  / Close: {selectedCandle.close?.toFixed(2)}</span
                >
                <span class="sg-row">
                  <span class="sg-label">MACD</span>
                  <span
                    class="signal-badge {signalClass(
                      selectedCandle.macd_trade,
                    )}">{selectedCandle.macd_trade || "hold"}</span
                  >
                </span>
                <span class="sg-row">
                  <span class="sg-label">RSI</span>
                  <span
                    class="signal-badge {signalClass(selectedCandle.rsi_trade)}"
                    >{selectedCandle.rsi_trade || "hold"}</span
                  >
                </span>
                <span class="sg-row">
                  <span class="sg-label">EMA</span>
                  <span
                    class="signal-badge {signalClass(selectedCandle.ema_trade)}"
                    >{selectedCandle.ema_trade || "hold"}</span
                  >
                </span>
                <span class="sg-row">
                  <span class="sg-label">SMA</span>
                  <span
                    class="signal-badge {signalClass(selectedCandle.sma_trade)}"
                    >{selectedCandle.sma_trade || "hold"}</span
                  >
                </span>
              </div>
            {/if}
          </div>
          <CandleChart
            rows={chartData}
            {signalField}
            {showSignals}
            {showIndicators}
            {simPoints}
          />
          {#if simTrades.length > 0}
            <div class="sim-summary">
              <div class="sim-header">Trade Simulation (start: $100)</div>
              <div class="sim-stats">
                <span class="sim-stat"
                  >Trades: <strong>{simTrades.length}</strong></span
                >
                <span class="sim-stat"
                  >Wins: <strong class="win"
                    >{simTrades.filter((t) => t.profitPct > 0).length}</strong
                  ></span
                >
                <span class="sim-stat"
                  >Losses: <strong class="loss"
                    >{simTrades.filter((t) => t.profitPct <= 0).length}</strong
                  ></span
                >
                <span class="sim-stat"
                  >Win Rate: <strong
                    >{simTrades.length > 0
                      ? (
                          (simTrades.filter((t) => t.profitPct > 0).length /
                            simTrades.length) *
                          100
                        ).toFixed(1)
                      : 0}%</strong
                  ></span
                >
                <span class="sim-stat"
                  >Balance: <strong class={simBalance >= 100 ? "win" : "loss"}
                    >${simBalance.toFixed(2)}</strong
                  ></span
                >
                <span class="sim-stat"
                  >P&L: <strong class={simBalance - 100 >= 0 ? "win" : "loss"}
                    >{simBalance - 100 >= 0 ? "+" : ""}{(
                      simBalance - 100
                    ).toFixed(2)} ({((simBalance / 100) * 100 - 100).toFixed(
                      1,
                    )}%)</strong
                  ></span
                >
              </div>
              <table class="sim-trades">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Buy ($)</th>
                    <th>Sell ($)</th>
                    <th>Diff ($)</th>
                    <th>Return (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {#each simTrades as tr, i}
                    <tr>
                      <td>{i + 1}</td>
                      <td>{tr.buyPrice.toFixed(2)}</td>
                      <td>{tr.sellPrice.toFixed(2)}</td>
                      <td class={tr.profitUsdt >= 0 ? "win" : "loss"}
                        >{tr.profitUsdt >= 0 ? "+" : ""}{tr.profitUsdt.toFixed(
                          2,
                        )}</td
                      >
                      <td class={tr.profitPct >= 0 ? "win" : "loss"}
                        >{tr.profitPct >= 0 ? "+" : ""}{tr.profitPct.toFixed(
                          2,
                        )}%</td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {:else if loading}
        <div class="loading"><p>Fetching market data...</p></div>
      {:else}
        <div class="loading">
          <p>Click <strong>Fetch</strong> to load chart data</p>
        </div>
      {/if}
    {:else if activeView === "scheduler"}
      <Scheduler />
    {:else if activeView === "order_test"}
      <OrderTestView />
    {:else if activeView === "indicator_adjustments"}
      <IndicatorAdjustments />
    {:else if activeView === "api"}
      <div class="api-view">
        <div class="api-card">
          <h2>Exchange Settings</h2>

          <div class="exch-row">
            <label>
              Exchange
              <select bind:value={$exchange} on:change={onExchangeChange}>
                <option value="binance">Binance</option>
                <option value="pepperstone">Pepperstone cTrader</option>
              </select>
            </label>
            <label>
              Environment
              <select
                bind:value={$environment}
                on:change={onExchangeChange}
                disabled={$exchange === 'binance'}
              >
                <option value="live">Live</option>
                <option value="demo">Demo</option>
              </select>
            </label>
          </div>
          {#if $exchange === "binance"}
            <p class="sub">
              Binance trades on production only (no demo). Enter your
              <code>BINANCE_API_KEY</code> and
              <code>BINANCE_API_SECRET</code>. Public chart data works without
              credentials.
            </p>
          {:else}
            <p class="sub">
              Pepperstone orders go through the cTrader FIX Python bridge.
              <strong>{$environment === "demo" ? "Demo" : "Live"}</strong>
              mode uses
              <code>demo-config-trade.json</code> / <code>config-trade.json</code>.
            </p>
            <label class="dir-label">Python scripts dir
              <input
                bind:value={pepperDir}
                placeholder="auto: pepperstone-ctrader-python"
                on:input={() => persistExchangeSettings()}
              />
              <span class="hint">Empty = auto-detect (or set PEPPERSTONE_DIR)</span>
            </label>
          {/if}

          {#if apiConnected}
            <div class="connected-msg">
              <span class="badge-ok">Connected</span>
              <p>
                Connected to {exchangeLabel($exchange)}
                {#if $exchange === "pepperstone"}
                  ({$environment === "live" ? "Live" : "Demo"})
                {/if}.
              </p>
              <button
                on:click={() => {
                  apiConnected = false;
                  apiKey = "";
                  secretKey = "";
                }}>Disconnect</button
              >
            </div>
          {:else}
            {#if $exchange === "binance"}
              <input
                bind:value={apiKey}
                placeholder="BINANCE_API_KEY"
                type="password"
              />
              <input
                bind:value={secretKey}
                placeholder="BINANCE_API_SECRET"
                type="password"
              />
            {/if}
            {#if connError}<p class="error">{connError}</p>{/if}
            <button
              class="btn-connect"
              on:click={connectApi}
              disabled={connecting}
            >
              {connecting
                ? "Connecting..."
                : $exchange === "pepperstone"
                  ? apiConnected
                    ? "Reconnect"
                    : "Test Connection"
                  : "Connect"}
            </button>
          {/if}
        </div>
      </div>
    {:else if activeView === "balance"}
      <BalanceView {symbol} />
    {:else if activeView === "orderables"}
      <OrderablesView />
    {:else if activeView === "trades"}
      <TradesView />
    {:else if activeView === "statistics"}
      <StatisticsView />
    {:else if activeView === "ai_trade"}
      <AIDecidedTrade />
    {:else if activeView === "csvdata"}
      <CsvFiles />
    {:else if activeView === "debug"}
      <DbDebug />
    {/if}
  </main>
</div>

{#if showBuyModal}
  <div class="modal-overlay" on:click={() => (showBuyModal = false)}>
    <div class="modal" on:click|stopPropagation>
      <h3>Market Buy {symbol}</h3>
      <input
        type="number"
        bind:value={buyQuantity}
        step="0.001"
        placeholder="Quantity"
      />
      {#if chartData.length > 0}
        <p>Price: ~{chartData[chartData.length - 1]?.close} USDT</p>
      {/if}
      <div class="modal-actions">
        <button class="btn-buy" on:click={buy}>Confirm Buy</button>
        <button on:click={() => (showBuyModal = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .toolbar select,
  .toolbar input {
    min-width: 80px;
  }
  .ind-chk {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }
  .ind-chk input {
    margin: 0;
    min-width: auto;
  }
  .balance {
    margin-left: auto;
    font-weight: 600;
  }
  .error-banner {
    background: var(--accent);
    color: #fff;
    padding: 8px 16px;
    font-size: 13px;
  }

  .table-section {
    padding: 12px 16px 0;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .section-header h3 {
    font-size: 14px;
  }
  .pagination {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .pagination button {
    padding: 3px 10px;
    font-size: 12px;
  }
  .pagination button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .chart-section {
    width: 1680px;
    margin: 0 auto;
  }
  .signal-box {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    margin: 12px 0;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .signal-box select {
    min-width: 120px;
  }
  .sb-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .signal-grid {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sg-info {
    font-size: 11px;
    color: var(--text-secondary);
    margin-right: 4px;
  }
  .sg-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sg-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: var(--text-secondary);
  }

  .api-view {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  .api-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px;
    width: 380px;
  }
  .api-card h2 {
    margin-bottom: 4px;
  }
  .api-card .sub {
    color: var(--text-secondary);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .api-card input {
    display: block;
    width: 100%;
    margin-bottom: 10px;
  }
  .exch-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }
  .exch-row label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .exch-row select {
    margin-top: 4px;
    width: 100%;
    color: #000;
    background: #fff;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid #555;
  }
  .dir-label {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .dir-label .hint {
    font-size: 10px;
    opacity: 0.7;
    display: block;
  }
  .api-card .error {
    color: var(--accent);
    font-size: 12px;
  }
  .btn-connect {
    width: 100%;
    background: var(--accent);
    color: #fff;
    padding: 10px;
    font-size: 14px;
  }
  .connected-msg {
    text-align: center;
  }
  .badge-ok {
    display: inline-block;
    background: var(--accent-green);
    color: #000;
    padding: 4px 16px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .sched-analysis {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }
  .sched-analysis .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 16px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .sched-analysis .toggle:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .sched-analysis .arrow {
    font-size: 10px;
    color: var(--text-secondary);
  }
  .sa-form {
    padding: 8px 16px 12px;
    border-top: 1px solid var(--border);
  }
  .sa-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px 12px;
    margin-bottom: 8px;
  }
  .sa-grid label {
    display: block;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .sa-grid input,
  .sa-grid select {
    margin-top: 2px;
    width: 100%;
    box-sizing: border-box;
  }
  .sa-grid select, .sa-sig-grid select { color: #000; background: #fff; }
  .sa-criteria-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 8px;
  }
  .sa-crit {
    border-radius: 6px;
    padding: 8px 10px;
  }
  .sa-buy {
    border: 1px solid var(--accent-green);
  }
  .sa-sell {
    border: 1px solid var(--accent);
  }
  .sa-crit legend {
    font-size: 11px;
    font-weight: 700;
    padding: 0 4px;
  }
  .sa-sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
    margin-bottom: 4px;
  }
  .sa-sig-grid .sig-cell {
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sa-sig-grid select {
    font-size: 11px;
    padding: 2px 4px;
  }
  .sa-sig-grid .slope-label {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--text-secondary);
    cursor: pointer;
    margin-top: 1px;
  }
  .sa-sig-grid .slope-label input {
    margin: 0;
    width: auto;
  }
  .sa-thresh {
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sa-thresh input {
    width: 60px;
  }
  .sa-ma-comp {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-size: 11px;
    color: var(--text-secondary);
    flex-wrap: wrap;
  }
  .sa-ma-comp select {
    color: #000;
    background: #fff;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
  .sa-ma-comp-op {
    font-weight: bold;
    font-size: 14px;
  }
  .sa-actions {
    display: flex;
    gap: 6px;
  }
  .btn-save {
    background: var(--accent-green);
    color: #000;
  }
  .btn-analyze {
    background: var(--accent-yellow);
    color: #000;
  }
  .btn-del {
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--accent);
  }
  .sa-list {
    padding: 0 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 12px;
    padding: 4px 0;
  }
  .sa-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
  }
  .sa-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .sa-tbl {
    font-size: 10px;
    background: #2a2a4a;
    color: #aaa;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .sa-ccy {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .sa-tags {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    margin-top: 4px;
    align-items: center;
  }
  .tag-buy {
    background: var(--accent-green);
    color: #000;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
  }
  .tag-sell {
    background: var(--accent);
    color: #fff;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
  }
  .tag {
    background: var(--bg-secondary);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-family: monospace;
  }
  .sa-card-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .sa-card-actions button {
    font-size: 11px;
    padding: 3px 10px;
  }

  .sim-summary {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    margin: 12px 0;
  }
  .sim-header {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-yellow);
    margin-bottom: 6px;
  }
  .sim-stats {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .sim-stat {
    color: var(--text-secondary);
  }
  .sim-stat strong {
    color: var(--text-primary);
  }
  .sim-stat .win {
    color: var(--accent-green);
  }
  .sim-stat .loss {
    color: var(--accent);
  }
  .sim-trades {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin-top: 8px;
  }
  .sim-trades th,
  .sim-trades td {
    text-align: left;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
  }
  .sim-trades th {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .sim-trades .win {
    color: var(--accent-green);
    font-weight: 600;
  }
  .sim-trades .loss {
    color: var(--accent);
    font-weight: 600;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    min-width: 320px;
  }
  .modal h3 {
    margin-bottom: 12px;
  }
  .modal input {
    width: 100%;
    margin-bottom: 8px;
  }
  .modal p {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .btn-buy {
    background: var(--accent-green);
    color: #000;
  }
</style>
