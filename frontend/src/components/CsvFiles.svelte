<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsvFiles, readCsvFile } from '../lib/wails';

  let files: string[] = [];
  let loading = false;
  let selected = '';
  let content: string[][] = [];
  let headers: string[] = [];

  onMount(load);

  async function load() {
    loading = true;
    try {
      files = await getCsvFiles();
    } catch (e) {
      files = [];
    } finally {
      loading = false;
    }
  }

  async function select(file: string) {
    selected = file;
    content = [];
    headers = [];
    try {
      const raw = await readCsvFile(file);
      const lines = raw.split('\n').filter(l => l.trim());
      if (lines.length === 0) return;
      headers = parseLine(lines[0]);
      content = lines.slice(1).map(parseLine);
    } catch (e) {
      content = [];
    }
  }

  const signalCols = new Set(['macd_trade','rsi_trade','stochastic_trade','ema_trade','sma_trade','ma_trade','trade']);

  $: signalIndices = headers.map((h, i) => signalCols.has(h) ? i : -1).filter(i => i >= 0);

  function cellClass(hdrIdx: number, val: string): string {
    if (!signalCols.has(headers[hdrIdx])) return '';
    const v = val.toLowerCase();
    if (v === 'buy' || v === 'long') return 'buy';
    if (v === 'sell' || v === 'short') return 'sell';
    return '';
  }

  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
      current += ch;
    }
    result.push(current);
    return result;
  }
</script>

<div class="view">
  <div class="header">
    <h2>CSV Files</h2>
    <button on:click={load}>Refresh</button>
  </div>
  <p class="sub">Click a file to view its contents.</p>

  {#if loading}
    <p class="muted">Loading...</p>
  {:else if files.length === 0}
    <p class="muted">No CSV files yet. Fetch some chart data first.</p>
  {:else}
    <div class="file-list">
      {#each files as f}
        <button
          class="file-item {selected === f ? 'active' : ''}"
          on:click={() => select(f)}>{f}</button>
      {/each}
    </div>
  {/if}

  {#if content.length > 0}
    <div class="csv-content">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each headers as h}
                <th>{h}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each content as row}
              <tr>
                {#each row as cell, ci}
                  <td class={cellClass(ci, cell)}>{cell}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .view { padding: 24px; display: flex; flex-direction: column; height: 100%; }
  .view h2 { margin: 0; font-size: 18px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .sub { color: var(--text-secondary); font-size: 12px; margin-bottom: 12px; }
  .muted { color: var(--text-secondary); }

  .file-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .file-item {
    background: var(--bg-card); color: var(--text-primary);
    padding: 6px 12px; border-radius: 4px; font-size: 12px;
    font-family: monospace;
  }
  .file-item.active { background: var(--accent); color: #fff; }

  .csv-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
  .table-wrap { overflow: auto; flex: 1; }
  .table-wrap table { font-size: 11px; }
  .table-wrap td { font-family: monospace; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.buy { color: #2ecc71; font-weight: 700; }
  td.sell { color: #e94560; font-weight: 700; }
</style>
