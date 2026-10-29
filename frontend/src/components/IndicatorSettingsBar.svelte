<script lang="ts">
  import { upsertAdjustment } from '../db/indicator_adjustments';
  import { tableForInterval } from '../db/analyzed';

  export let interval: string;
  export let params: Record<string, number>;
  export let onChange: (params: Record<string, number>) => void;

  let open = false;

  const paramDefs: { group: string; key: string; label: string; def: number }[] = [
    { group: 'MACD', key: 'macd_fast', label: 'Fast', def: 12 },
    { group: 'MACD', key: 'macd_slow', label: 'Slow', def: 26 },
    { group: 'MACD', key: 'macd_signal', label: 'Signal', def: 9 },
    { group: 'RSI', key: 'rsi_period', label: 'Period', def: 14 },
    { group: 'RSI', key: 'rsi_short', label: 'Short', def: 4 },
    { group: 'RSI', key: 'rsi_middle', label: 'Middle', def: 7 },
    { group: 'RSI', key: 'rsi_long', label: 'Long', def: 10 },
    { group: 'MA', key: 'ma_short', label: 'Short', def: 3 },
    { group: 'MA', key: 'ma_middle', label: 'Middle', def: 4 },
    { group: 'MA', key: 'ma_long', label: 'Long', def: 7 },
    { group: 'EMA', key: 'ema_short', label: 'Short', def: 3 },
    { group: 'EMA', key: 'ema_middle', label: 'Middle', def: 4 },
    { group: 'EMA', key: 'ema_long', label: 'Long', def: 6 },
    { group: 'EMA', key: 'ema_primary', label: 'Primary', def: 14 },
    { group: 'SMA', key: 'sma_short', label: 'Short', def: 3 },
    { group: 'SMA', key: 'sma_long', label: 'Long', def: 7 },
    { group: 'HMA', key: 'hma_period', label: 'Period', def: 9 },
    { group: 'Bollinger Bands', key: 'bb_period', label: 'Period', def: 20 },
    { group: 'Bollinger Bands', key: 'bb_stddev', label: 'Std Dev', def: 2 },
    { group: 'Stochastic', key: 'stoch_length_rsi', label: 'RSI Length', def: 14 },
    { group: 'Stochastic', key: 'stoch_length_stoch', label: 'Stoch Length', def: 28 },
    { group: 'Stochastic', key: 'stoch_smooth_k', label: 'Smooth K', def: 14 },
    { group: 'Stochastic', key: 'stoch_smooth_d', label: 'Smooth D', def: 14 },
    { group: 'Trend', key: 'trend_lookback', label: 'Lookback', def: 3 },
  ];

  const groups = [...new Set(paramDefs.map(p => p.group))];

  function val(key: string, def: number): number {
    return params[key] ?? def;
  }

  function inpVal(e: Event): string { return (e.target as HTMLInputElement).value; }

  async function changeParam(key: string, raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    const def = paramDefs.find(p => p.key === key)?.def ?? 0;
    const updated = { ...params, [key]: v };
    const group = paramDefs.find(p => p.key === key)?.group ?? '';
    const groupKeys = paramDefs.filter(p => p.group === group).map(p => p.key);
    const groupParams: Record<string, number> = {};
    for (const gk of groupKeys) {
      groupParams[gk] = updated[gk] ?? def;
    }
    try {
      const tbl = tableForInterval(interval);
      await upsertAdjustment({ name: group, analyzed_table: tbl, params: JSON.stringify(groupParams) });
    } catch (e) {
      console.warn('save adjustment fail', e);
    }
    onChange(updated);
  }
</script>

<div class="settings-bar">
  <button class="toggle" on:click={() => open = !open}>
    <span class="arrow">{open ? '▼' : '▶'}</span>
    Indicator Parameters
    <span class="period-badge">{interval}</span>
  </button>

  {#if open}
    <div class="params-grid">
      {#each groups as group}
        <fieldset class="param-group">
          <legend>{group}</legend>
          {#each paramDefs.filter(p => p.group === group) as p}
            <label>
              <span class="param-label">{p.label}</span>
              <input
                type="number"
                value={val(p.key, p.def)}
                on:change={(e) => changeParam(p.key, inpVal(e))}
                step="any"
              />
            </label>
          {/each}
        </fieldset>
      {/each}
    </div>
  {/if}
</div>

<style>
  .settings-bar {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }
  .toggle {
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
  .toggle:hover { background: rgba(255,255,255,.04); }
  .arrow { font-size: 10px; color: var(--text-secondary); }
  .period-badge {
    font-size: 10px;
    background: var(--bg-card);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 700;
  }
  .params-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px;
    padding: 8px 16px 12px;
  }
  .param-group {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
  }
  .param-group legend {
    font-size: 10px;
    font-weight: 700;
    padding: 0 4px;
    color: var(--accent);
  }
  .param-label { font-size: 9px; }
  label {
    display: flex;
    flex-direction: column;
    font-size: 10px;
    color: var(--text-secondary);
    gap: 1px;
  }
  input {
    margin-top: 1px;
    color: #000;
    background: #fff;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #555;
    width: 100%;
    box-sizing: border-box;
    font-size: 11px;
  }
</style>
