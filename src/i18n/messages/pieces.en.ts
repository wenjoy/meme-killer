/** Composite-sentence fragments. See `pieces.zh.ts` for the rationale. */
export const piecesEn: Record<string, string> = {
  // ── Liquidity: composite sentences (assembled by the analyzer, passed as params) ──
  'pieces.liquidity.sizeEvidence':
    'Sample: the last {trades} directional trades{windowText}. Buys: {buyCount} trades totalling {buyVol} SOL (avg {avgBuy}, median {medianBuy}). Sells: {sellCount} trades totalling {sellVol} SOL (avg {avgSell}, median {medianSell} — {sellRatio}x the buy average).{maxSell}',
  'pieces.liquidity.sizeEvidence.windowHours': ', spanning about {hours} hours',
  'pieces.liquidity.sizeEvidence.windowMinutes': ', spanning about {minutes} minutes',
  'pieces.liquidity.sizeEvidence.maxSell':
    'Largest single sell {maxSellSol} SOL, {largestSharePct}% of total sell volume',
  'pieces.liquidity.sizeEvidence.maxSellNoLargest': 'Largest single sell {maxSellSol} SOL',
  'pieces.liquidity.sizeEvidence.top5': '; the top 5 sells account for {top5Pct}%',
  'pieces.liquidity.sizeEvidence.tail': '.',

  'pieces.liquidity.sellEvidence.head':
    'Largest {n} sells (verify signatures on Solscan; full detail in "Large sells" below):',
  'pieces.liquidity.sellEvidence.row': '{sol} SOL @ {time}',
  'pieces.liquidity.sellEvidence.rowTrader': ', wallet {trader}',
  'pieces.liquidity.sellEvidence.rowSignature': ', signature {signature}',
  'pieces.liquidity.sellEvidence.sep': '; ',
  'pieces.liquidity.sellEvidence.tail': '.',

  'pieces.liquidity.identity.head': 'Identity check (for the largest {n} sells):',
  'pieces.liquidity.identity.noWindow':
    'The token\'s earliest trades could not be fetched this time, so there is no way to tell whether these addresses bought at launch — do not read this as "not snipers".',
  'pieces.liquidity.identity.creatorPart': '{creatorCount} from the deployer; ',
  'pieces.liquidity.identity.earlyPart': '{earlyCount} from addresses inside the earliest {windowTrades} trades ({detail})',
  'pieces.liquidity.identity.noEarlyPart': 'none from addresses inside the earliest {windowTrades} trades',
  'pieces.liquidity.identity.stillHoldingPart':
    '; {n} of these addresses are still in the current top 20 (highest {maxPct}%)',
  'pieces.liquidity.identity.noneHoldingPart': '; none of these addresses remain in the current top 20',
  'pieces.liquidity.identity.detailRow': '{identity} {sol} SOL',
  'pieces.liquidity.identity.detailSep': ', ',
  'pieces.liquidity.identity.sellerIsCreator': 'deployer',
  'pieces.liquidity.identity.sellerIsEarlyBuyer': 'buyer within the earliest {windowTrades} trades (#{index})',
  'pieces.liquidity.identity.windowCaveat':
    '⚠️ "Outside the earliest window" only means it was not the fee payer of the first 25 trades — it is not proof that this was not an early buyer.',

  'pieces.liquidity.unitNote': ' (Amounts are in {unit}; per-trade SOL size is unavailable, so this cannot be cross-checked further.)',

  // ── Sell pressure: scope note (composite) ─────────────────────────
  'pieces.sellPressure.windowNote':
    '{deepPart}estimated from the {paired} pairable trades inside the trade window (out of {total} in the window); wallets that sold out are excluded from sell pressure; when the window estimate of unsold tokens disagrees with the actual balance, the smaller value is used.',
  'pieces.sellPressure.windowNote.deepPart':
    '{n} addresses use per-address **full history** cost basis (real values), the rest ',

  // ── Contract: on-chain LP burn verification (composite) ───────────
  'pieces.contract.lpAudit':
    'On-chain check of this pool\'s LP mint ({lpMint}): {everMinted} ever minted, {live} currently on-chain — the {burned} difference was burned and cannot be recovered',
  'pieces.contract.lpAudit.unknownMint': 'address unknown',

  // ── Diamond hands: strongest individual example (composite) ───────
  'pieces.diamond.topSentence':
    'Longest holder is {address}…: held {holdDays} days, {buys} buys totalling {buySol} SOL{holderPctTail}.',
  'pieces.diamond.topSentence.holderPctTail': ', currently {holderPct}% of total supply',

  // ── Sell pressure: strongest individual example (composite) ───────
  'pieces.sellPressure.biggestTail':
    'Largest unrealised gain still holding: {address}… (+{pnlPct}%, {unsold} tokens unsold).',

  // ── Holders: known composition list (composite) ──────────────────
  'pieces.holders.kinds.item': '{kind} {n}',
  'pieces.holders.kinds.sep': ', ',
  'pieces.holders.kinds.none': 'cannot be classified',
  'pieces.holders.kind.pool': 'liquidity pool',
  'pieces.holders.kind.dev': 'the creator',
  'pieces.holders.kind.related': 'linked to the deployer',
  'pieces.holders.kind.sniper': 'snipers',
  'pieces.holders.kind.retail': 'retail',

  'pieces.holders.who.nonDev': 'a non-dev wallet',
  'pieces.holders.who.custody': 'a program-custodied position ({label})',

  'pieces.poolLabels.rugcheck': 'RugCheck pool/vault account',
  'pieces.poolLabels.pumpfunCurve': 'pump.fun bonding curve',
  'pieces.poolLabels.pumpfunCurveAta': 'pump.fun bonding curve ATA',
  'pieces.poolLabels.dexscreenerPair': 'DexScreener pair',
  'pieces.poolLabels.dexscreenerPairAta': 'DexScreener pair ATA',

  'pieces.poolLabels.observedPool': 'observed pool',
  'pieces.poolLabels.pumpswap': 'PumpSwap pool',
  'pieces.poolLabels.meteoraDlmm': 'Meteora DLMM pool',
  'pieces.poolLabels.raydiumV4': 'Raydium AMM v4 pool',
  'pieces.poolLabels.raydiumCpmm': 'Raydium CPMM pool',
  'pieces.poolLabels.orcaWhirlpool': 'Orca Whirlpool pool',

  'pieces.contract.lpEvidence': 'LP holders recorded by RugCheck: {evidence}.',

  'pieces.listSep': ', ',

};
