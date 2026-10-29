<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getScheduleTasks, upsertScheduleTask, deleteScheduleTask, updateTaskStatus, type ScheduleTask } from '../db/schedule';
  import { getScheduleLogs, type ScheduleLog } from '../db/schedule_logs';
  import { loadParamsForTable } from '../db/indicator_adjustments';
  import { tableForInterval } from '../db/analyzed';
  import { exchange, symbolsFor } from '../lib/exchange';
  import { fetchAndAnalyzeWithParams, errMsg } from '../lib/wails';
  import CandleChart from './CandleChart.svelte';

  // The trading loop itself lives in Go (engine.go). This component only edits
  // task configuration, starts/stops the Go loop, and polls its execution log.
  const intervalOpts = [1,2,3,5,10,15,30,60,120,240,720,1440];
  const tableOpts = ['analyzed1ms','analyzed5ms','analyzed15ms','analyzed30ms','analyzed1hs','analyzed4hs','analyzed8hs','analyzed1ds','analyzed3ds','analyzed1ws','analyzed_months'];
  const signalCols = ['macd_trade','rsi_trade','stochastic_trade','ema_trade','sma_trade','ma_trade','hma_trade'];
  const signalVals = ['','buy','sell','hold'];

  $: currencyOpts = symbolsFor($exchange);
  $: isPepperstone = $exchange === 'pepperstone';

  let tasks: ScheduleTask[] = [];
  let logs: ScheduleLog[] = [];
  let loading = false;
  let logsLoading = false;
  let saveMsg = '';
  let saveError = '';
  let loadError = '';

  let logsTimer: ReturnType<typeof setInterval> | null = null;
  let tasksTimer: ReturnType<typeof setInterval> | null = null;

  let fid: number | null = null;
  let fName = '';
  let fCurrency = 'ETHUSDT';
  let fTable = 'analyzed1hs';
  let fInterval = '5';
  let fBalanceType = 'percentage';
  let fBalanceValue = '10';
  let fSellGt = '0.5';
  let fMaxOpen = '1';

  let buySignals: Record<string, string> = {};
  let sellSignals: Record<string, string> = {};
      signalCols.forEach(c => { buySignals[c] = ''; sellSignals[c] = ''; });
  let fBuyRsi = '';
  let fSellRsi = '';

  let pollLogs: ReturnType<typeof setInterval> | null = null;
  let pollTasks: ReturnType<typeof setInterval> | null = null;

  $: processedLogs = logs.map(l => ({...l, _cols: parseColPairs(l.criteria_info)}));
  $: logColumns = processedLogs.length > 0 ? processedLogs[0]._cols : [];

  onMount(async () => {
    await load();
    await loadLogs();
    // A running task keeps trading in Go even when this window is closed; the
    // UI just samples its state and log.
    logsTimer = setInterval(() => { void loadLogs(true); }, 5000);
    tasksTimer = setInterval(() => { void load(true); }, 5000);
    chkTimer = setInterval(() => { if (chkAuto && chkCurrency) void loadChart(true); }, 60000);
  });
  onDestroy(() => {
    if (logsTimer) clearInterval(logsTimer);
    if (tasksTimer) clearInterval(tasksTimer);
    if (chkTimer) clearInterval(chkTimer);
  });

  async function load(silent = false) {
    if (!silent) loading = true;
    loadError = '';
    try {
      tasks = await getScheduleTasks();
    } catch (err: any) {
      loadError = err?.message || String(err);
      console.error('Scheduler load error:', loadError);
    } finally {
      if (!silent) loading = false;
    }
  }

  async function loadLogs(silent = false) {
    if (!silent) logsLoading = true;
    try {
      logs = await getScheduleLogs(undefined, 200);
    } catch (err: any) {
      console.error('Load logs error:', err);
    } finally {
      if (!silent) logsLoading = false;
    }
  }

  function reset() {
    fid = null; fName = ''; fCurrency = symbolsFor($exchange)[0] || 'USDJPY'; fTable = 'analyzed1hs';
    fInterval = '5'; fBalanceType = isPepperstone ? 'fixed' : 'percentage'; fBalanceValue = isPepperstone ? '0.01' : '10'; fSellGt = '0.5'; fMaxOpen = '1';
    signalCols.forEach(c => { buySignals[c] = ''; sellSignals[c] = ''; });
    fBuyRsi = ''; fSellRsi = '';
    saveMsg = ''; saveError = '';
  }

  function edit(t: ScheduleTask) {
    fid = t.id; fName = t.task_name; fCurrency = t.currency; fTable = t.analyzed_table_name;
    fInterval = String(t.interval); fBalanceType = t.balance_type || 'percentage'; fBalanceValue = String(t.trade_balance_percentage);
    fSellGt = String(t.sell_if_greater_than); fMaxOpen = String(t.max_open_trades ?? 1);
    try {
      const b = JSON.parse(t.buy_criteria || '{}');
      const s = JSON.parse(t.sell_criteria || '{}');
      signalCols.forEach(c => { buySignals[c] = b[c] || ''; sellSignals[c] = s[c] || ''; });
      fBuyRsi = b['rsi_level'] != null ? String(b['rsi_level']) : '';
      fSellRsi = s['rsi_level'] != null ? String(s['rsi_level']) : '';
    } catch { }
  }

  async function save() {
    saveMsg = ''; saveError = '';
    try {
      const buyCrit: Record<string, any> = {};
      const sellCrit: Record<string, any> = {};
      signalCols.forEach(c => { buyCrit[c] = buySignals[c]; sellCrit[c] = sellSignals[c]; });
      if (fBuyRsi) buyCrit['rsi_level'] = parseFloat(fBuyRsi);
      if (fSellRsi) sellCrit['rsi_level'] = parseFloat(fSellRsi);
      await upsertScheduleTask(fid, {
        task_name: fName, interval: parseInt(fInterval) || 5,
        analyzed_table_name: fTable,
        buy_criteria: JSON.stringify(buyCrit),
        sell_criteria: JSON.stringify(sellCrit),
        currency: fCurrency,
        trade_balance_percentage: parseFloat(fBalanceValue) || 0,
        balance_type: fBalanceType,
        sell_if_greater_than: parseFloat(fSellGt) || 0,
        max_open_trades: parseInt(fMaxOpen) || 1,
      });
      saveMsg = 'Saved';
      reset();
      await load();
    } catch (err: any) {
      saveError = err?.message || String(err);
    }
  }

  async function remove(id: number) {
    try {
      await deleteScheduleTask(id);
      await load();
    } catch (err: any) {
      saveError = err?.message || String(err);
    }
  }

  // Start/stop both toggles the persisted status and starts/stops the Go loop.
  async function toggleRun(t: ScheduleTask) {
    try {
      await updateTaskStatus(t.id, t.task_status === 'running' ? 'stopped' : 'running');
      await load();
    } catch (err: any) {
      saveError = err?.message || String(err);
    }
  }

  interface LogCol { label: string; value: string; }

  function parseColPairs(raw: string): LogCol[] {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        if (v.length > 0 && 'label' in v[0]) return v;
        return v.map((p: any) => ({ label: p.al || p.label || '?', value: p.a || p.value || '' }));
      }
      if (v && typeof v === 'object' && v.buy != null) {
        const out: LogCol[] = [];
        if (v.buy) out.push({ label: 'buy', value: v.buy });
        if (v.sell) out.push({ label: 'sell', value: v.sell });
        return out;
      }
      return [];
    } catch {
      return [];
    }
  }

  function selVal(e: Event): string { return (e.target as HTMLSelectElement).value; }
  function inpVal(e: Event): string { return (e.target as HTMLInputElement).value; }

  // --- 1-minute tactic-check chart -------------------------------------------
  // The same Plotly candlestick + indicator chart the Chart page renders, fixed
  // to 1-minute candles, with the schedule execution logs drawn on top: executed
  // buys/sells as triangles, each evaluation (hold / no-signal check) as a dot
  // and errors always drawn in red. An execution is snapped to the nearest
  // candle because the x-axis is categorical.
  const chkIntervals = ['1m', '5m', '15m', '30m', '1h', '4h'];

  let chkCurrency = '';
  let chkInterval = '1m';
  let chkLookback = 300;
  let chkIndicators = { macd: true, rsi: true, stochastic: true, sma: true, ema: true, bb: true, hma: true };
  let chkShowEval = true;
  let chkAuto = false;
  let chkTimer: ReturnType<typeof setInterval> | null = null;

  let chartRows: any[] = [];
  let tradePoints: { x: string; y: number; type: 'buy' | 'sell' | 'rising' | 'falling'; label: string }[] = [];
  let evalPts: { x: string; y: number; label: string; color: string }[] = [];
  let errPts: { x: string; y: number; label: string; color: string }[] = [];
  let chkLoading = false;
  let chkError = '';
  let chartLoaded = false;

  async function loadChart(silent = false) {
    if (!chkCurrency) return;
    if (!silent) chkLoading = true;
    chkError = '';
    try {
      const iv = tableForInterval(chkInterval);
      const params = await loadParamsForTable(iv);
      const r = await fetchAndAnalyzeWithParams(chkCurrency, chkInterval, chkLookback, params);
      chartRows = r?.analyzed || [];
      chartLoaded = chartRows.length > 0;
    } catch (e: any) {
      chkError = errMsg(e, 'Failed to load chart data');
      chartRows = [];
      chartLoaded = false;
    }
    if (!silent) chkLoading = false;
  }

  // Follow the first task's pair so the chart opens on what was scheduled.
  $: if (tasks.length && !chkCurrency) {
    chkCurrency = tasks[0].currency || symbolsFor($exchange)[0] || '';
    loadChart();
  }

  // Trade/eval markers, rebuilt whenever candles or logs change (logs refresh
  // every 5s, so fresh executions appear without refetching candles).
  $: if (chartRows.length && chkCurrency) buildChartPoints(chartRows, logs, chkCurrency);
  else { tradePoints = []; evalPts = []; errPts = []; }

  function buildChartPoints(rows: any[], logsArr: ScheduleLog[], currency: string) {
    const candles = rows.map((r) => {
      const t = typeof r.time === 'number' ? r.time * 1000 : Date.parse(r.time);
      return { x: new Date(t).toISOString().slice(0, 19).replace('T', ' '), t, c: r.close };
    });
    if (candles.length === 0) { tradePoints = []; evalPts = []; errPts = []; return; }
    const first = candles[0].t;
    const last = candles[candles.length - 1].t;

    const trades: typeof tradePoints = [];
    const evals: typeof evalPts = [];
    const errs: typeof errPts = [];

    for (const l of logsArr) {
      if (String(l.currency || '').toUpperCase() !== currency.toUpperCase()) continue;
      const t = Date.parse(String(l.created_at || ''));
      if (isNaN(t) || t < first - 60000 || t > last + 60000) continue;
      let best = candles[0];
      for (const c of candles) {
        if (Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
      }
      // An executed order records "amount @ price"; fall back to candle close.
      const px = /@\s*([0-9]+(?:\.[0-9]+)?)/.exec(l.trade_amount || '');
      const y = px && Number(px[1]) > 0 ? Number(px[1]) : best.c;

      const when = new Date(t).toISOString().slice(0, 19).replace('T', ' ');
      const label = `<b>${l.task_name || '(task)'}</b><br>${l.action}${px ? ` @ ${px[1]}` : ''}`
        + `<br>${when} UTC<br>${l.message || ''}`
        + (l.error ? `<br><span style="color:#ff8080">${l.error}</span>` : '');

      const a = String(l.action || '').toLowerCase();
      if (a === 'buy') {
        trades.push({ x: best.x, y, type: 'buy', label });
      } else if (a === 'sell' || a.startsWith('close-')) {
        trades.push({ x: best.x, y, type: 'sell', label });
      } else if (a === 'error') {
        errs.push({ x: best.x, y, label, color: '#e94560' });
      } else {
        // hold / buy-check / sell-check: the tactic ran, criteria not met
        evals.push({ x: best.x, y, label, color: '#9090a8' });
      }
    }
    tradePoints = trades;
    evalPts = evals;
    errPts = errs;
  }

  $: chartEvalPoints = chkShowEval ? [...evalPts, ...errPts] : errPts;
</script>

<div class="view">
  <div class="form-panel">
    <h2>{fid ? 'Edit' : 'New'} Schedule</h2>

    <div class="form-grid">
      <label>Task Name <input value={fName} on:input={e => fName = inpVal(e)} /></label>
      <label>Currency
        <select value={fCurrency} on:change={e => fCurrency = selVal(e)}>
          {#each currencyOpts as c}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </label>
      <label>Analyzed Table
        <select value={fTable} on:change={e => fTable = selVal(e)}>
          {#each tableOpts as tb}
            <option value={tb}>{tb}</option>
          {/each}
        </select>
      </label>
      <label>Interval (minutes)
        <input type="number" value={fInterval} on:input={e => fInterval = inpVal(e)} />
      </label>
      <label>Max Open Trades <input type="number" min="1" value={fMaxOpen} on:input={e => fMaxOpen = inpVal(e)} /></label>
      <label>Sell if profit &gt; (%) <input type="number" value={fSellGt} on:input={e => fSellGt = inpVal(e)} /></label>
    </div>

    <div class="size-row">
      <label>Position Sizing
        <select value={fBalanceType} on:change={e => fBalanceType = selVal(e)}>
          {#if isPepperstone}
            <option value="fixed">Lots (Pepperstone)</option>
          {:else}
            <option value="percentage">% of free balance</option>
            <option value="fixed">Fixed USDT</option>
          {/if}
        </select>
      </label>
      <label>{isPepperstone ? 'Lots' : (fBalanceType === 'percentage' ? 'Percent (%)' : 'Amount (USDT)')}
        <input type="number" value={fBalanceValue} on:input={e => fBalanceValue = inpVal(e)} />
      </label>
    </div>

    <div class="sig-section">
      <div class="sig-col buy">
        <h4>Buy signals</h4>
        <div class="sig-grid">
          {#each signalCols as col}
            <label>{col}
              <select value={buySignals[col]} on:change={e => buySignals[col] = selVal(e)}>
                {#each signalVals as v}<option value={v}>{v || '-'}</option>{/each}
              </select>
            </label>
          {/each}
        </div>
        <label>rsi_level (filter) <input value={fBuyRsi} on:input={e => fBuyRsi = inpVal(e)} /></label>
      </div>
      <div class="sig-col sell">
        <h4>Sell signals</h4>
        <div class="sig-grid">
          {#each signalCols as col}
            <label>{col}
              <select value={sellSignals[col]} on:change={e => sellSignals[col] = selVal(e)}>
                {#each signalVals as v}<option value={v}>{v || '-'}</option>{/each}
              </select>
            </label>
          {/each}
        </div>
        <label>rsi_level (filter) <input value={fSellRsi} on:input={e => fSellRsi = inpVal(e)} /></label>
      </div>
    </div>

    <div class="form-actions">
      <button class="btn-save" on:click={save}>Save</button>
      <button on:click={reset}>Reset</button>
      {#if saveMsg}<span class="ok">{saveMsg}</span>{/if}
      {#if saveError}<span class="error">{saveError}</span>{/if}
    </div>
  </div>

  <div class="chart-section">
    <div class="chart-head">
      <h2>Tactic Check Chart</h2>
      <div class="chart-filters">
        <label>
          Pair
          <select bind:value={chkCurrency} on:change={() => loadChart()}>
            {#each currencyOpts as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </label>
        <label>
          Timeframe
          <select bind:value={chkInterval} on:change={() => loadChart()}>
            {#each chkIntervals as iv}<option value={iv}>{iv}</option>{/each}
          </select>
        </label>
        <label>
          Candles
          <input type="number" min="100" max="1000" step="100" bind:value={chkLookback} on:change={() => loadChart()} />
        </label>
        <button class="btn-sm" on:click={() => loadChart()} disabled={chkLoading || !chkCurrency}>
          {chkLoading ? 'Loading...' : 'Fetch'}
        </button>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.macd} />MACD</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.rsi} />RSI</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.stochastic} />Stoch</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.sma} />SMA</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.ema} />EMA</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.hma} />HMA</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkIndicators.bb} />BB</label>
        <label class="ind-chk"><input type="checkbox" bind:checked={chkShowEval} />Evaluations</label>
        <label class="ind-chk" title="Refetch candles every 60s; executions still appear every 5s from the log">
          <input type="checkbox" bind:checked={chkAuto} />Auto refresh
        </label>
      </div>
    </div>

    {#if chkError}<p class="error">{chkError}</p>{/if}

    {#if chartLoaded}
      <div class="chart-box">
        <CandleChart
          rows={chartRows}
          showIndicators={chkIndicators}
          simPoints={tradePoints}
          evalPoints={chartEvalPoints}
        />
      </div>
      <p class="note">
        {tradePoints.length} execution{tradePoints.length === 1 ? '' : 's'} and
        {chartEvalPoints.length} evaluation{chartEvalPoints.length === 1 ? '' : 's'} plotted for
        {chkCurrency} {chkInterval} from the execution log
        (latest {logs.length} entries; hover for the task, action, price and message —
        log dots stay current every 5s, candles only refetch via
        {chkAuto ? 'Auto refresh' : 'the Fetch button'}).
      </p>
    {:else if !chkLoading}
      <p class="muted">Fetch candles to see where each scheduled tactic acted on price.</p>
    {/if}
  </div>

  <div class="task-section">
    <h2>Schedule Tasks</h2>

    {#if loadError}
      <div class="error-banner">Database error: {loadError}</div>
    {:else if loading}
      <p class="muted">Loading...</p>
    {:else if tasks.length === 0}
      <p class="muted">No tasks yet.</p>
    {:else}
      <div class="task-list">
        {#each tasks as t}
          <div class="task-card">
            <div class="card-top">
              <strong>{t.task_name || t.currency}</strong>
              <span class="status-dot" class:run={t.task_status === 'running'} class:stop={t.task_status !== 'running'}>
                {t.task_status === 'running' ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>
            <div class="card-body">
              <span>{t.currency}</span> <span>{t.analyzed_table_name}</span> <span>Every {t.interval}m</span>
              <span>Balance: {t.balance_type === 'fixed' ? `${t.trade_balance_percentage} USDT` : `${t.trade_balance_percentage}%`}</span>
              {#if isPepperstone}<span>Max open: {t.max_open_trades ?? 1} per dir</span>{/if}
            </div>
            {#if t.buy_criteria && t.buy_criteria !== '{}'}
              {@const b = JSON.parse(t.buy_criteria || '{}')}
              <div class="criteria-tags">
                <span class="tag-buy">BUY</span>
                {#each signalCols as col}
                  {#if b[col]}<span class="tag">{col}={b[col]}</span>{/if}
                {/each}
                {#if b['rsi_level']}<span class="tag">RSI&lt;{b['rsi_level']}</span>{/if}
              </div>
            {/if}
            {#if t.sell_criteria && t.sell_criteria !== '{}'}
              {@const s = JSON.parse(t.sell_criteria || '{}')}
              <div class="criteria-tags">
                <span class="tag-sell">SELL</span>
                {#each signalCols as col}
                  {#if s[col]}<span class="tag">{col}={s[col]}</span>{/if}
                {/each}
                {#if s['rsi_level']}<span class="tag">RSI&gt;{s['rsi_level']}</span>{/if}
              </div>
            {/if}
            <div class="card-actions">
              <button class="btn-run" on:click={() => toggleRun(t)}>
                {t.task_status === 'running' ? 'Stop' : 'Start'}
              </button>
              <button on:click={() => edit(t)}>Edit</button>
              <button on:click={() => remove(t.id)}>Delete</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="log-section">
    <div class="log-header">
      <h2>Execution Logs</h2>
      <button on:click={() => loadLogs()} disabled={logsLoading}>Refresh</button>
    </div>
    {#if logsLoading}
      <p class="muted">Loading...</p>
    {:else if logs.length === 0}
      <p class="muted">No logs yet.</p>
    {:else}
      <div class="log-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Task</th>
              <th>Action</th>
              <th>Currency</th>
              <th>Message</th>
              {#each logColumns as c}<th>{c.label}</th>{/each}
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {#each processedLogs as l}
              <tr class:err={!!l.error}>
                <td>{l.created_at}</td>
                <td>{l.task_name}</td>
                <td>{l.action}</td>
                <td>{l.currency}</td>
                <td>{l.message}</td>
                {#each l._cols as c}<td>{c.value}</td>{/each}
                <td>{l.error}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .view { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
  .form-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .form-panel h2 { margin: 0 0 12px; font-size: 16px; }
  .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .size-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px; }
  .sig-section { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px; }
  .sig-col h4 { margin: 0 0 8px; font-size: 13px; }
  .sig-col.buy h4 { color: var(--accent-green); }
  .sig-col.sell h4 { color: var(--accent); }
  .sig-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .form-actions { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  .btn-save { background: var(--accent-green); color: #000; }
  .ok { color: var(--accent-green); font-size: 12px; }
  .error { color: var(--accent); font-size: 12px; }
  .error-banner { background: var(--accent); color: #fff; padding: 10px 16px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
  .task-section h2 { margin: 0 0 12px; font-size: 16px; }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .task-list { display: flex; flex-direction: column; gap: 8px; }
  .task-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
  .card-top { display: flex; align-items: center; gap: 8px; }
  .card-body { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); margin-top: 4px; flex-wrap: wrap; }
  .criteria-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
  .tag { background: var(--bg-card); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; }
  .tag-buy { background: var(--accent-green); color: #000; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .tag-sell { background: var(--accent); color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .card-actions { display: flex; gap: 6px; margin-top: 8px; }
  .status-dot { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 4px; }
  .status-dot.run { background: var(--accent-green); color: #000; }
  .status-dot.stop { background: #555; color: #aaa; }
  .log-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .log-header h2 { margin: 0; font-size: 15px; }
  .log-table-wrap { overflow-x: auto; max-height: 400px; overflow-y: auto; }
  .log-section table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  tr.err { background: rgba(220, 80, 60, 0.12); }

  /* Tactic check chart */
  .chart-section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; flex-wrap: wrap; gap: 10px; }
  .chart-head h2 { margin: 0; font-size: 15px; }
  .chart-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; }
  .chart-filters label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .btn-sm { padding: 4px 12px; font-size: 11px; background: var(--bg-card); color: var(--text-primary); }
  .ind-chk { flex-direction: row !important; align-items: center; gap: 5px; font-size: 11px; }
  .chart-box {
    overflow-x: auto; overflow-y: hidden; background: #1a1a2e;
    border: 1px solid var(--border); border-radius: 6px;
  }
  .note { margin-top: 10px; font-size: 11px; color: var(--text-secondary); }
</style>
