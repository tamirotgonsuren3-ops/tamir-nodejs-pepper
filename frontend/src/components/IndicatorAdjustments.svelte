<script lang="ts">
  import { onMount } from 'svelte';
  import { getAllAdjustments, upsertAdjustment, deleteAdjustment, type IndicatorAdjustment } from '../db/indicator_adjustments';
  import { TABLE_NAMES } from '../db/schema';

  let adjustments: IndicatorAdjustment[] = [];
  let loading = true;
  let editing: Partial<IndicatorAdjustment> | null = null;
  let editId: number | null = null;
  let saveMsg = '';

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
    const params: Record<string, number> = {};
    paramDefs.forEach(p => params[p.key] = p.def);
    editing = { name: '', analyzed_table: 'analyzed15ms', params: JSON.stringify(params) };
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

  function cancelEdit() {
    editing = null;
    editId = null;
    saveMsg = '';
  }

  async function save() {
    if (!editing || !editing.name) { saveMsg = 'Name required'; return; }
    try {
      await upsertAdjustment({
        id: editId || undefined,
        name: editing.name,
        analyzed_table: editing.analyzed_table || 'analyzed15ms',
        params: editing.params || '{}',
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
    <h2>Indicator Adjustments</h2>
    <button on:click={startNew}>+ New Preset</button>
  </div>

  {#if editing}
    <div class="form-panel">
      <h2>{editId ? 'Edit' : 'New'} Preset</h2>
      <div class="form-grid">
        <label>Name
          <input value={editing.name} on:input={(e) => editing.name = inpVal(e)} />
        </label>
        <label>Table
          <select value={editing.analyzed_table} on:change={(e) => editing.analyzed_table = selVal(e)}>
            {#each TABLE_NAMES.filter(t => t.startsWith('analyzed')) as tn}
              <option value={tn}>{tn}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="params-grid">
        {#each groups as group}
          <fieldset class="param-group">
            <legend>{group}</legend>
            {#each paramDefs.filter(p => p.group === group) as p}
              <label>
                <span class="param-label">{p.label} ({p.key})</span>
                <input type="number" value={getParamMap()[p.key] ?? p.def} on:input={(e) => setParam(p.key, inpVal(e))} />
              </label>
            {/each}
          </fieldset>
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
      <p class="muted">No presets yet.</p>
    {:else}
      {#each adjustments as a}
        <div class="card">
          <div class="card-body">
            <strong>{a.name}</strong>
            <span class="tag">{a.analyzed_table}</span>
            <div class="param-preview">
              {#each Object.entries(JSON.parse(a.params || '{}')) as [k, v]}
                <span class="param-chip">{k}: {v}</span>
              {/each}
            </div>
          </div>
          <div class="card-actions">
            <button on:click={() => startEdit(a)}>Edit</button>
            <button class="btn-del" on:click={() => remove(a.id)}>Delete</button>
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
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 16px; }
  label { display: flex; flex-direction: column; font-size: 12px; color: var(--text-secondary); gap: 2px; }
  input, select { margin-top: 2px; color: #000; background: #fff; padding: 4px 8px; border-radius: 4px; border: 1px solid #555; }
  .params-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px; }
  .param-group { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; }
  .param-group legend { font-size: 11px; font-weight: 700; padding: 0 4px; color: var(--accent); }
  .param-label { font-size: 10px; }
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
