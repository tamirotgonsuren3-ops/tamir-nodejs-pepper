<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchAIData,
    trainAI,
    checkAIReady,
    getAIDataFiles,
    createAISchedule,
  } from '../lib/wails';
  import type {
    AIFetchDataResult, AIResult, BacktestTrade, FeatureImportance,
  } from '../lib/types';
  import Plotly from 'plotly.js-dist';

  const currencies = ['ETHUSDT','BTCUSDT','BNBUSDT','SOLUSDT','DOGEUSDT','ADAUSDT'];
  const tfOptions = ['5m','15m','30m','1h','4h','8h','1d','3d','1w','1M'];

  // State
  let symbol = 'ETHUSDT';
  let execTF = '5m';
  let lookback = 500;
  let futureCandles = 12;
  let buyThreshold = 0.5;
  let sellThreshold = -0.5;
  let trainSplit = 0.7;
  let nTrees = 200;
  let maxDepth = 12;

  let loading = false;
  let dataStatus = '';
  let dataResult: AIFetchDataResult | null = null;
  let aiResult: AIResult | null = null;
  let error = '';
  let pythonReady = false;
  let hasData = false;
  let chartId = 'ai-equity-chart';
  let featChartId = 'ai-feat-chart';
  let chartRendered = false;
  let featRendered = false;

  let aiDecision: { action: string; confidence: number } | null = null;

  onMount(async () => {
    try {
      const ready = await checkAIReady();
      pythonReady = ready.python && ready.packages;
    } catch (e: any) {
      error = 'AI readiness check failed: ' + (e.message || e);
    }
    try {
      const files = await getAIDataFiles();
      hasData = files.length > 0;
    } catch (_) {}
  });

  async function handleFetchData() {
    loading = true;
    error = '';
    dataStatus = 'Fetching data for all timeframes...';
    try {
      dataResult = await fetchAIData(symbol, lookback);
      hasData = dataResult.success;
      dataStatus = dataResult.message;
    } catch (e: any) {
      error = 'Data fetch failed: ' + (e.message || e);
      dataStatus = '';
    }
    loading = false;
  }

  async function handleTrain() {
    if (!hasData) {
      error = 'No data available. Fetch data first.';
      return;
    }
    loading = true;
    error = '';
    aiResult = null;
    chartRendered = false;
    featRendered = false;
    aiDecision = null;

    const config = {
      symbol,
      exec_timeframe: execTF,
      data_lookback: lookback,
      future_candles: futureCandles,
      buy_threshold: buyThreshold / 100,
      sell_threshold: sellThreshold / 100,
      train_split: trainSplit,
      n_trees: nTrees,
      max_depth: maxDepth,
      use_mtf: true,
    };

    try {
      const result = await trainAI(JSON.stringify(config));
      aiResult = result;
      if (result.error) {
        error = result.error;
      }
      if (result.backtest && result.backtest.trades.length > 0) {
        const lastTrade = result.backtest.trades[result.backtest.trades.length - 1];
        const wins = result.backtest.win_count;
        const total = result.backtest.total_trades;
        aiDecision = {
          action: total > 0 && wins / total > 0.5 ? 'buy' : 'hold',
          confidence: total > 0 ? wins / total : 0,
        };
      }
    } catch (e: any) {
      error = 'Training failed: ' + (e.message || e);
    }
    loading = false;
  }

  async function handleCreateSchedule() {
    if (!aiResult?.backtest || !aiDecision) return;
    const topFeatures = aiResult.train?.feature_importance?.slice(0, 4) || [];
    const buySignals: Record<string, string> = {};
    topFeatures.forEach(f => {
      const name = f.name.replace('tf_5m_', '').replace('tf_', '');
      if (name.endsWith('_trade') || name.endsWith('_bias')) {
        const signal = f.score > 0.05 ? 'buy' : '';
        if (signal) buySignals[name] = signal;
      }
    });

    try {
      const { upsertScheduleTask } = await import('../db/schedule');
      const tblName = execTF === '1M' ? 'analyzed_months' : `analyzed${execTF}s`;
      const sellCrit: Record<string, string> = {};
      Object.keys(buySignals).forEach(k => {
        sellCrit[k] = 'sell';
      });
      await upsertScheduleTask(null, {
        task_name: `AI-${symbol}-${execTF}`,
        interval: 5,
        analyzed_table_name: tblName,
        buy_criteria: JSON.stringify(buySignals),
        sell_criteria: JSON.stringify(sellCrit),
        currency: symbol,
        trade_balance_percentage: 10,
        balance_type: 'percentage',
        sell_if_greater_than: 0.5,
        max_open_trades: 1,
      });
      alert('Scheduled trade created! Go to Scheduler tab to configure & run.');
    } catch (e: any) {
      error = 'Schedule creation failed: ' + (e.message || e);
    }
  }

  function renderEquityCurve() {
    if (!aiResult?.backtest?.equity_curve?.length) return;
    if (chartRendered) return;
    const curve = aiResult.backtest.equity_curve;
    const trades = aiResult.backtest.trades || [];

    const trace = {
      x: curve.map(p => p.time),
      y: curve.map(p => p.equity),
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Equity',
      line: { color: '#22c55e', width: 2 },
    };

    const buyMarks = trades.filter(t => t.return_pct > 0).map(t => ({
      x: t.entry_time,
      y: 0,
    }));
    const sellMarks = trades.filter(t => t.return_pct <= 0).map(t => ({
      x: t.exit_time,
      y: 0,
    }));

    const layout = {
      title: 'Backtest Equity Curve',
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#1a1a2e',
      font: { color: '#ccc', size: 11 },
      xaxis: { title: 'Time', color: '#888', gridcolor: '#333' },
      yaxis: { title: 'Equity ($)', color: '#888', gridcolor: '#333' },
      margin: { t: 30, r: 20, b: 40, l: 60 },
      height: 300,
      showlegend: false,
    };

    try {
      Plotly.newPlot(chartId, [trace], layout, {
        responsive: true,
        displayModeBar: false,
      });
      chartRendered = true;
    } catch (e) {
      console.warn('Plotly equity chart error:', e);
    }
  }

  function renderFeatureImportance() {
    if (!aiResult?.train?.feature_importance?.length) return;
    if (featRendered) return;
    const fi = aiResult.train.feature_importance.slice(0, 15).reverse();

    const trace = {
      x: fi.map(f => f.score),
      y: fi.map(f => f.name),
      type: 'bar' as const,
      orientation: 'h' as const,
      marker: { color: '#a78bfa' },
    };

    const layout = {
      title: 'Top 15 Feature Importance',
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#1a1a2e',
      font: { color: '#ccc', size: 10 },
      xaxis: { title: 'Importance', color: '#888', gridcolor: '#333' },
      yaxis: { color: '#888', automargin: true },
      margin: { t: 30, r: 20, b: 40, l: 140 },
      height: 350,
    };

    try {
      Plotly.newPlot(featChartId, [trace], layout, {
        responsive: true,
        displayModeBar: false,
      });
      featRendered = true;
    } catch (e) {
      console.warn('Plotly feature importance chart error:', e);
    }
  }

  $: if (aiResult?.backtest?.equity_curve) {
    if (typeof window !== 'undefined') {
      setTimeout(renderEquityCurve, 100);
    }
  }
  $: if (aiResult?.train?.feature_importance) {
    if (typeof window !== 'undefined') {
      setTimeout(renderFeatureImportance, 100);
    }
  }

  function selVal(e: Event): string { return (e.target as HTMLSelectElement).value; }
  function inpVal(e: Event): string { return (e.target as HTMLInputElement).value; }
