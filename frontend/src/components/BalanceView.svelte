<script lang="ts">
  import { onMount } from 'svelte';
  import { getBalance } from '../lib/wails';
  import { exchange } from '../lib/exchange';

  export let symbol = 'ETHUSDT';

  let balances: { asset: string; free: number; locked: number }[] = [];
  let loading = false;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const usdt = await getBalance('USDT');
      const eth = await getBalance('ETH');
      const btc = await getBalance('BTC');
      balances = [
        { asset: 'USDT', free: usdt, locked: 0 },
        { asset: 'ETH', free: eth, locked: 0 },
        { asset: 'BTC', free: btc, locked: 0 },
      ];
    } catch (e: any) {
      error = e.message || 'Failed to load balances';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="view">
  <h2>Balance</h2>
  {#if $exchange === 'pepperstone'}
    <p class="muted">
      Pepperstone uses margin-based forex accounts. Live account balance is
      queried through the cTrader FIX bridge and is not surfaced here; use
      <code>trade_ejtrader_ct.py</code> / cTrader to inspect balances. Sizing is
      done in lots, not USDT.
    </p>
  {:else if loading}
    <p class="muted">Loading...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <table>
      <thead><tr><th>Asset</th><th>Free</th></tr></thead>
      <tbody>
        {#each balances as b}
          <tr>
            <td><strong>{b.asset}</strong></td>
            <td>{b.free.toFixed(4)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="btn-refresh" on:click={load}>Refresh</button>
  {/if}
</div>

<style>
  .view { padding: 24px; }
  .view h2 { margin-bottom: 16px; font-size: 18px; }
  table { max-width: 400px; }
  .muted { color: var(--text-secondary); }
  .error { color: var(--accent); font-size: 13px; }
  .btn-refresh { margin-top: 12px; background: var(--bg-card); color: #fff; }
</style>
