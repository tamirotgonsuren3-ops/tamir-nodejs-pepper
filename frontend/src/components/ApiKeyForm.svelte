<script lang="ts">
  import { initBinanceClient, testConnection } from '../lib/wails';

  let apiKey = '';
  let secretKey = '';
  let connecting = false;
  let connected = false;
  let error = '';
  let balance: { asset: string; free: number; locked: number } | null = null;

  async function connect() {
    connecting = true;
    error = '';
    try {
      await initBinanceClient(apiKey, secretKey);
      const bal = await testConnection();
      connected = true;
      balance = bal;
    } catch (e: any) {
      error = e.message || 'Connection failed';
    } finally {
      connecting = false;
    }
  }

  export function isConnected() { return connected; }
</script>

<div class="api-form">
  <h3>API Connection</h3>
  {#if !connected}
    <input bind:value={apiKey} placeholder="BINANCE_API_KEY" type="password" />
    <input bind:value={secretKey} placeholder="BINANCE_API_SECRET" type="password" />
    <button on:click={connect} disabled={connecting}>
      {connecting ? 'Connecting...' : 'Connect'}
    </button>
    {#if error}<p class="error">{error}</p>{/if}
  {:else}
    <div class="connected">
      <span class="badge ok">Connected</span>
      {#if balance}
        <p>{balance.asset}: {balance.free.toFixed(4)} (locked: {balance.locked.toFixed(4)})</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .api-form { padding: 16px; }
  .api-form input { display: block; width: 100%; margin-bottom: 8px; }
  .api-form button { width: 100%; }
  .error { color: var(--accent); font-size: 12px; margin-top: 6px; }
  .connected p { font-size: 13px; margin-top: 8px; }
  .badge.ok { background: var(--accent-green); color: #000; padding: 2px 10px; border-radius: 3px; font-size: 12px; font-weight: 700; }
</style>
