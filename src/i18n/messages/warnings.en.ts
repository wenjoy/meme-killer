/** Collection warnings (English). See `warnings.zh.ts` for the key convention. */
export const warningsEn: Record<string, string> = {
  // ── Deployer resolution (providers/creator.ts) ───────────────────
  'warnings.creator.unresolved':
    'Could not determine the deployer address: none of the three sources (pump.fun curve state, metadata creators, create-transaction fee payer) returned one.',
  'warnings.creator.fromCreateTx':
    'No creator found in the pump.fun curve or metadata, so the deployer is taken from the create transaction fee payer {launchWallet} (**inferred**: when a bundler/launchpad issues the token, this address is not the real dev).',
  'warnings.creator.launchWalletDiffers':
    'The create transaction fee payer {launchWallet} and the creator recorded by the program {creator} are **not the same address**: this report computes the developer dimension from the creator (program state is more authoritative); the fee payer may be a bundler/launchpad, so do not conflate the two.',

  // ── On-chain collection (providers/helius.ts) ────────────────────
  'warnings.helius.mintNotFound':
    'Mint account {mint} not found on-chain — the address may be wrong or belong to another network.',
  'warnings.helius.unexpectedOwner':
    'The mint account owner is {programId}, which is neither SPL Token nor Token-2022 — needs manual review.',
  'warnings.helius.mintReadFailed': 'Failed to read the mint account: {reason}',
  'warnings.helius.dasFailed':
    'DAS getAsset failed: {reason} (name/symbol/price may be missing)',
  'warnings.helius.ammPools':
    'Identified {n} AMM/bonding-curve vaults by their controlling program ({kinds}); excluded as liquidity pools.',
  'warnings.helius.timelocks':
    'Found {n} time-locked positions ({pct}% in total): {labels}. Excluded from concentration and whale checks and listed separately. Unlock times cannot be read right now (the custody account is a PDA), so they are marked pending.',
  'warnings.helius.supplyUnknown':
    'Could not read total token supply, so holding percentages cannot be computed; the concentration dimension will be marked as not collected.',
  'warnings.helius.top20Only':
    'On-chain RPC only returns the top 20 holding accounts; deeper distribution needs an indexer. If an AMM pool address is not recognised as a pool, its holdings count toward concentration and inflate the Top 10 share.',
  'warnings.helius.largestFailed': 'Failed to read the holder distribution: {reason}',
  'warnings.helius.curveMismatch':
    'The derived bonding curve address {curveAddress} is not a pump.fun curve account (owner or discriminator mismatch) and was ignored; real SOL in the curve cannot be confirmed.',
  'warnings.helius.curveReadFailed':
    'Failed to read the bonding curve account: {reason} (real SOL in the curve cannot be confirmed)',
  'warnings.helius.oldestNotCreate':
    'The earliest transaction is not the create transaction (possibly an index gap or a transfer made before creation): its fee payer can only serve as a **fallback candidate** for the deployer, and the launch time is indicative only.',
  'warnings.helius.oldestFailed':
    'Failed to fetch the earliest transaction: {reason} (deployer and launch time cannot be determined)',
  'warnings.helius.noDirection':
    'None of the last {n} transactions had an identifiable buy or sell direction (the sample may be too small, or Helius does not parse this transaction type).',
  'warnings.helius.tradesFailed': 'Failed to fetch trade details: {reason}',
  'warnings.helius.custodyFailed':
    'Custody-holding detection failed (cannot batch-read owner accounts): {reason}',
  'warnings.helius.unmatchedPda':
    'Another {n} holdings are owned by PDAs whose controlling program is not on the verified list, so they are neither labelled nor excluded — they count toward concentration as ordinary holdings.',
  'warnings.helius.pdaCapped':
    '{n} PDA holdings exist but only the first {cap} were reverse-looked-up; the rest are treated as ordinary holdings (conservative).',
  'warnings.helius.pdaNoApiKey':
    'Found {n} PDA holdings, but no Helius API key is configured so the controlling program cannot be resolved; all are counted toward concentration as ordinary holdings (not excluded).',
  'warnings.helius.noApiKey':
    'No Helius API key configured, so the developer history dimension cannot be computed (dev sells and prior launches both need the Enhanced API).',
  'warnings.helius.developerNoCreator':
    'Could not determine the deployer address (create transaction missing), so the developer history dimension cannot be computed.',
  'warnings.helius.creatorStillHolding':
    'The creator still holds {holding} tokens, so it is not treated as fully exited (flow ratios can be inflated by a truncated history window).',
  'warnings.helius.creatorBalanceUnknown':
    'Could not read the creator token balance, so whether it fully exited cannot be confirmed — this stays a note, not a veto.',
  'warnings.helius.creatorNoHistory':
    'The deployer address has no transaction history; dev sells and prior launches cannot be verified.',
  'warnings.helius.creatorHistoryFailed': 'Failed to query deployer history: {reason}',
  'warnings.helius.devFundingFailed': 'Failed to query the deployer funding source: {reason}',

  // ── Holder enumeration (providers/holderList.ts) ─────────────────
  'warnings.holderList.rpcFailed':
    'Full RPC enumeration failed ({program}…): {reason}. Fell back to DAS pagination — results may be incomplete.',
  'warnings.holderList.dasCapped':
    'DAS pagination hit its limit ({pages} pages × 1000) and only the first {n} accounts were fetched; the distribution chart and holder count are **incomplete** — do not treat them as full.',
  'warnings.holderList.empty':
    'Full enumeration returned no token accounts at all (this mint may have no holders).',
  'warnings.holderList.enumerationFailed':
    'Full holder enumeration failed: {reason}. This item cannot be computed.',

  // ── Market data (providers/dexscreener.ts) ───────────────────────
  'warnings.dexscreener.httpError':
    'DexScreener returned {status}; market data is missing (possibly rate limited).',
  'warnings.dexscreener.notFound':
    'DexScreener does not list this token — it may have no trading pool yet, or be extremely new/illiquid.',
  'warnings.dexscreener.timeout':
    'DexScreener request timed out ({ms}ms); market data is missing.',
  'warnings.dexscreener.failed': 'DexScreener request failed: {reason}',
  'warnings.dexscreener.skippedDebug': 'DexScreener skipped (debug mode)',

  // ── RugCheck (providers/rugcheck.ts) ─────────────────────────────
  'warnings.rugcheck.riskItem': 'RugCheck risk item: {name}{level}',
  'warnings.rugcheck.noLpMint':
    'This RugCheck pool has no valid LP mint yet (indexing incomplete), so LP lock/burn status cannot be determined and is treated as unknown.',
  'warnings.rugcheck.summaryOnly':
    'RugCheck returned summary data only (the full report is too large), so only the LP lock ratio can be determined — LP holders and pool addresses are unavailable.',
  'warnings.rugcheck.lpSupplyUnreadable':
    'Could not read the on-chain supply of LP mint {lpMint}, so the "LP burned" ratio cannot be verified; only the RugCheck lock/burn ratio is shown.',
  'warnings.rugcheck.fullUnavailable':
    'The full RugCheck report is unavailable ({reason}); fell back to the summary endpoint.',
  'warnings.rugcheck.unavailable':
    'RugCheck is unavailable ({fullReason}; summary endpoint: {summaryReason}) — LP lock/burn status and total holder count cannot be determined this time and are reported honestly as unknown.',

  // ── Pool resolution (providers/pools.ts) ─────────────────────────
  'warnings.pools.noneDerived':
    'No pool address could be derived; pool holdings may be counted toward concentration and inflate the Top 10 share.',
  'warnings.pools.mintUnparsable':
    'The mint address could not be parsed; pool derivation skipped: {mint}',

  // ── Aggregation layer (providers/index.ts) ───────────────────────
  'warnings.index.sniperEstimate':
    'Sniper holdings are an estimate: from the token earliest {window} trades, {n} fee payers remain after excluding deployer-related addresses; intersected with the current top 20 (on-chain returns only 20), so this is a lower bound, not the full picture.',
  'warnings.index.lpLockUnconfirmed':
    'LP lock/burn status could not be confirmed (RugCheck does not cover this pool, or was unreachable). It is shown as unknown — double-check on RugCheck, since this decides whether the pool can be pulled.',
  'warnings.index.socialNotIntegrated':
    'No social data source is integrated (Helius provides no social data; a third-party X/TG service is needed). This dimension is marked as not collected and excluded from the score.',
  'warnings.index.overviewNotLoaded':
    'The holder overview was not loaded automatically: about {accounts} accounts exceed the {max} limit. This does not mean "no holders" — it is loaded on demand.',
  'warnings.index.threeCalibers':
    'The holder count has three different calibers and the gap is not reconciled: {accounts} on-chain token accounts ({withBalance} with a balance, {empty} emptied), versus {reported} reported by RugCheck.',

  // ── Deep mode (providers/deepHolders.ts) ─────────────────────────
  'warnings.deepHolders.partial':
    'In deep mode {failed} addresses did not have their full history fetched (rate limited or timed out); their cost basis still comes from the window estimate — the deep result covers only {succeeded} addresses.',
  'warnings.deepHolders.noNativeTrades':
    'The history fetched in deep mode contains no trades in this token: these addresses received their tokens by transfer rather than buying, so no cost basis is available.',

  // ── Engine fallback (core/engine.ts) ─────────────────────────────
  'warnings.engine.scanFailed': '{reason}',
};
