import {
  InitBinanceClient,
  TestConnection,
  FetchAndAnalyze,
  FetchAndAnalyzeWithParams,
  GetBalance,
  ExecuteMarketOrder,
  ExecuteLimitOrder,
  ExecuteMarketOrderQuote,
  GetOpenOrdersList,
  GetAllOrdersList,
  SaveOrdersCsv,
  GetLatestPrice,
  IsApiConnected,
  SaveAnalyzedCsv,
  GetCsvFiles,
  ReadCsvFile,
  FetchAIData,
  TrainAI,
  CheckAIReady,
  GetAIDataFiles,
  CreateAISchedule,
  SetExchangeConfig,
  GetExchangeConfig,
  ListPepperstonePositions,
  ClosePepperstonePosition,
  ReconcilePepperstonePositions,
  PepperstoneBrokerStatus,
  EvaluateOpenTrends,
  DbTables,
  DbQuery,
  SimulateStrategy,
} from '../../wailsjs/go/main/App';

export type { models, binance, pepperstone, main } from '../../wailsjs/go/models';

export const initBinanceClient = InitBinanceClient;
export const testConnection = TestConnection;
export const fetchAndAnalyze = FetchAndAnalyze;
export const fetchAndAnalyzeWithParams = FetchAndAnalyzeWithParams;
export const getBalance = GetBalance;
export const executeMarketOrder = ExecuteMarketOrder;
export const executeLimitOrder = ExecuteLimitOrder;
export const executeMarketOrderQuote = ExecuteMarketOrderQuote;
export const getOpenOrdersList = GetOpenOrdersList;
export const getAllOrdersList = GetAllOrdersList;
export const saveOrdersCsv = SaveOrdersCsv;
export const getLatestPrice = GetLatestPrice;
export const isApiConnected = IsApiConnected;
export const saveAnalyzedCsv = SaveAnalyzedCsv;
export const getCsvFiles = GetCsvFiles;
export const readCsvFile = ReadCsvFile;
export const fetchAIData = FetchAIData;
export const trainAI = TrainAI;
export const checkAIReady = CheckAIReady;
export const getAIDataFiles = GetAIDataFiles;
export const createAISchedule = CreateAISchedule;
export const setExchangeConfig = SetExchangeConfig;
export const getExchangeConfig = GetExchangeConfig;
export const listPepperstonePositions = ListPepperstonePositions;
export const closePepperstonePosition = ClosePepperstonePosition;
export const reconcilePepperstonePositions = ReconcilePepperstonePositions;
export const pepperstoneBrokerStatus = PepperstoneBrokerStatus;
export const evaluateOpenTrends = EvaluateOpenTrends;
export const dbTables = DbTables;
export const dbQuery = DbQuery;
export const simulateStrategy = SimulateStrategy;

/**
 * Wails rejects a failed Go call with a plain string, not an Error, so
 * `e?.message` is undefined and the real reason silently disappears behind the
 * fallback. Read the value itself when there is no message.
 */
export function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  const msg = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (e instanceof Error && e.message) return e.message;
  if (e != null) {
    const text = String(e).trim();
    if (text && text !== "[object Object]") return text;
  }
  return fallback;
}
