import { parseAbi, parseAbiItem } from "viem";

export const PONS_FACTORY_ABI = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
]);
export const TOKEN_LAUNCHED = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");
export const POOL_GRADUATED = parseAbiItem("event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)");

export const CURVE_ABI = parseAbi([
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function trackedQuote() view returns (uint256)",
  "function graduated() view returns (bool)",
]);
export const CURVE_BUY = parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)");
export const CURVE_SELL = parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)");

export const FUND_ABI = parseAbi([
  "event Claimed(uint256 indexed tokenId, address indexed holder, address indexed agentWallet, uint256 amount)",
  "function agentWallet(uint256 tokenId) view returns (address)",
]);
export const CLAIMED = parseAbiItem("event Claimed(uint256 indexed tokenId, address indexed holder, address indexed agentWallet, uint256 amount)");

export const AGENT_ABI = parseAbi([
  "function policy() view returns (uint128 perTrade, uint128 dailyCap, bool live, address setBy)",
  "function owner() view returns (address)",
  "function coin() view returns (address)",
  "function config() view returns (address)",
  "function ruleVersion() view returns (uint32)",
  "function spentDay() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function trade(uint256 value, bytes data) returns (bytes)",
  "function approveRouter(address tokenToSell, uint256 amount)",
  "event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri)",
  "error NotEngine()", "error PolicyStale()", "error Paused()", "error OverPerTrade()", "error OverDailyCap()",
  "error NotAllowed()", "error CallFailed(bytes)", "error NotHolder()", "error StarterLocked()",
  "error NotPonsToken()", "error NotEthPaired()", "error OwnCoin()", "error ZeroAmount()", "error TransferFailed()",
]);
export const RULE_APPLIED = parseAbiItem("event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri)");

export const ADAPTER_ABI = parseAbi([
  "function buy(address token, uint256 minTokensOut) payable returns (uint256)",
  "function sell(address token, uint256 tokensIn, uint256 minEthOut) returns (uint256)",
  "function poolPrice(address token) view returns (uint160)",
  "function poolState(address token) view returns (uint160 sqrtPriceX96, uint128 liquidity)",
  "event Bought(address indexed agent, address indexed token, uint256 ethIn, uint256 tokensOut, uint256 refund)",
  "event Sold(address indexed agent, address indexed token, uint256 tokensIn, uint256 ethOut)",
]);
export const BOUGHT = parseAbiItem("event Bought(address indexed agent, address indexed token, uint256 ethIn, uint256 tokensOut, uint256 refund)");
export const SOLD = parseAbiItem("event Sold(address indexed agent, address indexed token, uint256 tokensIn, uint256 ethOut)");

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
]);

export const CONFIG_ABI = parseAbi(["function paused() view returns (bool)", "function router() view returns (address)"]);
export const NFT_TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"])[0];
/** Pons factory: graduation step 1 (curve sold out and drained). Step 2, the pool, emits PoolGraduated. */
export const LAUNCH_SWEPT = parseAbi(["event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)"])[0];
