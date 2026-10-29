<script lang="ts">
  import { onMount } from 'svelte';
  import { getTrades, deleteTrade, type Trade } from '../db/trades';

  let trades: Trade[] = [];
  let loading = false;
  let error = '';

  onMount(async () => {
    loading = true;
    error = '';
    try {
      trades = await getTrades();
    } catch (e: any) {
      error = e?.message || 'Failed to load trades';
      trades = [];
    }
    loading = false;
  });

  async function remove(id: number) {
    if (!confirm('Delete this trade?')) return;
    try {
      await deleteTrade(id);
      trades = await getTrades();
    } catch (e: any) {
      error = e?.message || 'Failed to delete';
    }
  }
</script>

<div class="view">
  <h2>Trades</h2>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if loading}
    <p class="muted">Loading...</p>
  {:else if trades.length === 0}
    <p class="muted">No trades recorded yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Pair</th>
          <th>Side</th>
          <th>Entry</th>
          <th>Exit</th>
          <th>Amount</th>
          <th>P&L</th>
          <th>Profit %</th>
          <th>Tactic</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each trades as t}
          <tr>
            <td>{t.buy_date?.slice(0, 10)}</td>
            <td>{t.currency}</td>
            <td class={t.side === 'sell' ? 'red' : 'green'}>{t.side === 'sell' ? 'SHORT' : 'LONG'}</td>
            <td>{t.buy_price?.toFixed(2)}</td>
            <td>{t.sell_price?.toFixed(2) ?? '—'}</td>
            <td>{t.amount?.toFixed(4)}</td>
            <td class={t.difference != null && t.difference > 0 ? 'green' : (t.difference != null && t.difference < 0 ? 'red' : '')}>
              {t.difference != null ? t.difference.toFixed(2) : '—'}
            </td>
            <td class={t.profit != null && t.profit > 0 ? 'green' : (t.profit != null && t.profit < 0 ? 'red' : '')}>
              {t.profit != null ? t.profit.toFixed(2) + '%' : '—'}
            </td>
            <td>{t.tactic_name || '-'}</td>
            <td><button class="btn-sm btn-danger" on:click={() => remove(t.id)}>Del</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .view { padding: 24px; }
  .view h2 { margin-bottom: 16px; font-size: 18px; }
  .muted { color: var(--text-secondary); }
  .error { color: var(--accent); margin-bottom: 12px; font-size: 13px; }
  .green { color: var(--accent-green); font-weight: 600; }
  .red { color: var(--accent); font-weight: 600; }
  .btn-sm { padding: 3px 10px; font-size: 11px; background: var(--bg-card); color: var(--text-primary); }
  .btn-danger { background: var(--accent); color: #fff; }
</style>
