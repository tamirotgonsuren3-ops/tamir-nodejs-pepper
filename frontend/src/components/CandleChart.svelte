<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Plotly from 'plotly.js-dist';

export let rows: any[] = [];
  export let signalField = '';
  export let showSignals = false;
  export let showIndicators = { macd: true, rsi: true, stochastic: true, sma: true, ema: true, bb: true, hma: true };
  // `label` is shown in the marker's hover box — on the statistics page it
  // carries the task that opened the trade.
  export let simPoints: { x: string; y: number; type: 'buy' | 'sell' | 'rising' | 'falling'; label?: string }[] = [];
  // Small evaluation dots (scheduler checks/holds/errors). Grouped by color so
  // each action class gets its own legend entry; `label` is the hover text.
  export let evalPoints: { x: string; y: number; label: string; color?: string }[] = [];

  let container: HTMLDivElement;

  function fmtDates(): string[] {
    return rows.map(r => {
      const t = typeof r.time === 'number' ? r.time * 1000 : Date.parse(r.time);
      return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
    });
  }

  function plot() {
    if (!container || rows.length === 0) return;
    const dates = fmtDates();

    const r0 = rows[0] || {};
    const canMACD = r0.macd !== undefined && r0.macd !== null && showIndicators.macd;
    const canStoch = r0.stochastic_K !== undefined && r0.stochastic_K !== null && showIndicators.stochastic;
    const canRSI = r0.rsi !== undefined && r0.rsi !== null && showIndicators.rsi;
    const canSMA = r0.sma_short !== undefined && r0.sma_short !== null && showIndicators.sma;
    const canEMA = r0.ema_short !== undefined && r0.ema_short !== null && showIndicators.ema;
    const canBB = r0.bb_middle !== undefined && r0.bb_middle !== null && showIndicators.bb;
    const canHMA = r0.hma !== undefined && r0.hma !== null && showIndicators.hma;

    const subplotDefs: { name: string; has: boolean; range?: [number, number] }[] = [
      { name: 'MACD', has: canMACD },
      { name: 'stoch', has: canStoch },
      { name: 'RSI', has: canRSI, range: [0, 100] },
    ];
    const active = subplotDefs.filter(s => s.has);
    const n = active.length;

    const candleDomain: [number, number] = n === 0 ? [0, 1] : [0.50, 1];
    const gap = 0.03;
    const totalSubSpace = candleDomain[0] - gap;
    const h = n > 0 ? (totalSubSpace - (n - 1) * gap) / n : 0;

    const yDomains: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const bot = i * (h + gap);
      yDomains.push([bot, bot + h]);
    }

    const traces: any[] = [];

    // candlestick
    traces.push({
      type: 'candlestick',
      x: dates,
      open: rows.map(d => d.open),
      high: rows.map(d => d.high),
      low: rows.map(d => d.low),
      close: rows.map(d => d.close),
      name: '',
      increasing: { line: { color: '#2ecc71' }, fillcolor: '#2ecc71' },
      decreasing: { line: { color: '#e94560' }, fillcolor: '#e94560' },
    });

    // SMA overlay
    if (canSMA) {
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.sma_short), name: 'SMA3', line: { color: '#f39c12', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.sma_long), name: 'SMA7', line: { color: '#9b59b6', width: 1 } });
    }

    // EMA overlay
    if (canEMA) {
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.ema_short), name: 'EMA9', line: { color: '#1abc9c', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.ema_middle), name: 'EMA21', line: { color: '#3498db', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.ema_long), name: 'EMA50', line: { color: '#e67e22', width: 1 } });
    }

    // HMA overlay
    if (canHMA) {
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.hma), name: 'HMA9', line: { color: '#f1c40f', width: 1.5 } });
    }

    // BB overlay
    if (canBB) {
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.bb_upper), name: 'BB Up', line: { color: '#e91e63', width: 1, dash: 'dash' } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.bb_middle), name: 'BB Mid', line: { color: '#e91e63', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.bb_lower), name: 'BB Low', line: { color: '#e91e63', width: 1, dash: 'dash' } });
    }

    // MACD subplot
    if (canMACD) {
      const idx = active.findIndex(s => s.name === 'MACD');
      const ya = `y${idx + 2}`;
      traces.push({ type: 'bar', x: dates, y: rows.map(d => d.macd_hist), yaxis: ya, name: 'Hist', marker: { color: 'rgba(150,150,220,0.5)' } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.macd), yaxis: ya, name: 'MACD', line: { color: '#3498db', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.macd_signal), yaxis: ya, name: 'Signal', line: { color: '#e74c3c', width: 1 } });
    }

    // Stochastic subplot
    if (canStoch) {
      const idx = active.findIndex(s => s.name === 'stoch');
      const ya = `y${idx + 2}`;
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.stochastic_K), yaxis: ya, name: '%K', line: { color: '#3498db', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.stochastic_D), yaxis: ya, name: '%D', line: { color: '#e74c3c', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(() => 80), yaxis: ya, name: 'OB80', line: { color: '#e94560', width: 1, dash: 'dash' } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(() => 20), yaxis: ya, name: 'OS20', line: { color: '#2ecc71', width: 1, dash: 'dash' } });
    }

    // RSI subplot
    if (canRSI) {
      const idx = active.findIndex(s => s.name === 'RSI');
      const ya = `y${idx + 2}`;
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(d => d.rsi), yaxis: ya, name: 'RSI', line: { color: '#2ecc71', width: 1 } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(() => 70), yaxis: ya, name: 'OB70', line: { color: '#e94560', width: 1, dash: 'dash' } });
      traces.push({ type: 'scatter', mode: 'lines', x: dates, y: rows.map(() => 30), yaxis: ya, name: 'OS30', line: { color: '#2ecc71', width: 1, dash: 'dash' } });
    }

    // Signal arrows
    if (showSignals && signalField) {
      const buyX: string[] = [];
      const buyY: number[] = [];
      const sellX: string[] = [];
      const sellY: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const val = String(rows[i][signalField] || '').toLowerCase();
        if (val === 'buy' || val === 'long') {
          buyX.push(dates[i]);
          buyY.push(rows[i].low);
        } else if (val === 'sell' || val === 'short') {
          sellX.push(dates[i]);
          sellY.push(rows[i].high);
        }
      }
      if (buyX.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: buyX, y: buyY,
          name: 'Buy', marker: { symbol: 'triangle-up', color: '#2ecc71', size: 14, line: { color: '#fff', width: 1.5 } },
        });
      }
      if (sellX.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: sellX, y: sellY,
          name: 'Sell', marker: { symbol: 'triangle-down', color: '#e94560', size: 14, line: { color: '#fff', width: 1.5 } },
        });
      }
    }

    // Simulation trade markers (from analyze)
    if (simPoints.length > 0) {
      const simBuy = simPoints.filter(p => p.type === 'buy');
      const simSell = simPoints.filter(p => p.type === 'sell');
      const rising = simPoints.filter(p => p.type === 'rising');
      const falling = simPoints.filter(p => p.type === 'falling');
      if (simBuy.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: simBuy.map(p => p.x), y: simBuy.map(p => p.y),
          text: simBuy.map(p => p.label || 'Buy'),
          hovertemplate: '%{text}<extra></extra>',
          name: 'Sim Buy', marker: { symbol: 'triangle-up', color: '#2ecc71', size: 18, line: { color: '#fff', width: 2 } },
        });
      }
      if (simSell.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: simSell.map(p => p.x), y: simSell.map(p => p.y),
          text: simSell.map(p => p.label || 'Sell'),
          hovertemplate: '%{text}<extra></extra>',
          name: 'Sim Sell', marker: { symbol: 'triangle-down', color: '#e94560', size: 18, line: { color: '#fff', width: 2 } },
        });
      }
      if (rising.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: rising.map(p => p.x), y: rising.map(p => p.y),
          name: 'Rising', marker: { symbol: 'circle', color: '#f1c40f', size: 7, line: { color: '#f1c40f', width: 0 } },
        });
      }
      if (falling.length > 0) {
        traces.push({
          type: 'scatter', mode: 'markers', x: falling.map(p => p.x), y: falling.map(p => p.y),
          name: 'Falling', marker: { symbol: 'circle-open', color: '#f1c40f', size: 10, line: { color: '#f1c40f', width: 2 } },
        });
      }
    }

    // Evaluation dots (scheduler tactic checks)
    if (evalPoints.length > 0) {
      const evalNames: Record<string, string> = {
        '#e94560': 'Error',
        '#9090a8': 'Eval',
        '#f1c40f': 'Check',
      };
      const groups = new Map<string, typeof evalPoints>();
      for (const p of evalPoints) {
        const k = p.color || '#f1c40f';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
      }
      for (const [color, pts] of groups) {
        traces.push({
          type: 'scatter', mode: 'markers', x: pts.map(p => p.x), y: pts.map(p => p.y),
          text: pts.map(p => p.label),
          hovertemplate: '%{text}<extra></extra>',
          name: evalNames[color] || 'Eval',
          marker: { symbol: 'circle', size: 6, color, opacity: 0.85 },
        });
      }
    }

    // Y-axis range for candlestick
    const prices = rows.flatMap(d => [d.high, d.low]);
    const yMin = Math.min(...prices);
    const yMax = Math.max(...prices);
    const yPad = (yMax - yMin) * 0.05 || 10;

    const layout: any = {
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#16213e',
      font: { color: '#a0a0b0', size: 10 },
      margin: { l: 40, r: 10, t: 25, b: 80 },
      dragmode: 'zoom',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.25, font: { size: 9 } },
      xaxis: { gridcolor: '#2a2a4a', zerolinecolor: '#2a2a4a', type: 'category', tickangle: -45, tickfont: { size: 8 } },
      yaxis: { domain: candleDomain, gridcolor: '#2a2a4a', zerolinecolor: '#2a2a4a', range: [yMin - yPad, yMax + yPad], autorange: false },
    };

    for (let i = 0; i < n; i++) {
      const axisNum = i + 2;
      setAxis(layout, axisNum, yDomains[i], active[i].range, i === n - 1);
      const yk = `yaxis${axisNum}`;
      layout[yk].title = { text: active[i].name, font: { size: 10, color: '#a0a0b0' }, standoff: 4 };
    }

    Plotly.react(container, traces, layout, { responsive: true, displayModeBar: false });
  }

  function setAxis(layout: any, num: number, domain: [number, number], range: [number, number] | undefined, showX: boolean) {
    const yk = `yaxis${num}`;
    const xk = `xaxis${num}`;
    layout[yk] = { domain, gridcolor: '#2a2a4a', zerolinecolor: '#2a2a4a' };
    if (range) layout[yk].range = range;
    layout[xk] = { matches: 'x', anchor: yk, showticklabels: showX, gridcolor: '#2a2a4a', tickangle: -45, tickfont: { size: 8 } };
  }

  onMount(() => {
    tick().then(plot);
    const ro = new ResizeObserver(() => { if (container) plot(); });
    ro.observe(container);
    return () => ro.disconnect();
  });

  $: {
    showSignals; signalField; simPoints; showIndicators; evalPoints;
    if (rows.length > 0) tick().then(plot);
  }
</script>

<div bind:this={container} class="chart" style="width:1600px;height:1960px;min-height:1960px;"></div>
