export namespace binance {
	
	export class AccountBalance {
	    asset: string;
	    free: number;
	    locked: number;
	
	    static createFrom(source: any = {}) {
	        return new AccountBalance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.asset = source["asset"];
	        this.free = source["free"];
	        this.locked = source["locked"];
	    }
	}

}

export namespace main {
	
	export class PepperstoneBrokerStatus {
	    initialized: boolean;
	    exchange: string;
	    environment: string;
	    dir: string;
	    python: string;
	    script: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new PepperstoneBrokerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.initialized = source["initialized"];
	        this.exchange = source["exchange"];
	        this.environment = source["environment"];
	        this.dir = source["dir"];
	        this.python = source["python"];
	        this.script = source["script"];
	        this.error = source["error"];
	    }
	}
	export class SimMarker {
	    x: string;
	    y: number;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new SimMarker(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.type = source["type"];
	    }
	}
	export class SimTrade {
	    buyPrice: number;
	    sellPrice: number;
	    profitPct: number;
	    profitUsdt: number;
	
	    static createFrom(source: any = {}) {
	        return new SimTrade(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.buyPrice = source["buyPrice"];
	        this.sellPrice = source["sellPrice"];
	        this.profitPct = source["profitPct"];
	        this.profitUsdt = source["profitUsdt"];
	    }
	}
	export class SimResult {
	    points: SimMarker[];
	    trades: SimTrade[];
	    balance: number;
	
	    static createFrom(source: any = {}) {
	        return new SimResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.points = this.convertValues(source["points"], SimMarker);
	        this.trades = this.convertValues(source["trades"], SimTrade);
	        this.balance = source["balance"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TradeRef {
	    symbol: string;
	    position_id: string;
	
	    static createFrom(source: any = {}) {
	        return new TradeRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.symbol = source["symbol"];
	        this.position_id = source["position_id"];
	    }
	}
	export class TrendEval {
	    trade_id: number;
	    finished: boolean;
	    note: string;
	    task_id: number;
	    task_name: string;
	    analyzed_table: string;
	    buy_at: number;
	    sell_at: number;
	    mark?: number;
	
	    static createFrom(source: any = {}) {
	        return new TrendEval(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.trade_id = source["trade_id"];
	        this.finished = source["finished"];
	        this.note = source["note"];
	        this.task_id = source["task_id"];
	        this.task_name = source["task_name"];
	        this.analyzed_table = source["analyzed_table"];
	        this.buy_at = source["buy_at"];
	        this.sell_at = source["sell_at"];
	        this.mark = source["mark"];
	    }
	}

}

export namespace models {
	
	export class EquityPoint {
	    time: string;
	    equity: number;
	
	    static createFrom(source: any = {}) {
	        return new EquityPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.equity = source["equity"];
	    }
	}
	export class BacktestTrade {
	    entry_time: string;
	    exit_time: string;
	    entry_price: number;
	    exit_price: number;
	    action: string;
	    return_pct: number;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new BacktestTrade(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry_time = source["entry_time"];
	        this.exit_time = source["exit_time"];
	        this.entry_price = source["entry_price"];
	        this.exit_price = source["exit_price"];
	        this.action = source["action"];
	        this.return_pct = source["return_pct"];
	        this.duration = source["duration"];
	    }
	}
	export class AIBacktestResult {
	    total_trades: number;
	    win_count: number;
	    loss_count: number;
	    win_rate: number;
	    total_return: number;
	    max_drawdown: number;
	    sharpe_ratio: number;
	    final_balance: number;
	    trades: BacktestTrade[];
	    equity_curve: EquityPoint[];
	    confusion_matrix: number[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AIBacktestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_trades = source["total_trades"];
	        this.win_count = source["win_count"];
	        this.loss_count = source["loss_count"];
	        this.win_rate = source["win_rate"];
	        this.total_return = source["total_return"];
	        this.max_drawdown = source["max_drawdown"];
	        this.sharpe_ratio = source["sharpe_ratio"];
	        this.final_balance = source["final_balance"];
	        this.trades = this.convertValues(source["trades"], BacktestTrade);
	        this.equity_curve = this.convertValues(source["equity_curve"], EquityPoint);
	        this.confusion_matrix = source["confusion_matrix"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AIConfig {
	    symbol: string;
	    exec_timeframe: string;
	    data_lookback: number;
	    future_candles: number;
	    buy_threshold: number;
	    sell_threshold: number;
	    train_split: number;
	    n_trees: number;
	    max_depth: number;
	    use_mtf: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.symbol = source["symbol"];
	        this.exec_timeframe = source["exec_timeframe"];
	        this.data_lookback = source["data_lookback"];
	        this.future_candles = source["future_candles"];
	        this.buy_threshold = source["buy_threshold"];
	        this.sell_threshold = source["sell_threshold"];
	        this.train_split = source["train_split"];
	        this.n_trees = source["n_trees"];
	        this.max_depth = source["max_depth"];
	        this.use_mtf = source["use_mtf"];
	    }
	}
	export class AIFetchDataResult {
	    success: boolean;
	    message: string;
	    timeframes: string[];
	    total_rows: number;
	
	    static createFrom(source: any = {}) {
	        return new AIFetchDataResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.timeframes = source["timeframes"];
	        this.total_rows = source["total_rows"];
	    }
	}
	export class FeatureImportance {
	    name: string;
	    score: number;
	
	    static createFrom(source: any = {}) {
	        return new FeatureImportance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.score = source["score"];
	    }
	}
	export class AITrainResult {
	    config: AIConfig;
	    model_accuracy: number;
	    precision: number;
	    recall: number;
	    f1_score: number;
	    feature_importance: FeatureImportance[];
	    class_balance: Record<string, number>;
	    total_samples: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AITrainResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.config = this.convertValues(source["config"], AIConfig);
	        this.model_accuracy = source["model_accuracy"];
	        this.precision = source["precision"];
	        this.recall = source["recall"];
	        this.f1_score = source["f1_score"];
	        this.feature_importance = this.convertValues(source["feature_importance"], FeatureImportance);
	        this.class_balance = source["class_balance"];
	        this.total_samples = source["total_samples"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AIResult {
	    train?: AITrainResult;
	    backtest?: AIBacktestResult;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AIResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.train = this.convertValues(source["train"], AITrainResult);
	        this.backtest = this.convertValues(source["backtest"], AIBacktestResult);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class AnalyzedRow {
	    time: number;
	    open: number;
	    high: number;
	    low: number;
	    close: number;
	    volume: number;
	    currency: string;
	    macd: number;
	    macd_signal: number;
	    macd_hist: number;
	    rsi: number;
	    rsi_short: number;
	    rsi_middle: number;
	    rsi_long: number;
	    ema: number;
	    ema_short: number;
	    ema_middle: number;
	    ema_long: number;
	    ma_short: number;
	    ma_middle: number;
	    ma_long: number;
	    sma_short: number;
	    sma_long: number;
	    hma: number;
	    stochastic_K: number;
	    stochastic_D: number;
	    bb_middle: number;
	    bb_upper: number;
	    bb_lower: number;
	    bb_upper_75: number;
	    bb_lower_25: number;
	    bb_trend: string;
	    bb_signal: string;
	    bb_trade: string;
	    bb_sell_crossover: number;
	    bb_buy_crossover: number;
	    macd_trade: string;
	    rsi_trade: string;
	    stochastic_trade: string;
	    channel_trade: string;
	    ema_trade: string;
	    sma_trade: string;
	    ma_trade: string;
	    hma_trade: string;
	    trade: string;
	    last4candle_trend: string;
	    bullish_crossover: string;
	    bearish_crossover: string;
	    is_Bottom: string;
	    is_Peak: string;
	    up_trend_before_Peak: string;
	    down_trend_before_Bottom: string;
	    buy_on_Bottom: string;
	    sell_on_Peak: string;
	    sma_short_uptrend: string;
	    sma_short_downtrend: string;
	    sma_long_uptrend: string;
	    sma_long_downtrend: string;
	
	    static createFrom(source: any = {}) {
	        return new AnalyzedRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.open = source["open"];
	        this.high = source["high"];
	        this.low = source["low"];
	        this.close = source["close"];
	        this.volume = source["volume"];
	        this.currency = source["currency"];
	        this.macd = source["macd"];
	        this.macd_signal = source["macd_signal"];
	        this.macd_hist = source["macd_hist"];
	        this.rsi = source["rsi"];
	        this.rsi_short = source["rsi_short"];
	        this.rsi_middle = source["rsi_middle"];
	        this.rsi_long = source["rsi_long"];
	        this.ema = source["ema"];
	        this.ema_short = source["ema_short"];
	        this.ema_middle = source["ema_middle"];
	        this.ema_long = source["ema_long"];
	        this.ma_short = source["ma_short"];
	        this.ma_middle = source["ma_middle"];
	        this.ma_long = source["ma_long"];
	        this.sma_short = source["sma_short"];
	        this.sma_long = source["sma_long"];
	        this.hma = source["hma"];
	        this.stochastic_K = source["stochastic_K"];
	        this.stochastic_D = source["stochastic_D"];
	        this.bb_middle = source["bb_middle"];
	        this.bb_upper = source["bb_upper"];
	        this.bb_lower = source["bb_lower"];
	        this.bb_upper_75 = source["bb_upper_75"];
	        this.bb_lower_25 = source["bb_lower_25"];
	        this.bb_trend = source["bb_trend"];
	        this.bb_signal = source["bb_signal"];
	        this.bb_trade = source["bb_trade"];
	        this.bb_sell_crossover = source["bb_sell_crossover"];
	        this.bb_buy_crossover = source["bb_buy_crossover"];
	        this.macd_trade = source["macd_trade"];
	        this.rsi_trade = source["rsi_trade"];
	        this.stochastic_trade = source["stochastic_trade"];
	        this.channel_trade = source["channel_trade"];
	        this.ema_trade = source["ema_trade"];
	        this.sma_trade = source["sma_trade"];
	        this.ma_trade = source["ma_trade"];
	        this.hma_trade = source["hma_trade"];
	        this.trade = source["trade"];
	        this.last4candle_trend = source["last4candle_trend"];
	        this.bullish_crossover = source["bullish_crossover"];
	        this.bearish_crossover = source["bearish_crossover"];
	        this.is_Bottom = source["is_Bottom"];
	        this.is_Peak = source["is_Peak"];
	        this.up_trend_before_Peak = source["up_trend_before_Peak"];
	        this.down_trend_before_Bottom = source["down_trend_before_Bottom"];
	        this.buy_on_Bottom = source["buy_on_Bottom"];
	        this.sell_on_Peak = source["sell_on_Peak"];
	        this.sma_short_uptrend = source["sma_short_uptrend"];
	        this.sma_short_downtrend = source["sma_short_downtrend"];
	        this.sma_long_uptrend = source["sma_long_uptrend"];
	        this.sma_long_downtrend = source["sma_long_downtrend"];
	    }
	}
	export class Candle {
	    time: number;
	    open: number;
	    high: number;
	    low: number;
	    close: number;
	    volume: number;
	
	    static createFrom(source: any = {}) {
	        return new Candle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.open = source["open"];
	        this.high = source["high"];
	        this.low = source["low"];
	        this.close = source["close"];
	        this.volume = source["volume"];
	    }
	}
	export class AnalysisResult {
	    candles: Candle[];
	    analyzed: AnalyzedRow[];
	    table_name: string;
	
	    static createFrom(source: any = {}) {
	        return new AnalysisResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.candles = this.convertValues(source["candles"], Candle);
	        this.analyzed = this.convertValues(source["analyzed"], AnalyzedRow);
	        this.table_name = source["table_name"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	export class OrderInfo {
	    order_id: number;
	    symbol: string;
	    side: string;
	    type: string;
	    price: number;
	    quantity: number;
	    executed_qty: number;
	    quote_qty: number;
	    status: string;
	    time: number;
	    update_time: number;
	
	    static createFrom(source: any = {}) {
	        return new OrderInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.order_id = source["order_id"];
	        this.symbol = source["symbol"];
	        this.side = source["side"];
	        this.type = source["type"];
	        this.price = source["price"];
	        this.quantity = source["quantity"];
	        this.executed_qty = source["executed_qty"];
	        this.quote_qty = source["quote_qty"];
	        this.status = source["status"];
	        this.time = source["time"];
	        this.update_time = source["update_time"];
	    }
	}
	export class OrderResult {
	    order_id: number;
	    symbol: string;
	    side: string;
	    quantity: number;
	    price: number;
	    status: string;
	    position_id?: string;
	    position_unresolved?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OrderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.order_id = source["order_id"];
	        this.symbol = source["symbol"];
	        this.side = source["side"];
	        this.quantity = source["quantity"];
	        this.price = source["price"];
	        this.status = source["status"];
	        this.position_id = source["position_id"];
	        this.position_unresolved = source["position_unresolved"];
	    }
	}

}

export namespace pepperstone {
	
	export class Position {
	    pos_id: string;
	    symbol: string;
	    side: string;
	    units: number;
	    lots: number;
	    price: number;
	    now?: number;
	    pl?: number;
	    pl_base?: number;
	    opened_at?: string;
	
	    static createFrom(source: any = {}) {
	        return new Position(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pos_id = source["pos_id"];
	        this.symbol = source["symbol"];
	        this.side = source["side"];
	        this.units = source["units"];
	        this.lots = source["lots"];
	        this.price = source["price"];
	        this.now = source["now"];
	        this.pl = source["pl"];
	        this.pl_base = source["pl_base"];
	        this.opened_at = source["opened_at"];
	    }
	}

}

export namespace store {
	
	export class DayStats {
	    day: string;
	    trades: number;
	    open_trades: number;
	    closed_trades: number;
	    wins: number;
	    losses: number;
	    pnl: number;
	
	    static createFrom(source: any = {}) {
	        return new DayStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.trades = source["trades"];
	        this.open_trades = source["open_trades"];
	        this.closed_trades = source["closed_trades"];
	        this.wins = source["wins"];
	        this.losses = source["losses"];
	        this.pnl = source["pnl"];
	    }
	}
	export class Filter {
	    taskName: string;
	    currency: string;
	    from: string;
	    to: string;
	
	    static createFrom(source: any = {}) {
	        return new Filter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskName = source["taskName"];
	        this.currency = source["currency"];
	        this.from = source["from"];
	        this.to = source["to"];
	    }
	}
	export class FilterOptions {
	    tasks: string[];
	    currencies: string[];
	
	    static createFrom(source: any = {}) {
	        return new FilterOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tasks = source["tasks"];
	        this.currencies = source["currencies"];
	    }
	}
	export class HourStats {
	    hour: string;
	    trades: number;
	    wins: number;
	    pnl: number;
	
	    static createFrom(source: any = {}) {
	        return new HourStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = source["hour"];
	        this.trades = source["trades"];
	        this.wins = source["wins"];
	        this.pnl = source["pnl"];
	    }
	}
	export class IndicatorAdjustment {
	    id: number;
	    name: string;
	    analyzed_table: string;
	    params: string;
	    created_at: string;
	    updated_at: string;
	
	    static createFrom(source: any = {}) {
	        return new IndicatorAdjustment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.analyzed_table = source["analyzed_table"];
	        this.params = source["params"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}
	export class Orderable {
	    id: number;
	    allowed_trades: number;
	    orderable_trades: number;
	    unfinished_trades: number;
	    currency: string;
	    period: string;
	    balance_percentage: number;
	    tactic: string;
	
	    static createFrom(source: any = {}) {
	        return new Orderable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.allowed_trades = source["allowed_trades"];
	        this.orderable_trades = source["orderable_trades"];
	        this.unfinished_trades = source["unfinished_trades"];
	        this.currency = source["currency"];
	        this.period = source["period"];
	        this.balance_percentage = source["balance_percentage"];
	        this.tactic = source["tactic"];
	    }
	}
	export class ScheduleLog {
	    id: number;
	    task_id: number;
	    task_name: string;
	    action: string;
	    currency: string;
	    interval: string;
	    analyzed_table: string;
	    balance: string;
	    criteria_info: string;
	    indicators: string;
	    message: string;
	    error: string;
	    trade_amount: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new ScheduleLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.task_id = source["task_id"];
	        this.task_name = source["task_name"];
	        this.action = source["action"];
	        this.currency = source["currency"];
	        this.interval = source["interval"];
	        this.analyzed_table = source["analyzed_table"];
	        this.balance = source["balance"];
	        this.criteria_info = source["criteria_info"];
	        this.indicators = source["indicators"];
	        this.message = source["message"];
	        this.error = source["error"];
	        this.trade_amount = source["trade_amount"];
	        this.created_at = source["created_at"];
	    }
	}
	export class ScheduleTask {
	    id: number;
	    task_name: string;
	    interval: number;
	    analyzed_table_name: string;
	    buy_criteria: string;
	    sell_criteria: string;
	    currency: string;
	    trade_balance_percentage: number;
	    balance_type: string;
	    sell_if_greater_than: number;
	    max_open_trades: number;
	    task_status: string;
	
	    static createFrom(source: any = {}) {
	        return new ScheduleTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.task_name = source["task_name"];
	        this.interval = source["interval"];
	        this.analyzed_table_name = source["analyzed_table_name"];
	        this.buy_criteria = source["buy_criteria"];
	        this.sell_criteria = source["sell_criteria"];
	        this.currency = source["currency"];
	        this.trade_balance_percentage = source["trade_balance_percentage"];
	        this.balance_type = source["balance_type"];
	        this.sell_if_greater_than = source["sell_if_greater_than"];
	        this.max_open_trades = source["max_open_trades"];
	        this.task_status = source["task_status"];
	    }
	}
	export class TaskStats {
	    task_name: string;
	    currency: string;
	    period: string;
	    pairs_traded: number;
	    total_trades: number;
	    open_trades: number;
	    closed_trades: number;
	    long_trades: number;
	    short_trades: number;
	    wins: number;
	    losses: number;
	    win_rate: number;
	    total_pnl: number;
	    avg_profit_pct?: number;
	    best_profit_pct?: number;
	    worst_profit_pct?: number;
	    total_amount: number;
	    avg_amount?: number;
	    total_qty: number;
	    first_trade?: string;
	    last_trade?: string;
	    avg_hold_minutes?: number;
	
	    static createFrom(source: any = {}) {
	        return new TaskStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_name = source["task_name"];
	        this.currency = source["currency"];
	        this.period = source["period"];
	        this.pairs_traded = source["pairs_traded"];
	        this.total_trades = source["total_trades"];
	        this.open_trades = source["open_trades"];
	        this.closed_trades = source["closed_trades"];
	        this.long_trades = source["long_trades"];
	        this.short_trades = source["short_trades"];
	        this.wins = source["wins"];
	        this.losses = source["losses"];
	        this.win_rate = source["win_rate"];
	        this.total_pnl = source["total_pnl"];
	        this.avg_profit_pct = source["avg_profit_pct"];
	        this.best_profit_pct = source["best_profit_pct"];
	        this.worst_profit_pct = source["worst_profit_pct"];
	        this.total_amount = source["total_amount"];
	        this.avg_amount = source["avg_amount"];
	        this.total_qty = source["total_qty"];
	        this.first_trade = source["first_trade"];
	        this.last_trade = source["last_trade"];
	        this.avg_hold_minutes = source["avg_hold_minutes"];
	    }
	}
	export class Trade {
	    id: number;
	    buy_date: string;
	    sell_date?: string;
	    amount: number;
	    currency: string;
	    buy_price: number;
	    sell_price?: number;
	    period: string;
	    tactic_name: string;
	    usdt: number;
	    difference?: number;
	    profit?: number;
	    side: string;
	    position_id: string;
	
	    static createFrom(source: any = {}) {
	        return new Trade(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.buy_date = source["buy_date"];
	        this.sell_date = source["sell_date"];
	        this.amount = source["amount"];
	        this.currency = source["currency"];
	        this.buy_price = source["buy_price"];
	        this.sell_price = source["sell_price"];
	        this.period = source["period"];
	        this.tactic_name = source["tactic_name"];
	        this.usdt = source["usdt"];
	        this.difference = source["difference"];
	        this.profit = source["profit"];
	        this.side = source["side"];
	        this.position_id = source["position_id"];
	    }
	}

}

