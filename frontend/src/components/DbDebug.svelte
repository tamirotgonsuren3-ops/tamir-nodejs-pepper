<script lang="ts">
  import { onMount } from 'svelte';
  import { dbTables, dbQuery } from '../lib/wails';

  let tables: { name: string; rows: any[]; count: number }[] = [];
  let dbgError = '';

  onMount(async () => {
    try {
      const names = await dbTables();
      const result = [];
      for (const name of names) {
        try {
          const rows = await dbQuery(`SELECT * FROM ${name} LIMIT 20`);
          result.push({ name, rows, count: rows.length });
        } catch (e: any) {
          result.push({ name, rows: [], count: 0 });
        }
      }
      tables = result;
    } catch (e: any) {
      dbgError = e?.message || String(e);
    }
  });
</script>

<div class="view">
  <h2>Database Debug</h2>
  {#if dbgError}
    <div class="error-banner">Error: {dbgError}</div>
  {/if}
  {#each tables as t}
    <details>
      <summary><strong>{t.name}</strong> ({t.count} rows)</summary>
      {#if t.rows.length > 0}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                {#each Object.keys(t.rows[0]) as col}
                  <th>{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each t.rows as row}
                <tr>
                  {#each Object.keys(t.rows[0]) as col}
                    <td class="mono">{String(row[col] ?? '')}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">(empty)</p>
      {/if}
    </details>
  {/each}
</div>

<style>
  .view { padding: 16px; }
  .view h2 { margin-bottom: 12px; font-size: 16px; }
  details { margin-bottom: 8px; }
  summary { cursor: pointer; padding: 4px 0; }
  pre { font-size: 11px; max-height: 400px; overflow: auto; background: #111; padding: 8px; border-radius: 4px; }
  .table-wrap { overflow-x: auto; max-height: 400px; overflow-y: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 4px 8px; border: 1px solid var(--border); white-space: nowrap; }
  th { background: var(--bg-card); color: var(--text-secondary); font-weight: 600; position: sticky; top: 0; }
  .mono { font-family: monospace; }
  .muted { color: var(--text-secondary); font-size: 12px; }
</style>
