<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getTaskStats, getDailyStats, getHourlyStats, getStatsFilterOptions, rollUpTotals, getFilteredTrades,
    type StatsFilter, type TaskStats, type DayStats, type HourStats, type StatsTotals,
  } from '../db/trade_stats';
  import { getOpenTrades, updateTradeSell, type Trade } from '../db/trades';
  import { getScheduleTasks, type ScheduleTask } from '../db/schedule';
  import { insertScheduleLog } from '../db/schedule_logs';
  import { loadParamsForTable } from '../db/indicator_adjustments';
  import { tableForInterval } from '../db/analyzed';
  import {
    listPepperstonePositions, closePepperstonePosition, fetchAndAnalyzeWithParams, getLatestPrice,
    setExchangeConfig, pepperstoneBrokerStatus, evaluateOpenTrends, errMsg,
  } from '../lib/wails';
  import { exchange, environment } from '../lib/exchange';
  import { getApiKey } from '../db/api_keys';
  import { periodFromTable } from '../lib/task_criteria';
  import CandleChart from './CandleChart.svelte';

  let fTask = '';
  let fCurrency = '';
  let fFrom = '';
  let fTo = '';

  let taskOpts: string[] = [];
  let currencyOpts: string[] = [];

  let tasks: TaskStats[] = [];
  let days: DayStats[] = [];
  let hours: HourStats[] = [];
  let totals: StatsTotals = rollUpTotals([]);

  let loading = true;
  let error = '';
  let sortKey: keyof TaskStats = 'total_pnl';
  let sortDir: 1 | -1 = -1;

  // P&L is stored in the quote currency on Binance but in price-points on
  // Pepperstone (lots are the unit), so the unit label follows the account.
  $: isPs = $exchange === 'pepperstone';
  $: pnlUnit = isPs ? 'pts' : 'USDT';
  $: amtUnit = isPs ? 'lots' : 'USDT';

  // One row per open BROKER position: the broker is the authority on what is
  // actually exposed, so a position the app has no trades row for still shows up
  // (trade === null) instead of silently vanishing from the page. A trades row
  // with no live position is kept too (pos === null) so a stale database row
  // cannot read as "closed".
  //
  // How a row's position was attributed decides whether a close is safe:
  //   'position_id' — the trades row names this exact broker position
  //   'unique'       — only one row and one position share the pair+side
  //   'ambiguous'    — several identical candidates; attributed to keep the
  //                    position visible, but never auto-closed
  //   'none'         — nothing on the broker backs this row
  type PosMatch = 'position_id' | 'unique' | 'ambiguous' | 'none';

  interface TrendRow {
    key: string;
    trade: Trade | null;
    task: ScheduleTask | null;
    pos: any | null;
    matchKind: PosMatch;
    mark: number | null;
    finished: boolean;
    note: string;
    result: string;
  }

  let trends: TrendRow[] = [];
  let trendsLoading = false;
  let trendsError = '';
  let closing = false;
  let closeMsg = '';

  // How the Go side wired the broker up, so a broken connection can be traced
  // without guessing: it reports the scripts dir and interpreter it resolved.
  let broker: { initialized: boolean; dir: string; python: string; script: string; environment: string; error: string } | null = null;

  async function loadBrokerStatus() {
    try {
      broker = await pepperstoneBrokerStatus();
    } catch (e: any) {
      broker = { initialized: false, dir: '', python: '', script: '', environment: '', error: errMsg(e, 'unknown error') };
    }
  }

  $: filter = (): StatsFilter => ({
    taskName: fTask || undefined,
    currency: fCurrency || undefined,
    from: fFrom || undefined,
    to: fTo || undefined,
  });

  $: finishedCount = trends.filter((r) => r.finished).length;

  // Broker P/L across every open position, so the footer total can be compared
  // against the broker's own figure. Untracked positions count here too.
  $: trendPnlTotal = () =>
    trends.reduce((a, r) => a + (typeof r.pos?.pl_base === 'number' ? r.pos.pl_base : 0), 0);

  onMount(async () => {
    await loadOptions();
    await load();
    await loadTrends();
  });

  async function loadOptions() {
    try {
      const o = await getStatsFilterOptions();
      taskOpts = o.tasks;
      currencyOpts = o.currencies;
    } catch (e: any) {
      error = errMsg(e, 'Failed to load filter options');
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const f = filter();
      [tasks, days, hours] = await Promise.all([
        getTaskStats(f),
        getDailyStats(f),
        getHourlyStats(f),
      ]);
      totals = rollUpTotals(tasks);
    } catch (e: any) {
      error = errMsg(e, 'Failed to load statistics');
      tasks = []; days = []; hours = [];
      totals = rollUpTotals([]);
    }
    loading = false;
  }

  // The task that opened a trade: same task name AND same analyzed table
  // (timeframe), which is exactly how the trade row was stamped on entry.
  // An ambiguous pair is not resolved — guessing between two tasks that share a
  // name and timeframe could close the wrong position.
  function matchTask(all: ScheduleTask[], tr: Trade): ScheduleTask | null {
    const named = all.filter((t) => t.task_name === (tr.tactic_name || ''));
    if (named.length === 0) return null;
    const period = tr.period || '';
    // A legacy row that carries no timeframe can only be resolved by name.
    if (!period) return named.length === 1 ? named[0] : null;
    const hits = named.filter((t) => periodFromTable(t.analyzed_table_name) === period);
    return hits.length === 1 ? hits[0] : null;
  }

  // Whether a trend has finished is decided in Go (EvaluateOpenTrends) using the
  // exact rule the engine reverses on, so this page and the trading loop can
  // never disagree. The page keeps only the display pairing below.
  function trendVerdict(map: Map<number, { finished: boolean; note: string }>, tr: Trade): { finished: boolean; note: string } {
    return map.get(tr.id) ?? { finished: false, note: 'no candle data' };
  }

  const posSide = (p: any) => String(p.side || '').toLowerCase();
  const posSym = (p: any) => String(p.symbol || '').toUpperCase();
  const posKey = (p: any) => `${posSym(p)}|${posSide(p)}`;

  // Pair each open trades row with a broker position.
  //
  // A recorded position_id is authoritative and final: that row is matched to
  // exactly that position or to nothing. In particular a row whose position_id is
  // no longer on the broker stays unmatched instead of adopting a different live
  // position on the same pair — a close would then hit a position the row never
  // opened. Only rows with no position_id fall back to pair+side matching, and
  // they draw from positions no id-matched row has already claimed, so a position
  // is never attributed twice (which would double-count it against the footer
  // total and hide a real one).
  //
  // Within that fallback, one row and one candidate is certain; several is not,
  // so those pair up in age order — enough to keep every position visible — and
  // are flagged 'ambiguous', which the close path refuses to act on. The previous
  // code dropped the match entirely in that case, which is what hid positions.
  function pairTradesToPositions(
    trades: Trade[],
    positions: any[]
  ): { trade: Trade; pos: any | null; matchKind: PosMatch }[] {
    const claimed = new Set<string>();
    const out: { trade: Trade; pos: any | null; matchKind: PosMatch }[] = [];
    const byKey = new Map<string, Trade[]>();

    for (const tr of trades) {
      if (tr.position_id) {
        const hit = positions.find((p) => String(p.pos_id) === tr.position_id);
        if (hit) claimed.add(String(hit.pos_id));
        out.push({
          trade: tr,
          pos: hit || null,
          matchKind: hit ? 'position_id' : 'none',
        });
        continue;
      }
      const key = `${String(tr.currency || '').toUpperCase()}|${tr.side === 'sell' ? 'sell' : 'buy'}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(tr);
    }

    for (const [key, rows] of byKey) {
      const [sym, side] = key.split('|');
      for (const tr of rows) {
        // Recomputed per row, not once per group: each match in this loop claims
        // a position, and the next row must not see that one as a candidate. A
        // position claimed twice would be counted twice in the footer total and
        // hidden behind the wrong P/L.
        const pool = positions.filter(
          (p) => posSym(p) === sym && posSide(p) === side && !claimed.has(String(p.pos_id))
        );
        // Same pair and side are already guaranteed by the key. Lot size is a
        // hard requirement, not a preference: a 0.01 trade must never adopt a
        // 0.02 position just because it happens to be the only candidate on that
        // pair — closing that would close three times the intended exposure.
        const wantLots = Number(tr.amount) || 0;
        const sized = wantLots > 0
          ? pool.filter((p) => Math.abs((Number(p.lots) || 0) - wantLots) < 1e-6)
          : pool;

        if (sized.length === 0) {
          out.push({ trade: tr, pos: null, matchKind: 'none' });
          continue;
        }
        if (sized.length === 1) {
          claimed.add(String(sized[0].pos_id));
          out.push({ trade: tr, pos: sized[0], matchKind: 'unique' });
          continue;
        }

        // Several same-size candidates: only the recorded fill time can separate
        // them, and only if every one of them is actually dated. The broker sends
        // no open time, so an undated candidate means we are guessing, and a tie
        // is left unattached rather than broken arbitrarily.
        const ranked = sized
          .map((p) => ({ pos: p, gapMin: fillGapMin(p.opened_at, tr.buy_date) }))
          .sort((a, b) => {
            if (a.gapMin == null && b.gapMin == null) return 0;
            if (a.gapMin == null) return 1;
            if (b.gapMin == null) return -1;
            return a.gapMin - b.gapMin;
          });

        const winner = ranked[0];
        const runnerUp = ranked[1];
        const decisive =
          winner.gapMin != null && runnerUp.gapMin != null
          ? winner.gapMin < runnerUp.gapMin
          : winner.gapMin != null && runnerUp.gapMin == null;

        if (decisive) {
          claimed.add(String(winner.pos.pos_id));
          out.push({ trade: tr, pos: winner.pos, matchKind: 'unique' });
        } else {
          // Leave every candidate unclaimed: they resurface as untracked rows,
          // each with its own Close trade button, instead of one of them being
          // silently assigned to this trade.
          out.push({ trade: tr, pos: null, matchKind: 'ambiguous' });
        }
      }
    }

    return out;
  }

  // Minutes between a broker position's fill and a recorded trade's time, or null
  // when either is unknown or they are too far apart to be the same fill.
  // Pepperstone reports no open time for a position, so `opened_at` is our own
  // record from when this app opened it.
  const fillGapMin = (openedAt: string | null | undefined, buyDate: string | null | undefined) => {
    const posAt = Date.parse(String(openedAt || ''));
    const trAt = Date.parse(String(buyDate || ''));
    if (isNaN(posAt) || isNaN(trAt)) return null;
    const gap = Math.abs(trAt - posAt) / 60000;
    return gap <= 60 ? gap : null;
  };

  async function ensureBroker() {
    // The Go side auto-detects the scripts dir, but it only does so once the
    // exchange is known to be Pepperstone. Push the stored settings first so a
    // visit that races the app-level connection handshake cannot fail.
    const dir = (await getApiKey('pepperstone_dir')) || '';
    await setExchangeConfig('pepperstone', $environment, dir);
  }

  async function loadTrends() {
    if (!isPs) return;
    trendsLoading = true;
    trendsError = '';
    try {
      await loadBrokerStatus();
      let positions: any[] | null = null;
      let posErr = '';
      try {
        positions = await listPepperstonePositions();
      } catch (e: any) {
        posErr = errMsg(e, 'could not read broker positions');
        // One retry after (re)applying the exchange settings: the broker is
        // built lazily on the Go side and may not have been wired up yet.
        try {
          await ensureBroker();
          positions = await listPepperstonePositions();
          posErr = '';
        } catch (e2: any) {
          posErr = errMsg(e2, posErr);
        }
        await loadBrokerStatus();
      }

      const [openRows, sched] = await Promise.all([
        getOpenTrades(),
        getScheduleTasks(),
      ]);
      const posList = positions || [];
      const out: TrendRow[] = [];
      // Keep the outcome of the last close attempt for trades that are still
      // open, so a failure stays visible after the refresh.
      const prevResults = new Map<number, string>(trends.map((r) => [r.trade ? r.trade.id : -1, r.result]));

      const openSorted = [...(openRows || [])].sort((a, b) => String(a.buy_date).localeCompare(String(b.buy_date)));
      const pairs = pairTradesToPositions(openSorted, posList);
      const claimed = new Set(pairs.filter((p) => p.pos).map((p) => String(p.pos.pos_id)));

      // The trend verdict comes from Go — the very rule the engine reverses on —
      // keyed by trade id. This page only pairs it with broker positions.
      const verdicts = new Map<number, { finished: boolean; note: string }>();
      const marks = new Map<number, number | null>();
      try {
        for (const ev of await evaluateOpenTrends()) {
          verdicts.set(ev.trade_id, { finished: ev.finished, note: ev.note });
          marks.set(ev.trade_id, ev.mark ?? null);
        }
      } catch (e: any) {
        trendsError = errMsg(e, trendsError);
      }

      // Oldest first: the trend that has been running longest is closed first.
      for (const { trade: tr, pos, matchKind } of pairs) {
        const task = matchTask(sched, tr);
        const state = trendVerdict(verdicts, tr);
        out.push({
          key: `t${tr.id}`,
          trade: tr,
          task,
          pos,
          matchKind,
          mark: marks.get(tr.id) ?? null,
          finished: state.finished,
          note: state.note,
          result: prevResults.get(tr.id) || '',
        });
      }

      // Every remaining broker position is real exposure with no trades row of
      // its own. It is listed so the page total matches the broker; it carries no
      // task, so it is shown for review and never swept up by a bulk close.
      for (const p of posList) {
        if (claimed.has(String(p.pos_id))) continue;
        out.push({
          key: `p${p.pos_id}`,
          trade: null,
          task: null,
          pos: p,
          matchKind: 'none',
          mark: null,
          finished: false,
          note: 'untracked position',
          result: '',
        });
      }

      trends = out;
      // Positions are what tells a live trade from a stale database row, so
      // say so instead of silently showing everything as unfinished. An empty
      // read that returned no rows is itself suspicious enough to say out loud.
      const total = posList.length + openSorted.length;
      trendsError = posErr
        ? `Broker positions unavailable: ${posErr}`
        : positions && total === 0
          ? 'Broker reported no open positions. If that is wrong, the position snapshot may not have arrived — retry.'
          : '';
    } catch (e: any) {
      trendsError = errMsg(e, 'Failed to load open trades');
      trends = [];
    }
    trendsLoading = false;
  }

  function logBase(r: TrendRow) {
    return {
      task_id: r.task?.id ?? 0,
      task_name: r.trade?.tactic_name || '',
      currency: r.trade?.currency || posSym(r.pos),
      interval: r.trade?.period || '',
      analyzed_table: r.task?.analyzed_table_name || '',
      balance: '',
      criteria_info: JSON.stringify([{ al: 'trend', a: r.note }]),
      indicators: '',
      trade_amount: `${r.trade?.amount ?? r.pos?.lots ?? 0} lots`,
    };
  }

  async function closePrice(symbol: string): Promise<number> {
    try {
      const p = await getLatestPrice(symbol);
      return p > 0 ? p : 0;
    } catch {
      return 0;
    }
  }

  // Close every trade whose trend has ended, oldest first. A trend still
  // running is skipped, not a stop signal: one fresh trade must not hold the
  // older finished ones hostage.
  async function closeFinished() {
    const targets = trends.filter((r) => r.finished);
    if (targets.length === 0) return;
    if (!confirm(`Close ${targets.length} finished trend(s) on Pepperstone, oldest first?`)) return;

    closing = true;
    closeMsg = '';
    let done = 0;
    let failed = 0;

    for (const r of targets) {
      const tr = r.trade;
      // Close the position the broker actually reports for this trade. A trade
      // whose position cannot be attributed to exactly one broker position is
      // never closed here — an ambiguous pairing would risk closing a neighbour's
      // position on the same pair and side.
      if (!r.pos || r.matchKind === 'ambiguous') {
        r.result = r.matchKind === 'ambiguous'
          ? 'ambiguous position — left open'
          : 'no broker position — left open';
        failed++;
        await insertScheduleLog({
          ...logBase(r),
          action: 'close-finished',
          message: r.matchKind === 'ambiguous'
            ? `Trend finished but trade #${tr.id} (${tr.side} ${tr.currency}) matches several open broker positions, so it was left open. Close trade #${tr.id} manually to disambiguate.`
            : `Trend finished but no open broker position matched trade #${tr.id} (${tr.side} ${tr.currency} ${tr.amount} lots). Left open for manual review.`,
          error: r.matchKind === 'ambiguous' ? 'ambiguous position' : 'position not identified',
        });
        continue;
      }
      const positionId = String(r.pos.pos_id);
      try {
        await closePepperstonePosition(positionId);
      } catch (e: any) {
        r.result = `close failed: ${errMsg(e, 'unknown error')}`;
        failed++;
        await insertScheduleLog({
          ...logBase(r),
          action: 'close-finished',
          message: `Failed to close broker position ${positionId} for trade #${tr.id}: ${errMsg(e, 'unknown error')}`,
          error: errMsg(e, 'unknown error'),
        });
        continue;
      }

      const price = await closePrice(tr.currency);
      const isLong = tr.side === 'buy';
      if (!(price > 0)) {
        // Closed on the broker but unpriceable: mark the row closed at an
        // unknown price rather than storing 0, which would read as -100%.
        await updateTradeSell(tr.id, 0, 0, 0);
        r.result = 'closed, price unavailable';
        done++;
        await insertScheduleLog({
          ...logBase(r),
          action: 'close-finished',
          message: `Closed ${tr.side} ${tr.currency} (position ${positionId}) but could not read a price; profit left unrecorded.`,
          error: 'no close price',
        });
        continue;
      }

      const profitPct = isLong
        ? (price - tr.buy_price) / tr.buy_price * 100
        : (tr.buy_price - price) / tr.buy_price * 100;
      const diffAbs = isLong
        ? (price - tr.buy_price) * tr.amount
        : (tr.buy_price - price) * tr.amount;
      await updateTradeSell(tr.id, price, profitPct, diffAbs);
      r.result = `closed @ ${price.toFixed(4)} · ${pct(profitPct)}`;
      done++;
      await insertScheduleLog({
        ...logBase(r),
        action: 'close-finished',
        message: `Closed finished trend: ${tr.side} ${tr.currency} @ ${price.toFixed(4)} profit ${profitPct.toFixed(2)}% (position ${positionId})`,
        error: '',
      });
    }

    closeMsg = `Closed ${done} of ${targets.length} finished trend(s)` +
      (failed ? `, ${failed} left open` : '') + '.';
    closing = false;
    await loadTrends();
    await load();
  }

  // Close exactly one broker position, by its own id.
  //
  // This is the fallback for the rows we refuse to automate: untracked positions
  // (open on the broker with no trades row) and ambiguous rows (several same-size
  // candidates we could not tell apart). The point is that the user is choosing
  // the position by id, so no guessing happens — the row's own result text states
  // why automation declined, and an untracked position is visible as its own row.
  //
  // A row that is merely stale (a trades row whose position is already gone) has
  // no position to close and is refused here too.
  async function closeOne(r: TrendRow) {
    if (!r.pos) {
      r.result = 'no broker position to close';
      return;
    }
    // Refuse only when the id came from a guess. pos_id matches and a unique
    // pair+side+size match both point at a specific position; 'ambiguous' is the
    // one that does not.
    if (r.matchKind === 'ambiguous') {
      r.result = 'ambiguous position — pick the position id instead';
      return;
    }
    const posId = String(r.pos.pos_id);
    const label = `${rowSide(r)} ${rowSym(r)} ${num(rowLots(r), 2)} lots`;
    if (!confirm(`Close Pepperstone position ${posId}?\n\n${label}`)) return;

    closing = true;
    try {
      await closePepperstonePosition(posId);
      const price = await closePrice(rowSym(r));
      const tr = r.trade;

      // Without a trades row there is nothing to settle locally; the broker close
      // is the whole action.
      if (tr) {
        const isLong = tr.side !== 'sell';
        if (price > 0) {
          const profitPct = isLong
            ? (price - tr.buy_price) / tr.buy_price * 100
            : (tr.buy_price - price) / tr.buy_price * 100;
          const diffAbs = isLong
            ? (price - tr.buy_price) * tr.amount
            : (tr.buy_price - price) * tr.amount;
          await updateTradeSell(tr.id, price, profitPct, diffAbs);
          r.result = `closed @ ${price.toFixed(4)} · ${pct(profitPct)}`;
        } else {
          // Closed on the broker but unpriceable: record the trade as closed at an
          // unknown price rather than 0, which would read as a -100% loss.
          await updateTradeSell(tr.id, 0, 0, 0);
          r.result = 'closed, price unavailable';
        }
      } else {
        r.result = 'closed';
      }

      await insertScheduleLog({
        ...logBase(r),
        action: 'close-position',
        message: `Closed broker position ${posId} manually (${label}) from the open positions table${tr ? ` for trade #${tr.id}` : ' (untracked, no trades row)'}.`,
        error: '',
      });
    } catch (e: any) {
      r.result = `close failed: ${errMsg(e, 'unknown error')}`;
      await insertScheduleLog({
        ...logBase(r),
        action: 'close-position',
        message: `Failed to close broker position ${posId} (${label}): ${errMsg(e, 'unknown error')}`,
        error: errMsg(e, 'unknown error'),
      });
    } finally {
      closing = false;
      await loadTrends();
      await load();
    }
  }

  function reset() {
    fTask = ''; fCurrency = ''; fFrom = ''; fTo = '';
    load();
  }

  function sortBy(k: keyof TaskStats) {
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
    else { sortKey = k; sortDir = -1; }
  }

  $: sorted = [...tasks].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string')
      return String(av).localeCompare(String(bv)) * sortDir;
    return (Number(av) - Number(bv)) * sortDir;
  });

  $: maxDayTrades = Math.max(1, ...days.map((d) => d.trades));
  $: maxHourTrades = Math.max(1, ...hours.map((h) => h.trades));

  const num = (v: number | null | undefined, dp = 2) =>
    v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
  const int = (v: number | null | undefined) => (v == null ? '—' : String(v));
  const day = (v: string | null) => (v ? v.slice(0, 10) : '—');
  const clock = (v: string | null) => (v ? v.slice(11, 16) : '—');
  const dur = (m: number | null) => {
    if (m == null) return '—';
    if (m < 60) return `${Math.round(m)}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
    return `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
  };
  const tone = (v: number | null | undefined) =>
    v == null ? '' : v > 0 ? 'green' : v < 0 ? 'red' : '';

  // What a row's position is currently worth, per the broker. Prefer this over
  // the indicative mark: it is the broker's own valuation of the open position.
  const brokerPnl = (p: any | null) => (p && typeof p.pl_base === 'number' ? p.pl_base : null);

  // A row that has no trades row still shows the pair, side and size it was
  // opened with, so it can be identified against the broker by eye.
  const rowSym = (r: TrendRow) => r.trade?.currency || posSym(r.pos);
  const rowSide = (r: TrendRow) => r.trade ? (r.trade.side === 'sell' ? 'sell' : 'buy') : posSide(r.pos);
  const rowLots = (r: TrendRow) => r.trade?.amount ?? r.pos?.lots ?? null;

  // When the broker position was filled, as recorded when this app opened it.
  // Pepperstone does not report an open time for a position, so this is blank
  // for positions opened before the store existed or opened elsewhere.
  const openedAtText = (p: any | null) => {
    if (!p || !p.opened_at) return '—';
    const t = Date.parse(String(p.opened_at));
    if (isNaN(t)) return '—';
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  };
  const arrow = (k: keyof TaskStats) => (sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '');

  // Age of a still-open trade, in the same units as the closed-trade hold time.
  const ageMin = (iso: string | null) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return isNaN(t) ? null : (Date.now() - t) / 60000;
  };
  // Indicative P&L at the last analysed close — a mark, not a fill.
  const markPct = (tr: Trade | null, mark: number | null) => {
    if (!tr || mark == null || !(tr.buy_price > 0)) return null;
    return tr.side === 'sell'
      ? (tr.buy_price - mark) / tr.buy_price * 100
      : (mark - tr.buy_price) / tr.buy_price * 100;
  };

  // --- Price chart -----------------------------------------------------------
  // Same Plotly candlestick + indicator chart the Chart page renders, with the
  // filtered trades marked on it. Points are snapped to the nearest candle
  // because the chart's x-axis is categorical: a raw timestamp would be read as
  // a new, empty category and land off the series.
  const chartIntervals = ['1m','5m','15m','30m','1h','4h','8h','1d','3d','1w','1M'];

  let cCurrency = '';
  let cInterval = '5m';
  let cLookback = 500;
  let cIndicators = { macd: true, rsi: true, stochastic: true, sma: true, ema: true, bb: true, hma: true };

  let chartRows: any[] = [];
  let chartPoints: { x: string; y: number; type: 'buy' | 'sell'; label: string }[] = [];
  let pointsToken = 0;
  let chartLoading = false;
  let chartError = '';
  let chartLoaded = false;

  // Follow the pair filter when the operator has not picked a chart pair yet.
  $: if (fCurrency && !cCurrency) cCurrency = fCurrency;
  $: if (currencyOpts.length && !currencyOpts.includes(cCurrency))
    cCurrency = fCurrency && currencyOpts.includes(fCurrency) ? fCurrency : currencyOpts[0];

  async function loadChart() {
    if (!cCurrency) return;
    chartLoading = true;
    chartError = '';
    try {
      const params = await loadParamsForTable(tableForInterval(cInterval));
      const r = await fetchAndAnalyzeWithParams(cCurrency, cInterval, cLookback, params);
      chartRows = r?.analyzed || [];
      chartLoaded = chartRows.length > 0;
    } catch (e: any) {
      chartError = errMsg(e, 'Failed to load chart data');
      chartRows = [];
      chartLoaded = false;
    }
    chartLoading = false;
  }

  // Buy/sell markers for the trades in the filtered scope, matched to this
  // chart's pair and timeframe. Hovering a marker names the task that traded it.
  $: if (chartRows.length && cCurrency) buildChartPoints(chartRows, cCurrency, cInterval, filter());
  else chartPoints = [];

  function buildChartPoints(rows: any[], currency: string, interval: string, f: StatsFilter) {
    // Filter changes can fire this again while a query is in flight; only the
    // newest result is allowed to replace the markers.
    const token = ++pointsToken;
    const candles = rows.map((r) => ({
      x: new Date((typeof r.time === 'number' ? r.time * 1000 : Date.parse(r.time)))
        .toISOString().slice(0, 19).replace('T', ' '),
      t: typeof r.time === 'number' ? r.time * 1000 : Date.parse(r.time),
    }));
    if (candles.length === 0) return;
    const first = candles[0].t;
    const last = candles[candles.length - 1].t;
    const snap = (iso: string | null) => {
      if (!iso) return null;
      const t = Date.parse(iso);
      if (isNaN(t)) return null;
      // Only trades that fall inside the plotted window get a marker.
      if (t < first - 60000 || t > last + 60000) return null;
      let best = candles[0];
      for (const c of candles) {
        if (Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
      }
      return best.x;
    };

    getFilteredTrades(f)
      .then((list) => {
        if (token !== pointsToken) return;
        const pts: typeof chartPoints = [];
        for (const tr of list) {
          if (String(tr.currency || '').toUpperCase() !== currency.toUpperCase()) continue;
          if (String(tr.period || '') !== interval) continue;
          const task = tr.tactic_name || '(no task)';
          const isLong = tr.side !== 'sell';

          const bx = snap(tr.buy_date);
          if (bx && tr.buy_price > 0) {
            pts.push({
              x: bx,
              y: tr.buy_price,
              type: 'buy',
              label: `<b>${task}</b><br>${isLong ? 'Buy (long)' : 'Sell (short)'} @ ${tr.buy_price}`
                + `<br>${num(tr.amount, 2)} ${amtUnit} · ${day(tr.buy_date)} ${clock(tr.buy_date)} UTC`,
            });
          }
          const sx = snap(tr.sell_date);
          if (sx && tr.sell_price != null && tr.sell_price > 0) {
            pts.push({
              x: sx,
              y: tr.sell_price,
              type: 'sell',
              label: `<b>${task}</b><br>Close @ ${tr.sell_price}`
                + `<br>${pct(tr.profit)} · ${num(tr.difference, 2)} ${pnlUnit}`
                + `<br>${day(tr.sell_date)} ${clock(tr.sell_date)} UTC`,
            });
          }
        }
        chartPoints = pts;
      })
      .catch(() => { chartPoints = []; });
  }
</script>

<div class="view">
  <div class="head">
    <h2>Scheduled Trade Statistics</h2>
    <button class="btn-sm" on:click={load} disabled={loading}>Refresh</button>
  </div>

  <div class="filters">
    <label>
      Task
      <select bind:value={fTask} on:change={load}>
        <option value="">All tasks</option>
        {#each taskOpts as t}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <label>
      Pair
      <select bind:value={fCurrency} on:change={load}>
        <option value="">All pairs</option>
        {#each currencyOpts as c}<option value={c}>{c}</option>{/each}
      </select>
    </label>
    <label>
      From
      <input type="date" bind:value={fFrom} on:change={load} />
    </label>
    <label>
      To
      <input type="date" bind:value={fTo} on:change={load} />
    </label>
    <button class="btn-sm" on:click={reset} disabled={loading}>Reset</button>
    <span class="scope">
      {totals.task_count} task{totals.task_count === 1 ? '' : 's'} ·
      entry date, UTC
    </span>
  </div>

  {#if error}<p class="error">{error}</p>{/if}

  <div class="cards">
    <div class="card">
      <span class="k">Total trades</span>
      <span class="v">{int(totals.total_trades)}</span>
      <span class="s">{int(totals.open_trades)} open · {int(totals.closed_trades)} closed</span>
    </div>
    <div class="card">
      <span class="k">Direction</span>
      <span class="v">{int(totals.long_trades)}<em class="green">L</em> / {int(totals.short_trades)}<em class="red">S</em></span>
      <span class="s">long vs short entries</span>
    </div>
    <div class="card">
      <span class="k">Win rate</span>
      <span class="v {totals.closed_trades ? '' : 'muted'}">{totals.win_rate.toFixed(1)}%</span>
      <span class="s">{int(totals.wins)}W / {int(totals.losses)}L of {int(totals.closed_trades)}</span>
    </div>
    <div class="card">
      <span class="k">Total P&amp;L</span>
      <span class="v {tone(totals.total_pnl)}">{num(totals.total_pnl)} <em>{pnlUnit}</em></span>
      <span class="s">avg {pct(totals.avg_profit_pct)} per trade</span>
    </div>
    <div class="card">
      <span class="k">Best / worst</span>
      <span class="v">
        <em class="green">{pct(totals.best_profit_pct)}</em> /
        <em class="red">{pct(totals.worst_profit_pct)}</em>
      </span>
      <span class="s">single closed trade</span>
    </div>
    <div class="card">
      <span class="k">Total size</span>
      <span class="v">{num(totals.total_amount, isPs ? 2 : 0)} <em>{amtUnit}</em></span>
      <span class="s">avg {num(totals.avg_amount, isPs ? 2 : 0)} {amtUnit} per entry</span>
    </div>
    <div class="card">
      <span class="k">Avg hold</span>
      <span class="v">{dur(totals.avg_hold_minutes)}</span>
      <span class="s">entry → exit</span>
    </div>
    <div class="card">
      <span class="k">Active period</span>
      <span class="v small">{day(totals.first_trade)} → {day(totals.last_trade)}</span>
      <span class="s">last entry {clock(totals.last_trade)} UTC</span>
    </div>
  </div>

  {#if loading}
    <p class="muted">Loading...</p>
  {:else if tasks.length === 0}
    <p class="muted">No trades match these filters.</p>
  {:else}
    <h3>Per task</h3>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="left"><button class="sort" on:click={() => sortBy('task_name')}>Task{arrow('task_name')}</button></th>
            <th class="left"><button class="sort" on:click={() => sortBy('currency')}>Pair{arrow('currency')}</button></th>
            <th><button class="sort" on:click={() => sortBy('total_trades')}>Trades{arrow('total_trades')}</button></th>
            <th><button class="sort" on:click={() => sortBy('open_trades')}>Open{arrow('open_trades')}</button></th>
            <th><button class="sort" on:click={() => sortBy('long_trades')}>L / S{arrow('long_trades')}</button></th>
            <th><button class="sort" on:click={() => sortBy('win_rate')}>Win %{arrow('win_rate')}</button></th>
            <th><button class="sort" on:click={() => sortBy('total_pnl')}>P&amp;L ({pnlUnit}){arrow('total_pnl')}</button></th>
            <th><button class="sort" on:click={() => sortBy('avg_profit_pct')}>Avg %{arrow('avg_profit_pct')}</button></th>
            <th><button class="sort" on:click={() => sortBy('worst_profit_pct')}>Best / Worst{arrow('worst_profit_pct')}</button></th>
            <th><button class="sort" on:click={() => sortBy('total_amount')}>Total ({amtUnit}){arrow('total_amount')}</button></th>
            <th><button class="sort" on:click={() => sortBy('avg_amount')}>Avg size{arrow('avg_amount')}</button></th>
            <th><button class="sort" on:click={() => sortBy('avg_hold_minutes')}>Avg hold{arrow('avg_hold_minutes')}</button></th>
            <th><button class="sort" on:click={() => sortBy('first_trade')}>First{arrow('first_trade')}</button></th>
            <th><button class="sort" on:click={() => sortBy('last_trade')}>Last{arrow('last_trade')}</button></th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as t}
            <tr>
              <td class="left strong">{t.task_name}</td>
              <td class="left mono">
                {t.currency || '—'}{t.period ? ` · ${t.period}` : ''}
                {#if t.pairs_traded > 1}<span class="tag" title="This task has traded {t.pairs_traded} different pairs">+{t.pairs_traded - 1}</span>{/if}
              </td>
              <td>{int(t.total_trades)}</td>
              <td>{int(t.open_trades)}</td>
              <td><span class="green">{int(t.long_trades)}</span> / <span class="red">{int(t.short_trades)}</span></td>
              <td class={t.closed_trades === 0 ? 'muted' : ''}>{t.closed_trades === 0 ? '—' : `${t.win_rate.toFixed(1)}%`}</td>
              <td class="strong {tone(t.total_pnl)}">{num(t.total_pnl)}</td>
              <td class={tone(t.avg_profit_pct)}>{pct(t.avg_profit_pct)}</td>
              <td>
                <span class="green">{pct(t.best_profit_pct)}</span> /
                <span class="red">{pct(t.worst_profit_pct)}</span>
              </td>
              <td>{num(t.total_amount, isPs ? 2 : 0)}</td>
              <td>{num(t.avg_amount, isPs ? 2 : 0)}</td>
              <td>{dur(t.avg_hold_minutes)}</td>
              <td class="mono">{day(t.first_trade)}</td>
              <td class="mono">{day(t.last_trade)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="panes">
      <div class="pane">
        <h3>Per day</h3>
        <div class="scroll short">
          <table>
            <thead>
              <tr>
                <th class="left">Date</th>
                <th>Trades</th>
                <th>Open</th>
                <th>W / L</th>
                <th>P&amp;L ({pnlUnit})</th>
                <th class="left">Volume</th>
              </tr>
            </thead>
            <tbody>
              {#each days as d}
                <tr>
                  <td class="left mono">{d.day}</td>
                  <td>{int(d.trades)}</td>
                  <td>{int(d.open_trades)}</td>
                  <td><span class="green">{int(d.wins)}</span> / <span class="red">{int(d.losses)}</span></td>
                  <td class="strong {tone(d.pnl)}">{num(d.pnl)}</td>
                  <td class="left">
                    <div class="bar-track"><div class="bar" style="width:{(d.trades / maxDayTrades) * 100}%"></div></div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <div class="pane">
        <h3>Entry hour (UTC)</h3>
        <div class="hist">
          {#each hours as h}
            <div class="slot" title="{h.hour}:00 UTC — {h.trades} trades, {h.wins} won, P&L {num(h.pnl)} {pnlUnit}">
              <div class="col">
                {#if h.trades > 0}
                  <div class="fill" style="height:{(h.trades / maxHourTrades) * 100}%"></div>
                {/if}
              </div>
              <span class="tick">{h.hour}</span>
            </div>
          {/each}
        </div>
        <p class="muted small">Tallest bar: {maxHourTrades} trade{maxHourTrades === 1 ? '' : 's'}. Hover a bar for detail.</p>
      </div>
    </div>

    <p class="note">
      Bars show trade count per day. Daily P&amp;L nets to
      <span class={tone(days.reduce((a, d) => a + d.pnl, 0))}>{num(days.reduce((a, d) => a + d.pnl, 0))} {pnlUnit}</span>
      across closed trades; still-open trades contribute no P&amp;L.
    </p>
  {/if}

  {#if isPs}
    <div class="trends-head">
      <h3>Open trends</h3>
      <div class="actions">
        <button class="btn-sm" on:click={loadTrends} disabled={trendsLoading || closing}>
          {trendsLoading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          class="btn-sm btn-danger"
          on:click={closeFinished}
          disabled={closing || trendsLoading || finishedCount === 0}
          title="Close every trade whose task now signals the opposite direction, oldest first"
        >
          {closing ? 'Closing...' : `Close finished trends (${finishedCount})`}
        </button>
      </div>
    </div>
    {#if trendsError}<p class="error">{trendsError}</p>{/if}
    {#if broker}
      <p class="muted small">
        {#if broker.initialized}
          Broker ({broker.environment}): {broker.script} · {broker.python} · {broker.dir}
        {:else}
          Broker not ready: {broker.error}
        {/if}
      </p>
    {/if}
    {#if closeMsg}<p class="msg">{closeMsg}</p>{/if}

    {#if trendsLoading}
      <p class="muted">Loading open positions from Pepperstone...</p>
    {:else if trends.length === 0}
      <p class="muted">No open positions and no open trades.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="left">Pos ID</th>
              <th class="left">Opened (UTC)</th>
              <th>Age</th>
              <th class="left">Pair</th>
              <th class="left">Task</th>
              <th>Side</th>
              <th>Size ({amtUnit})</th>
              <th>Entry</th>
              <th>Opened</th>
              <th>Mark %</th>
              <th>P/L</th>
              <th class="left">Trend</th>
              <th class="left">Result</th>
              <th class="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {#each trends as r (r.key)}
              <tr class={r.trade ? '' : 'untracked'}>
                <td class="left mono">{r.pos ? r.pos.pos_id : '—'}</td>
                <td class="left mono">
                  {#if r.trade}{day(r.trade.buy_date)} {clock(r.trade.buy_date)}{:else}<span class="muted">not recorded</span>{/if}
                </td>
                <td>{dur(ageMin(r.trade?.buy_date ?? null))}</td>
                <td class="left">{rowSym(r)}{r.trade?.period ? ` · ${r.trade.period}` : ''}</td>
                <td class="left">{r.trade?.tactic_name || '—'}</td>
                <td class={rowSide(r) === 'sell' ? 'red' : 'green'}>
                  {rowSide(r) === 'sell' ? 'SHORT' : 'LONG'}
                </td>
                <td>{num(rowLots(r), 2)}</td>
                <td class="mono">{num(r.trade?.buy_price ?? r.pos?.price ?? null, 4)}</td>
                <td class="mono small">{openedAtText(r.pos)}</td>
                <td class={tone(markPct(r.trade, r.mark))}>{pct(markPct(r.trade, r.mark))}</td>
                <td class={tone(brokerPnl(r.pos))}>{num(brokerPnl(r.pos), 2)}</td>
                <td class="left">
                  {#if r.finished}
                    <span class="chip finished" title="Task now signals the opposite direction">{r.note}</span>
                  {:else if !r.trade}
                    <span class="chip untracked" title="Open on the broker with no matching recorded trade">untracked position</span>
                  {:else}
                    <span class="chip">{r.note}</span>
                  {/if}
                </td>
                <td class="left {r.result ? (r.result.startsWith('closed') ? 'green' : 'red') : 'muted'}">
                  {r.result || '—'}
                </td>
                <td class="left">
                  {#if r.pos}
                    <button
                      class="btn-sm"
                      disabled={closing || trendsLoading}
                      title="Close broker position {r.pos.pos_id} directly ({rowSide(r)} {rowSym(r)} {num(rowLots(r), 2)} lots)"
                      on:click={() => closeOne(r)}
                    >
                      Close trade
                    </button>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="10" class="left muted">
                {trends.filter((r) => r.pos).length} open on broker · {trends.filter((r) => r.trade && !r.pos).length} stale DB row{trends.filter((r) => r.trade && !r.pos).length === 1 ? '' : 's'} · {trends.filter((r) => !r.trade).length} untracked
              </td>
              <td class={tone(trendPnlTotal())}>{num(trendPnlTotal(), 2)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="note">
        One row per open position on the broker, so this total always matches the
        broker. Rows without a recorded trade are positions the app has no trades
        entry for — shown for review and never auto-closed. Rows marked
        <em>stale DB row</em> are trades records with no matching live position.
        A trend is finished when the task that opened it (same task name and analyzed
        table) has signalled its opposite direction since the trade was opened, more
        recently than its own direction — the same rule the scheduler uses to reverse
        itself. Signals are one-candle events, so the whole window is scanned rather
        than just the latest candle. Trades still running, and any
        trade whose position cannot be pinned to exactly one broker position, are
        skipped. Every close is written back as a closed trade so it lands in the
        statistics above.
      </p>
    {/if}
  {/if}

  <div class="trends-head">
    <h3>Price chart</h3>
  </div>
  <div class="filters">
    <label>
      Pair
      <select bind:value={cCurrency} on:change={loadChart}>
        <option value="">All pairs</option>
        {#each currencyOpts as c}<option value={c}>{c}</option>{/each}
      </select>
    </label>
    <label>
      Timeframe
      <select bind:value={cInterval} on:change={loadChart}>
        {#each chartIntervals as iv}<option value={iv}>{iv}</option>{/each}
      </select>
    </label>
    <label>
      Candles
      <input type="number" min="100" max="1000" step="100" bind:value={cLookback} on:change={loadChart} />
    </label>
    <button class="btn-sm" on:click={loadChart} disabled={chartLoading || !cCurrency}>
      {chartLoading ? 'Loading...' : 'Fetch'}
    </button>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.macd} />MACD</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.rsi} />RSI</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.stochastic} />Stoch</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.sma} />SMA</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.ema} />EMA</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.hma} />HMA</label>
    <label class="ind-chk"><input type="checkbox" bind:checked={cIndicators.bb} />BB</label>
  </div>

  {#if chartError}<p class="error">{chartError}</p>{/if}

  {#if chartLoading}
    <p class="muted">Loading chart...</p>
  {:else if !chartLoaded}
    <p class="muted">Pick a pair and fetch candles to see where the trades below landed on the chart.</p>
  {:else}
    <div class="chart-box">
      <CandleChart rows={chartRows} showIndicators={cIndicators} simPoints={chartPoints} />
    </div>
    <p class="note">
      {chartPoints.length} trade point{chartPoints.length === 1 ? '' : 's'} plotted for
      {cCurrency} {cInterval} within the filters above (entry and exit). Hover a
      triangle for the task that opened it; an exit triangle also shows the result.
    </p>
  {/if}
</div>

<style>
  .view { padding: 24px; overflow-y: auto; height: 100%; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .view h2 { font-size: 18px; }
  .view h3 { font-size: 13px; color: var(--text-secondary); margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .04em; }

  .filters {
    display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap;
    margin: 14px 0 18px; padding: 12px; background: var(--bg-secondary);
    border: 1px solid var(--border); border-radius: 6px;
  }
  .filters label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-secondary); }
  .scope { font-size: 11px; color: var(--text-secondary); margin-left: auto; padding-bottom: 6px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .card {
    display: flex; flex-direction: column; gap: 3px;
    background: var(--bg-secondary); border: 1px solid var(--border);
    border-radius: 6px; padding: 10px 12px;
  }
  .card .k { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-secondary); }
  .card .v { font-size: 18px; font-weight: 700; }
  .card .v.small { font-size: 12px; font-weight: 600; }
  .card .v em { font-size: 11px; font-style: normal; color: var(--text-secondary); font-weight: 600; }
  .card .s { font-size: 10px; color: var(--text-secondary); }

  .scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
  .scroll.short { max-height: 320px; overflow-y: auto; }
  th.left, td.left { text-align: left; }
  .sort {
    background: transparent; color: var(--text-secondary); font-size: 11px;
    font-weight: 600; padding: 0; text-transform: uppercase; letter-spacing: .03em;
  }
  .sort:hover { color: var(--accent); }
  .strong { font-weight: 600; }
  .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; }
  .tag {
    display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px;
    background: var(--bg-card); color: var(--accent-yellow); font-size: 9px; font-weight: 700;
  }

  .panes { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
  @media (max-width: 900px) { .panes { grid-template-columns: 1fr; } }

  .bar-track { width: 100%; min-width: 60px; background: rgba(255,255,255,.05); border-radius: 3px; height: 10px; }
  .bar { background: var(--accent); height: 100%; border-radius: 3px; }

  .hist { display: flex; align-items: flex-end; gap: 2px; height: 130px; padding: 8px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; }
  .slot { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; gap: 4px; }
  .col { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .fill { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; min-height: 2px; }
  .tick { font-size: 8px; color: var(--text-secondary); }

  .note { margin-top: 12px; font-size: 11px; color: var(--text-secondary); }
  .muted { color: var(--text-secondary); }
  .small { font-size: 11px; }
  .error { color: var(--accent); margin-bottom: 12px; font-size: 13px; }
  .green { color: var(--accent-green); font-weight: 600; }
  .red { color: var(--accent); font-weight: 600; }
  .btn-sm { padding: 4px 12px; font-size: 11px; background: var(--bg-card); color: var(--text-primary); }
  .btn-danger { background: var(--accent); color: #fff; }
  .btn-danger:disabled { opacity: .45; }

  .trends-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .trends-head .actions { display: flex; gap: 8px; }
  .chip {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    background: var(--bg-card); color: var(--text-secondary); font-size: 10px; font-weight: 600;
  }
  .chip.finished { background: rgba(255, 193, 7, .15); color: var(--accent-yellow); }
  .chip.untracked { background: rgba(255, 193, 7, .12); color: var(--accent-yellow); }
  .msg { color: var(--accent-green); font-size: 13px; margin-bottom: 12px; }

  /* A live position with no recorded trade: real exposure the app cannot
     account for, so it is dimmed to stand apart without hiding it. */
  tr.untracked { background: rgba(255, 193, 7, .05); }
  tfoot td {
    border-top: 1px solid var(--border);
    padding-top: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .ind-chk { flex-direction: row; align-items: center; gap: 5px; font-size: 11px; }
  .chart-box {
    overflow-x: auto; overflow-y: hidden; background: #1a1a2e;
    border: 1px solid var(--border); border-radius: 6px;
  }
</style>
