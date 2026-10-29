<script lang="ts">
  import { onMount } from 'svelte';
  import { getAllAdjustments, getAdjustmentByName, upsertAdjustment, deleteAdjustment, type IndicatorAdjustment } from '../db/indicator_adjustments';
  import { tableForInterval } from '../db/analyzed';

  let adjustments: IndicatorAdjustment[] = [];
  let loading = true;
  let editing: { name: string; analyzed_table: string; params: string } | null = null;
  let editId: number | null = null;
  let saveMsg = '';

  const indicatorNames = ['MACD', 'RSI', 'MA', 'EMA', 'SMA', 'HMA', 'Bollinger Bands', 'Stochastic', 'Trend'];
  const timePeriods = ['1m','5m','15m','30m','1h','4h','8h','1d','3d','1w','1M'];

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

  onMount(load);

  async function load() {
    loading = true;
    try {
      adjustments = await getAllAdjustments();
    } catch (e) {
      console.warn('load adjustments fail', e);
    }
    loading = false;
  }

  function selVal(e: Event): string { return (e.target as HTMLSelectElement).value; }
  function inpVal(e: Event): string { return (e.target as HTMLInputElement).value; }

  function startNew() {
    const group = indicatorNames[0];
    const groupKeys = paramDefs.filter(p => p.group === group).map(p => p.key);
    const defaults: Record<string, number> = {};
    for (const k of groupKeys) {
      defaults[k] = paramDefs.find(p => p.key === k)?.def ?? 0;
    }
    editing = { name: group, analyzed_table: tableForInterval('1h'), params: JSON.stringify(defaults) };
    editId = null;
    saveMsg = '';
  }

  function startEdit(a: IndicatorAdjustment) {
    editing = { name: a.name, analyzed_table: a.analyzed_table, params: a.params };
    editId = a.id;
    saveMsg = '';
  }

  function getParamMap(): Record<string, number> {
    try { return JSON.parse(editing?.params || '{}'); } catch { return {}; }
  }

  function setParam(key: string, val: string) {
    const p = getParamMap();
    p[key] = parseFloat(val) || 0;
    if (editing) editing.params = JSON.stringify(p);
  }

  function onGroupChange(newGroup: string) {
    if (!editing) return;
    editing.name = newGroup;
    const groupKeys = paramDefs.filter(p => p.group === newGroup).map(p => p.key);
    const defaults: Record<string, number> = {};
    for (const k of groupKeys) {
      defaults[k] = paramDefs.find(p => p.key === k)?.def ?? 0;
    }
    editing.params = JSON.stringify(defaults);
    editing = { ...editing };
  }

  function cancelEdit() {
    editing = null;
    editId = null;
    saveMsg = '';
  }

  async function save() {
    if (!editing) return;
    try {
      await upsertAdjustment({
        id: editId || undefined,
        name: editing.name,
        analyzed_table: editing.analyzed_table,
        params: editing.params,
      });
      saveMsg = 'Saved';
      editing = null;
      editId = null;
      await load();
    } catch (e: any) {
      saveMsg = e?.message || 'Save failed';
    }
  }

  async function remove(id: number) {
    try {
      await deleteAdjustment(id);
      await load();
    } catch (e: any) {
      saveMsg = e?.message || 'Delete failed';
    }
  }
</script>

<div class="view">
  <div class="header">
    <h2>Indicator Settings</h2>
    <button on:click={startNew}>+ New Setting</button>
  </div>

  {#if editing}
    <div class="form-panel">
      <h2>{editId ? 'Edit' : 'New'} Setting</h2>
      <div class="form-grid">
        <label>
          Indicator
          <select value={editing.name} on:change={(e) => onGroupChange(selVal(e))}>
            {#each indicatorNames as g}
              <option value={g}>{g}</option>
            {/each}
          </select>
        </label>
        <label>
          Analyzed Table
          <select value={editing.analyzed_table} on:change={(e) => editing.analyzed_table = selVal(e)}>
            {#each timePeriods as tp}
              <option value={tableForInterval(tp)}>{tp} ({tableForInterval(tp)})</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="params-list">
        <h4>Parameters</h4>
        {#each paramDefs.filter(p => p.group === editing.name) as p}
          <label>
            {p.label} ({p.key})
            <input type="number" value={getParamMap()[p.key] ?? p.def} on:input={(e) => setParam(p.key, inpVal(e))} step="any" />
          </label>
        {/each}
      </div>

      <div class="form-actions">
        <button class="btn-save" on:click={save}>Save</button>
        <button on:click={cancelEdit}>Cancel</button>
        {#if saveMsg}<span class="ok">{saveMsg}</span>{/if}
      </div>
    </div>
  {/if}

  <div class="list-section">
    {#if loading}
      <p class="muted">Loading...</p>
    {:else if adjustments.length === 0}
      <p class="muted">No settings yet. Create one for each indicator + analyzed table.</p>
    {:else}
      {#each adjustments as s}
        <div class="card">
          <div class="card-body">
            <strong>{s.name}</strong>
            <span class="tag">{s.analyzed_table}</span>
            <div class="param-preview">
              {#each Object.entries(JSON.parse(s.params || '{}')) as [k, v]}
                <span class="param-chip">{k}: {v}</span>
              {/each}
            </div>
          </div>
          <div class="card-actions">
            <button on:click={() => startEdit(s)}>Edit</button>
            <button class="btn-del" on:click={() => remove(s.id)}>Delete</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .view { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; }
  .header h2 { margin: 0; font-size: 16px; }
  .form-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .form-panel h2 { margin: 0 0 12px; font-size: 16px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 12px; }
  label { display: flex; flex-direction: column; font-size: 12px; color: var(--text-secondary); gap: 2px; }
  input, select { margin-top: 2px; color: #000; background: #fff; padding: 4px 8px; border-radius: 4px; border: 1px solid #555; }
  .params-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .params-list h4 { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--accent); }
  .form-actions { display: flex; align-items: center; gap: 8px; }
  .btn-save { background: var(--accent-green); color: #000; }
  .ok { color: var(--accent-green); font-size: 12px; }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .list-section { display: flex; flex-direction: column; gap: 8px; }
  .card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .card-body { display: flex; flex-direction: column; gap: 4px; }
  .card-body strong { font-size: 14px; }
  .tag { font-size: 10px; background: var(--bg-card); color: var(--text-secondary); padding: 2px 6px; border-radius: 3px; }
  .param-preview { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .param-chip { font-size: 10px; background: #2a2a4a; color: #aaa; padding: 1px 5px; border-radius: 3px; }
  .card-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .btn-del { color: var(--accent); }
</style>
