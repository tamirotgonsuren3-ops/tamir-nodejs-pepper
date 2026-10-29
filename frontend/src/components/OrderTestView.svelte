<script lang="ts">
  import { onMount } from 'svelte';
  import {
    executeMarketOrderQuote,
    executeLimitOrder,
    getOpenOrdersList,
    getAllOrdersList,
    saveOrdersCsv,
    getLatestPrice,
    getBalance,
  } from '../lib/wails';
  import { exchange, symbolsFor } from '../lib/exchange';
  import type { models } from '../lib/wails';

  let orders: models.OrderInfo[] = [];
  let loading = false;
  let error = '';
  let success = '';

  // form
  let symbol = 'ETHUSDT';
  let usdtAmount = '20';
  let action = 'buy';
  let orderType = 'market';
  let limitPrice = '';

  // result
  let lastOrder: models.OrderResult | null = null;

  $: symbols = symbolsFor($exchange);
  $: if (!symbols.includes(symbol)) symbol = symbols[0];
  $: isPs = $exchange === 'pepperstone';
  $: if ($exchange === 'pepperstone' && orderType === 'limit') orderType = 'market';

  onMount(() => fetchOrders());

  async function fetchOrders() {
    loading = true;
    error = '';
    try {
      const o = await getAllOrdersList(symbol);
      orders = o;
    } catch (err: any) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  async function placeOrder() {
    error = '';
    success = '';
    lastOrder = null;
    loading = true;
    try {
      if (orderType === 'limit' && isPs) {
        throw new Error('Limit orders are not supported for Pepperstone (market only)');
      }
      const qtyStr = String(usdtAmount);
      if (orderType === 'market') {
        const res = await executeMarketOrderQuote(symbol, action, qtyStr);
        lastOrder = res;
      } else {
        const priceStr = String(limitPrice);
        if (!priceStr) throw new Error('Limit price required for limit orders');
        const price = parseFloat(priceStr);
        const coinQty = parseFloat(qtyStr) / price;
        const res = await executeLimitOrder(symbol, action, coinQty.toFixed(6), priceStr);
        lastOrder = res;
      }
      success = isPs
        ? `Order placed: ${lastOrder.status} (lot ${lastOrder.quantity})`
        : `Order placed: ${lastOrder.status} (ID: ${lastOrder.order_id})`;
      await fetchOrders();
    } catch (err: any) {
      error = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  async function handleSaveCsv() {
    try {
      const path = await saveOrdersCsv(symbol);
      success = `Orders saved to ${path}`;
    } catch (err: any) {
      error = err?.message || String(err);
    }
  }
</script>

<div class="view">
  <div class="panel">
    <h2>Order Test</h2>
    <p class="sub">Place test orders manually using your connection.</p>

    <div class="form-grid">
      <label>Symbol
        <select bind:value={symbol}>
          {#each symbols as s}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
      <label>{isPs ? 'Lots' : 'USDT Amount'}
        <input type="number" bind:value={usdtAmount} step={isPs ? '0.01' : '1'} min={isPs ? '0.01' : '1'} />
      </label>
      <label>Action
        <select bind:value={action}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </label>
      <label>Order Type
        <select bind:value={orderType} disabled={isPs}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </label>
      {#if orderType === 'limit' && !isPs}
        <label>Limit Price (USDT)
          <input type="number" bind:value={limitPrice} step="0.01" min="0" />
        </label>
      {/if}
    </div>

    <div class="actions">
      <button class="btn-order" on:click={placeOrder} disabled={loading}>
        {loading ? 'Placing...' : `Place ${orderType === 'market' ? 'Market' : 'Limit'} ${action === 'buy' ? 'Buy' : 'Sell'} Order`}
      </button>
      <button on:click={fetchOrders} disabled={loading}>Refresh Orders</button>
    </div>

    {#if error}
      <div class="error-msg">{error}</div>
    {/if}
    {#if success}
      <div class="success-msg">{success}</div>
    {/if}

    {#if lastOrder}
      <div class="result-box">
        <strong>Last Order Result</strong>
        <span>Status: {lastOrder.status}</span>
        <span>Order ID: {lastOrder.order_id}</span>
        <span>Quantity: {lastOrder.quantity}</span>
        <span>Avg Price: {lastOrder.price?.toFixed(2)}</span>
      </div>
    {/if}
  </div>

  <div class="panel">
    <div class="panel-header">
      <h2>Orders ({symbol})</h2>
      <button class="btn-csv" on:click={handleSaveCsv}>Save as CSV</button>
    </div>

    {#if loading && orders.length === 0}
      <p class="muted">Loading...</p>
    {:else if orders.length === 0}
      <p class="muted">No orders found.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Side</th>
              <th>Type</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Executed</th>
              <th>Quote</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {#each orders as o}
              <tr>
                <td class="mono">{o.order_id}</td>
                <td class:buy={o.side === 'BUY'} class:sell={o.side === 'SELL'}>{o.side}</td>
                <td>{o.type}</td>
                <td class="mono">{o.price?.toFixed(2) || '-'}</td>
                <td class="mono">{o.quantity?.toFixed(6)}</td>
                <td class="mono">{o.executed_qty?.toFixed(6)}</td>
                <td class="mono">{o.quote_qty?.toFixed(2)}</td>
                <td>{o.status}</td>
                <td class="mono">{o.time ? new Date(o.time).toLocaleString() : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .view { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .panel h2 { margin: 0 0 4px; font-size: 16px; }
  .panel .sub { color: var(--text-secondary); font-size: 12px; margin-bottom: 16px; }
  .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .panel-header h2 { margin: 0; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px; margin-bottom: 12px; }
  label { display: block; font-size: 12px; color: var(--text-secondary); }
  input, select { margin-top: 2px; color: #000; background: #fff; width: 100%; box-sizing: border-box; padding: 4px 8px; border-radius: 4px; border: 1px solid #555; }
  .actions { display: flex; gap: 8px; margin-bottom: 8px; }
  .btn-order { background: var(--accent); color: #fff; }
  .btn-csv { background: transparent; color: var(--accent-green); border: 1px solid var(--accent-green); }
  .error-msg { background: rgba(255,60,60,.12); color: var(--accent); padding: 8px 12px; border-radius: 4px; font-size: 12px; margin-bottom: 8px; }
  .success-msg { background: rgba(0,200,80,.12); color: var(--accent-green); padding: 8px 12px; border-radius: 4px; font-size: 12px; margin-bottom: 8px; }
  .result-box { background: var(--bg-card); border-radius: 6px; padding: 12px; display: flex; gap: 16px; font-size: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--text-secondary); font-weight: 600; }
  .mono { font-family: monospace; font-size: 11px; }
  .buy { color: var(--accent-green); font-weight: 700; }
  .sell { color: var(--accent); font-weight: 700; }
</style>