</script>

<div class="view">
  <h2>AI-Decided Trade</h2>
  <p class="subtitle">
    Random Forest based multi-timeframe analysis. Python 3 + scikit-learn required.
    <span class="py-status" class:ready={pythonReady} class:missing={!pythonReady}>
      {pythonReady ? '✓ Python ready' : '✗ Python not found'}
    </span>
  </p>

  <div class="controls">
    <div class="ctrl-row">
      <label>Currency
        <select value={symbol} on:change={e => symbol = selVal(e)}>
          {#each currencies as c}<option>{c}</option>{/each}
        </select>
      </label>
      <label>Exec TF
        <select value={execTF} on:change={e => execTF = selVal(e)}>
          {#each tfOptions as tf}<option>{tf}</option>{/each}
        </select>
      </label>
      <label>Lookback
        <input type="number" value={lookback} on:input={e => lookback = parseInt(inpVal(e)) || 500} min="200" max="2000" />
      </label>
      <label>Future candles
        <input type="number" value={futureCandles} on:input={e => futureCandles = parseInt(inpVal(e)) || 12} min="1" max="100" />
      </label>
    </div>
    <div class="ctrl-row">
      <label>Buy ≥ %
        <input type="number" value={buyThreshold} on:input={e => buyThreshold = parseFloat(inpVal(e)) || 0.5} step="0.1" min="0.1" max="10" />
      </label>
      <label>Sell ≤ %
        <input type="number" value={sellThreshold} on:input={e => sellThreshold = parseFloat(inpVal(e)) || -0.5} step="0.1" max="-0.1" />
      </label>
      <label>Train split
        <input type="number" value={trainSplit} on:input={e => trainSplit = parseFloat(inpVal(e)) || 0.7} step="0.05" min="0.5" max="0.95" />
      </label>
    </div>
    <div class="ctrl-row">
      <label>N trees
        <input type="number" value={nTrees} on:input={e => nTrees = parseInt(inpVal(e)) || 200} min="50" max="1000" step="50" />
      </label>
      <label>Max depth
        <input type="number" value={maxDepth} on:input={e => maxDepth = parseInt(inpVal(e)) || 12} min="3" max="30" />
      </label>
    </div>
    <div class="ctrl-actions">
      <button on:click={handleFetchData} disabled={loading}
        class:btn-primary={!hasData}>
        {loading ? 'Working...' : hasData ? 'Re-fetch Data' : '1. Fetch All TF Data'}
      </button>
      <button on:click={handleTrain} disabled={loading || !hasData || !pythonReady}
        class="btn-train">
        {loading ? 'Training...' : '2. Train & Backtest'}
      </button>
    </div>
    {#if dataStatus}<p class="status-msg">{dataStatus}</p>{/if}
    {#if error}<p class="error-msg">{error}</p>{/if}
  </div>

  {#if aiResult?.train}
    <div class="section">
      <h3>Model Performance</h3>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-val" class:good={aiResult.train.model_accuracy > 0.6}>
            {(aiResult.train.model_accuracy * 100).toFixed(1)}%
          </span>
          <span class="metric-label">Accuracy</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:good={aiResult.train.precision > 0.6}>
            {(aiResult.train.precision * 100).toFixed(1)}%
          </span>
          <span class="metric-label">Precision</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:good={aiResult.train.recall > 0.5}>
            {(aiResult.train.recall * 100).toFixed(1)}%
          </span>
          <span class="metric-label">Recall</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:good={aiResult.train.f1_score > 0.5}>
            {(aiResult.train.f1_score * 100).toFixed(1)}%
          </span>
          <span class="metric-label">F1 Score</span>
        </div>
        <div class="metric-card">
          <span class="metric-val">{aiResult.train.total_samples}</span>
          <span class="metric-label">Samples</span>
        </div>
        <div class="metric-card">
          <span class="metric-val">{JSON.stringify(aiResult.train.class_balance)}</span>
          <span class="metric-label">Class Balance (-1/0/+1)</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Feature Importance</h3>
      <div id={featChartId} class="chart"></div>
    </div>
  {/if}

  {#if aiResult?.backtest}
    <div class="section">
      <h3>Backtest Results</h3>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-val">{aiResult.backtest.total_trades}</span>
          <span class="metric-label">Total Trades</span>
        </div>
        <div class="metric-card">
          <span class="metric-val win">{(aiResult.backtest.win_rate * 100).toFixed(1)}%</span>
          <span class="metric-label">Win Rate</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:win={aiResult.backtest.total_return > 0} class:loss={aiResult.backtest.total_return <= 0}>
            {aiResult.backtest.total_return > 0 ? '+' : ''}{aiResult.backtest.total_return.toFixed(2)}%
          </span>
          <span class="metric-label">Total Return</span>
        </div>
        <div class="metric-card">
          <span class="metric-val loss">{aiResult.backtest.max_drawdown.toFixed(1)}%</span>
          <span class="metric-label">Max Drawdown</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:win={aiResult.backtest.sharpe_ratio > 1}>
            {aiResult.backtest.sharpe_ratio.toFixed(2)}
          </span>
          <span class="metric-label">Sharpe Ratio</span>
        </div>
        <div class="metric-card">
          <span class="metric-val" class:win={aiResult.backtest.final_balance > 100}>
            ${aiResult.backtest.final_balance.toFixed(2)}
          </span>
          <span class="metric-label">Final Balance ($100 start)</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Equity Curve</h3>
      <div id={chartId} class="chart"></div>
    </div>

    <div class="section">
      <h3>Trade Log ({aiResult.backtest.trades.length} trades)</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Entry Price</th>
              <th>Exit Price</th>
              <th>Return</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {#each aiResult.backtest.trades as t, i}
              <tr>
                <td>{i + 1}</td>
                <td class="mono">{t.entry_time}</td>
                <td class="mono">{t.exit_time}</td>
                <td class="mono">{t.entry_price.toFixed(2)}</td>
                <td class="mono">{t.exit_price.toFixed(2)}</td>
                <td class:win={t.return_pct > 0} class:loss={t.return_pct <= 0}>
                  {t.return_pct > 0 ? '+' : ''}{t.return_pct.toFixed(2)}%
                </td>
                <td>{t.duration}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section schedule-section">
      <h3>Deploy as Scheduled Trade</h3>
      {#if aiDecision}
        <p class="ai-decision">
          AI recommends: <strong class:win={aiDecision.action === 'buy'} class:loss={aiDecision.action !== 'buy'}>
            {aiDecision.action.toUpperCase()}
          </strong>
          (confidence: {(aiDecision.confidence * 100).toFixed(1)}%)
        </p>
      {/if}
      <button on:click={handleCreateSchedule} class="btn-schedule" disabled={!aiDecision}>
        Create Scheduled Trade
      </button>
      <p class="hint">Creates a task in Scheduler using AI signals. Configure balance & profit in the Scheduler tab.</p>
    </div>
  {/if}
</div>

<style>
  .view { padding: 24px; }
  .view h2 { margin: 0 0 4px; font-size: 18px; }
  .subtitle { font-size: 12px; color: var(--text-secondary); margin: 0 0 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .py-status { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
  .py-status.ready { background: var(--accent-green); color: #000; }
  .py-status.missing { background: #555; color: #aaa; }

  .controls { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .ctrl-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .ctrl-row label { font-size: 11px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px; min-width: 100px; }
  .ctrl-row input, .ctrl-row select { color: #000; background: #fff; padding: 3px 6px; border-radius: 3px; border: 1px solid #555; font-size: 12px; }
  .ctrl-actions { display: flex; gap: 8px; margin-top: 8px; }
  .ctrl-actions button { font-size: 13px; padding: 8px 16px; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-train { background: var(--accent-green); color: #000; }
  .status-msg { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; }
  .error-msg { font-size: 12px; color: var(--accent); margin: 8px 0 0; }

  .section { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .section h3 { margin: 0 0 12px; font-size: 14px; }

  .metric-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
  .metric-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 10px; text-align: center; }
  .metric-val { display: block; font-size: 20px; font-weight: 700; color: #fff; }
  .metric-val.good { color: var(--accent-green); }
  .metric-val.win { color: var(--accent-green); }
  .metric-val.loss { color: var(--accent); }
  .metric-label { display: block; font-size: 10px; color: var(--text-secondary); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.3px; }

  .chart { width: 100%; border-radius: 6px; overflow: hidden; }

  .table-wrap { overflow-x: auto; max-height: 400px; overflow-y: auto; }
  .table-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .table-wrap th, .table-wrap td { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .table-wrap th { color: var(--text-secondary); font-weight: 600; position: sticky; top: 0; background: var(--bg-secondary); }
  .mono { font-family: monospace; }
  .win { color: var(--accent-green); font-weight: 600; }
  .loss { color: var(--accent); font-weight: 600; }

  .schedule-section { border-color: var(--accent-yellow); }
  .ai-decision { font-size: 14px; margin: 0 0 12px; }
  .ai-decision strong { font-size: 18px; }
  .btn-schedule { background: var(--accent-yellow); color: #000; font-size: 14px; padding: 10px 24px; }
  .btn-schedule:disabled { opacity: 0.4; cursor: not-allowed; }
  .hint { font-size: 11px; color: var(--text-secondary); margin: 6px 0 0; }
</style>
