/**
 * DexScreener Provider —— 市场与流动性数据。
 *
 * 免费公开 API，无需 key：https://api.dexscreener.com/latest/dex/tokens/{mint}
 *
 * 为什么需要它：Solana RPC 拿不到「成交量、买卖笔数、价格、流动性深度、
 * 池地址」—— 而这些恰好是判断**抽池 / 刷量 / 蜜罐**的核心输入。
 *
 * 关键取舍：
 * - DexScreener 的买卖笔数是**聚合后**的数字，无法区分 creator 自买，
 *   因此狙击占比只能标记为 heuristic（推算），不能当作链上事实。
 * - 池地址可以从 pair 里拿到，这解决了 solana.ts 里「无法剔除池持仓」的缺口。
 */
import type { FieldOrigin, LiquidityInfo, TokenInfo, Warning } from '@/core/types';
import { warn } from '@/core/warning';

const BASE = 'https://api.dexscreener.com/latest/dex/tokens';
const TIMEOUT_MS = 8000;

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  info?: { imageUrl?: string; socials?: { type?: string; url?: string }[] };
}

export interface DexResult {
  token: Partial<TokenInfo>;
  liquidity: LiquidityInfo | null;
  origin: FieldOrigin;
  warning?: Warning;
}

/** 取 base58 交易量最大的那个 pair —— meme 币常有多个池，主池才代表真实流动性 */
function pickMainPair(pairs: DexPair[], mint: string): DexPair | undefined {
  const solana = pairs.filter((p) => p.chainId === 'solana');
  const relevant = solana.filter(
    (p) => p.baseToken?.address === mint || p.quoteToken?.address === mint,
  );
  const pool = relevant.length > 0 ? relevant : solana;
  return pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}

export async function fetchDexScreener(mint: string): Promise<DexResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${mint}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        token: {},
        liquidity: null,
        origin: 'unavailable',
        warning: warn(
          'warnings.dexscreener.httpError',
          { status: res.status },
          `DexScreener 返回 ${res.status}，市场数据缺失（可能限流）。`,
        ),
      };
    }
    const json = (await res.json()) as { pairs?: DexPair[] | null };
    const pair = pickMainPair(json.pairs ?? [], mint);
    if (!pair) {
      return {
        token: {},
        liquidity: null,
        origin: 'unavailable',
        warning: warn(
          'warnings.dexscreener.notFound',
          undefined,
          'DexScreener 未收录该代币 —— 可能尚未建立任何交易池，或属于极新/极冷标的。',
        ),
      };
    }

    const buys = pair.txns?.h24?.buys ?? 0;
    const sells = pair.txns?.h24?.sells ?? 0;
    // 用成交额按笔数比例拆分出买卖额 —— DexScreener 不直接给 buy/sell volume。
    // 这是**推算值**，因此只有笔数与总额可信，金额拆分标记为 heuristic。
    const vol = pair.volume?.h24 ?? 0;
    const totalTx = buys + sells;
    const buyShare = totalTx > 0 ? buys / totalTx : 0.5;

    const socials: TokenInfo['socials'] = {};
    for (const s of pair.info?.socials ?? []) {
      if (s.type === 'twitter' && s.url) socials.twitter = s.url;
      if (s.type === 'telegram' && s.url) socials.telegram = s.url;
      if (s.type === 'website' && s.url) socials.website = s.url;
    }

    const token: Partial<TokenInfo> = {
      symbol: pair.baseToken?.symbol,
      name: pair.baseToken?.name,
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
      marketCapUsd: pair.marketCap,
      fdvUsd: pair.fdv,
      imageUrl: pair.info?.imageUrl,
      socials: Object.keys(socials).length > 0 ? socials : undefined,
    };

    const liquidity: LiquidityInfo = {
      liquidityUsd: pair.liquidity?.usd,
      // 池地址是本次采集最有价值的产出：它让 holders 分析能正确剔除池持仓
      poolAddresses: pair.pairAddress ? [pair.pairAddress] : [],
      volume24hUsd: vol,
      priceChange24h: pair.priceChange?.h24,
      buyCount: buys,
      sellCount: sells,
      // ⚠️ 这里是**按笔数占比推算的 USD 成交额**，不是原始数据，也**不是 SOL**。
      // 曾经把它写进 buyVolumeSol / sellVolumeSol，于是分析器把美元当 SOL 用：
      // 「净流入 +X SOL」显示的其实是美元，刷量阈值（0.5 SOL）永远不可能触发。
      // 现在写进 USD 字段，分析器只在拿不到逐笔成交（SOL 口径）时才用它，
      // 且只用与单位无关的「卖单额占比」，不再算净流入。
      buyVolumeUsd: vol * buyShare,
      sellVolumeUsd: vol * (1 - buyShare),
      // DexScreener 有池子即说明已从 curve 毕业（存在真实 AMM 池）
      graduated: true,
      complete: true,
    };

    return { token, liquidity, origin: 'dexscreener' };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const reason = err instanceof Error ? err.message : String(err);
    // 提到变量里再放进字面量：直接写三元表达式时 TS 会把分支的返回类型
    // 放宽成 string 联合，导致 DexResult.warning 报不兼容（实测踩过）。
    const warning: Warning = aborted
      ? warn('warnings.dexscreener.timeout', { ms: TIMEOUT_MS }, `DexScreener 请求超时（${TIMEOUT_MS}ms），市场数据缺失。`)
      : warn('warnings.dexscreener.failed', { reason }, `DexScreener 请求失败：${reason}`);
    return {
      token: {},
      liquidity: null,
      origin: 'unavailable',
      warning,
    };
  } finally {
    clearTimeout(timer);
  }
}
