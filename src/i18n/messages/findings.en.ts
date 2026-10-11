/**
 * Analyzer finding copy (English).
 *
 * Key convention (see `src/i18n/finding.ts`):
 * - `findings.<id>`        → title
 * - `findings.<id>.detail` → detail
 *
 * Placeholders use `{name}`. Names must match the analyzer's `params` keys —
 * asserted by `findings.i18n.test.ts`. A few placeholders are *derived* by the
 * render layer because the Chinese original builds an optional suffix with a
 * leading comma or bracket; those are documented where they appear:
 * `{unlockAtText}`, `{lockPctText}`, `{auditTextTail}`, `{lpEvidenceText}`,
 * `{topSentence}`, `{biggestTail}`, `{sizeEvidence}`, `{sellEvidence}`.
 *
 * Tone: this is a risk scanner read by someone deciding whether to buy a meme
 * coin. Direct, professional, no filler. Numbers, addresses, percentages and
 * thresholds are preserved exactly.
 */
export const findingsEn: Record<string, string> = {
  // ── Contract safety ───────────────────────────────────────────────
  'findings.contract.noData': 'Contract data missing',
  'findings.contract.noData.detail':
    'Could not read the mint account, so mint/freeze authority and Token-2022 extensions cannot be assessed. Do not read this as "no problems found".',
  'findings.contract.mintNotRevoked': 'Mint authority not revoked',
  'findings.contract.mintNotRevoked.detail':
    'mintAuthority = {authority}. The project can mint unlimited supply and dilute your holdings.',
  'findings.contract.freezeNotRevoked': 'Freeze authority not revoked',
  'findings.contract.freezeNotRevoked.detail':
    'freezeAuthority = {authority}. The project can freeze your account so you cannot sell.',
  'findings.contract.authoritiesRevoked': 'Authorities revoked',
  'findings.contract.authoritiesRevoked.detail':
    'Both mint and freeze authority are null — normal for a Pump.fun launch.',
  'findings.contract.authorityUnknown': 'Authority status unknown',
  'findings.contract.authorityUnknown.detail':
    'Could not confirm whether mint/freeze authority was revoked. Verify manually.',
  'findings.contract.maliciousExtension': 'Malicious extension: {label}',
  'findings.contract.maliciousExtension.detail': '{why}',
  'findings.contract.extension': 'Extension: {label}',
  'findings.contract.extension.detail': '{why}',
  'findings.contract.token2022Clean': 'Token-2022, no malicious extensions found',
  'findings.contract.token2022Clean.detail':
    'New pump.fun tokens are issued on Token-2022 — using that program is not a risk signal. What matters is the extensions: no transferHook / permanentDelegate or other sell-blocking extension was found.',
  'findings.contract.transferFee': 'Transfer tax present',
  'findings.contract.transferFee.detail':
    'Sell tax {feePct}%, which meaningfully eats into profit.',
  'findings.contract.lpNotCreated': 'No LP yet',
  'findings.contract.lpNotCreated.detail':
    'Still on the bonding curve — there is no real liquidity pool.',
  'findings.contract.lpBurned': 'LP burned',
  'findings.contract.lpBurned.detail':
    'The liquidity tokens are permanently burned and the pool cannot be pulled ({lockPct}).{auditTextTail}',
  'findings.contract.lpBurnedNoPct': 'LP burned',
  'findings.contract.lpBurnedNoPct.detail':
    'The liquidity tokens are permanently burned and the pool cannot be pulled.{auditTextTail}',
  'findings.contract.lpLockedByLocker': 'LP locked / cannot be pulled',
  'findings.contract.lpLockedByLocker.detail':
    'Held by {locker}{unlockAtText}{lockPctText}, so the pool cannot be pulled.',
  'findings.contract.lpLockedByProgram': 'LP locked / cannot be pulled',
  'findings.contract.lpLockedByProgram.detail':
    'Held by a lockup program{unlockAtText}{lockPctText}, so the pool cannot be pulled.',
  'findings.contract.lpLockedNoLocker': 'LP locked / cannot be pulled',
  'findings.contract.lpLockedNoLocker.detail':
    'Locked or burned ratio is at the ceiling; no locker was provided{unlockAtText}{lockPctText}, so the pool cannot be pulled.',
  'findings.contract.lpPartiallyBurned': 'LP burned {burnedPct}%',
  'findings.contract.lpPartiallyBurned.detail':
    '{auditText}; i.e. {burnedPct}% of LP is burned and the remaining {livePct}% is still circulating.',
  'findings.contract.lpPartiallyBurnedNoAudit': 'LP burned {burnedPct}%',
  'findings.contract.lpPartiallyBurnedNoAudit.detail':
    '; i.e. {burnedPct}% of LP is burned and the remaining {livePct}% is still circulating.',
  'findings.contract.relatedHoldsLp': 'Deployer-linked wallets hold circulating LP',
  'findings.contract.relatedHoldsLp.detail':
    'On-chain check: addresses linked to the deployer (the payer of the creation transaction, or a wallet that funded the creator\u2019s first trade) hold about {ofPoolPct}% of the total pool LP ({livePct}% of the circulating portion), across {holderCount} address(es) — these can withdraw their share of liquidity at any time. Unless they can be shown to be unrelated to the project (a public market maker, say), treat this as a project-controlled rug-pull risk.{lpEvidenceText}',
  'findings.contract.relatedHoldsLpNoLive': 'Deployer-linked wallets hold circulating LP',
  'findings.contract.relatedHoldsLpNoLive.detail':
    'On-chain check: addresses linked to the deployer (the payer of the creation transaction, or a wallet that funded the creator\u2019s first trade) hold about {ofPoolPct}% of the total pool LP, across {holderCount} address(es) — these can withdraw their share of liquidity at any time. Unless they can be shown to be unrelated to the project (a public market maker, say), treat this as a project-controlled rug-pull risk.{lpEvidenceText}',
  'findings.contract.relatedHoldsLpWithEvidence': 'Deployer-linked wallets hold circulating LP',
  'findings.contract.relatedHoldsLpWithEvidence.detail':
    'On-chain check: addresses linked to the deployer (the payer of the creation transaction, or a wallet that funded the creator\u2019s first trade) hold about {ofPoolPct}% of the total pool LP ({livePct}% of the circulating portion), across {holderCount} address(es) — these can withdraw their share of liquidity at any time. Unless they can be shown to be unrelated to the project (a public market maker, say), treat this as a project-controlled rug-pull risk.{lpEvidenceText}',
  'findings.contract.relatedHoldsLpNoLiveWithEvidence': 'Deployer-linked wallets hold circulating LP',
  'findings.contract.relatedHoldsLpNoLiveWithEvidence.detail':
    'On-chain check: addresses linked to the deployer (the payer of the creation transaction, or a wallet that funded the creator\u2019s first trade) hold about {ofPoolPct}% of the total pool LP, across {holderCount} address(es) — these can withdraw their share of liquidity at any time. Unless they can be shown to be unrelated to the project (a public market maker, say), treat this as a project-controlled rug-pull risk.{lpEvidenceText}',
  'findings.contract.creatorHoldsLp': 'The project holds circulating LP',
  'findings.contract.creatorHoldsLp.detail':
    'On-chain check: the creator address holds about {creatorPct}% of circulating LP ({ofPoolPct}% of the total pool LP), and can withdraw that share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.creatorHoldsLpNoPool': 'The project holds circulating LP',
  'findings.contract.creatorHoldsLpNoPool.detail':
    'On-chain check: the creator address holds about {creatorPct}% of circulating LP, and can withdraw that share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.creatorHoldsLpWithEvidence': 'The project holds circulating LP',
  'findings.contract.creatorHoldsLpWithEvidence.detail':
    'On-chain check: the creator address holds about {creatorPct}% of circulating LP ({ofPoolPct}% of the total pool LP), and can withdraw that share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.creatorHoldsLpNoPoolWithEvidence': 'The project holds circulating LP',
  'findings.contract.creatorHoldsLpNoPoolWithEvidence.detail':
    'On-chain check: the creator address holds about {creatorPct}% of circulating LP, and can withdraw that share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpInLocker': 'Most circulating LP sits in a lockup program',
  'findings.contract.lpInLocker.detail':
    'RugCheck reports: {lockPct}; on-chain verification shows {lockerPct}% of LP held by a lockup / vesting contract, with only about {withdrawablePct}% withdrawable by ordinary wallets at any time.{lpEvidenceText}{accountGapNote}⚠️ Lockups release linearly over time and become withdrawable as they unlock — check the unlock dates rather than treating this as permanently locked.',
  'findings.contract.lpInLockerNoPct': 'Most circulating LP sits in a lockup program',
  'findings.contract.lpInLockerNoPct.detail':
    'RugCheck reports no ratio; on-chain verification shows {lockerPct}% of LP held by a lockup / vesting contract, with only about {withdrawablePct}% withdrawable by ordinary wallets at any time.{lpEvidenceText}{accountGapNote}⚠️ Lockups release linearly over time and become withdrawable as they unlock — check the unlock dates rather than treating this as permanently locked.',
  'findings.contract.lpConcentrated': 'Circulating LP concentrated in one address',
  'findings.contract.lpConcentrated.detail':
    'On-chain check: about {topPct}% of circulating LP is held by a single address ({ofPoolPct}% of the total pool LP), so the pool\u2019s liquidity drops by that much when it withdraws.{lpEvidenceText}',
  'findings.contract.lpConcentratedNoPool': 'Circulating LP concentrated in one address',
  'findings.contract.lpConcentratedNoPool.detail':
    'On-chain check: about {topPct}% of circulating LP is held by a single address, so the pool\u2019s liquidity drops by that much when it withdraws.{lpEvidenceText}',
  'findings.contract.lpConcentratedWithEvidence': 'Circulating LP concentrated in one address',
  'findings.contract.lpConcentratedWithEvidence.detail':
    'On-chain check: about {topPct}% of circulating LP is held by a single address ({ofPoolPct}% of the total pool LP), so the pool\u2019s liquidity drops by that much when it withdraws.{lpEvidenceText}',
  'findings.contract.lpConcentratedNoPoolWithEvidence': 'Circulating LP concentrated in one address',
  'findings.contract.lpConcentratedNoPoolWithEvidence.detail':
    'On-chain check: about {topPct}% of circulating LP is held by a single address, so the pool\u2019s liquidity drops by that much when it withdraws.{lpEvidenceText}',
  'findings.contract.lpDistributed': 'Circulating LP spread across multiple addresses',
  'findings.contract.lpDistributed.detail':
    'About {livePct}% of LP is still circulating, spread across {holderCount} addresses (the largest holds {topPct}% of circulating LP). These are holders who each added their own liquidity — withdrawing their own share is normal AMM behaviour, not a project rug pull — but either way, pulling LP reduces pool depth.{lpEvidenceText}',
  'findings.contract.lpDistributedNoLive': 'Circulating LP spread across multiple addresses',
  'findings.contract.lpDistributedNoLive.detail':
    'Held across {holderCount} addresses (the largest holds {topPct}% of circulating LP). These are holders who each added their own liquidity — withdrawing their own share is normal AMM behaviour, not a project rug pull — but either way, pulling LP reduces pool depth.{lpEvidenceText}',
  'findings.contract.lpDistributedWithRelated': 'Circulating LP spread across multiple addresses',
  'findings.contract.lpDistributedWithRelated.detail':
    'About {livePct}% of LP is still circulating, spread across {holderCount} addresses (the largest holds {topPct}% of circulating LP), of which {relatedCount} are linked to the deployer (see the finding above — that portion is not third-party liquidity). Aside from the linked addresses, the rest are holders who each added their own liquidity, and withdrawing their own share is normal AMM behaviour (the linked portion is covered above and cannot be counted as third-party liquidity) — but either way, pulling LP reduces pool depth.{lpEvidenceText}',
  'findings.contract.lpDistributedNoLiveWithRelated': 'Circulating LP spread across multiple addresses',
  'findings.contract.lpDistributedNoLiveWithRelated.detail':
    'Held across {holderCount} addresses (the largest holds {topPct}% of circulating LP), of which {relatedCount} are linked to the deployer (see the finding above — that portion is not third-party liquidity). Aside from the linked addresses, the rest are holders who each added their own liquidity, and withdrawing their own share is normal AMM behaviour (the linked portion is covered above and cannot be counted as third-party liquidity) — but either way, pulling LP reduces pool depth.{lpEvidenceText}',
  'findings.contract.lpFewWallets': 'Circulating LP held by a few addresses',
  'findings.contract.lpFewWallets.detail':
    'On-chain check: {withdrawablePct}% of LP is held by {holderCount} ordinary wallets (the largest holds {topPct}% of circulating LP). These addresses can withdraw their share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpFewWalletsNoTop': 'Circulating LP held by a few addresses',
  'findings.contract.lpFewWalletsNoTop.detail':
    'On-chain check: {withdrawablePct}% of LP is held by {holderCount} ordinary wallets. These addresses can withdraw their share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpFewWalletsWithEvidence': 'Circulating LP held by a few addresses',
  'findings.contract.lpFewWalletsWithEvidence.detail':
    'On-chain check: {withdrawablePct}% of LP is held by {holderCount} ordinary wallets (the largest holds {topPct}% of circulating LP). These addresses can withdraw their share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpFewWalletsNoTopWithEvidence': 'Circulating LP held by a few addresses',
  'findings.contract.lpFewWalletsNoTopWithEvidence.detail':
    'On-chain check: {withdrawablePct}% of LP is held by {holderCount} ordinary wallets. These addresses can withdraw their share of liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolder': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedSingleHolder.detail':
    'LP is neither locked nor burned, and a single address {holder} holds it ({lockPct}). That address can pull all liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderNoPct': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedSingleHolderNoPct.detail':
    'LP is neither locked nor burned, and a single address {holder} holds it. That address can pull all liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderWithEvidence': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedSingleHolderWithEvidence.detail':
    'LP is neither locked nor burned, and a single address {holder} holds it ({lockPct}). That address can pull all liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpUnlockedSingleHolderNoPctWithEvidence': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedSingleHolderNoPctWithEvidence.detail':
    'LP is neither locked nor burned, and a single address {holder} holds it. That address can pull all liquidity at any time.{lpEvidenceText}',
  'findings.contract.lpUnlockedNoEvidence': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedNoEvidence.detail':
    'RugCheck reports{lockPctText}; on-chain verification shows {withdrawablePct}% of LP held by ordinary wallets, which can withdraw that liquidity at any time.{accountGapNote}⚠️ With no holder breakdown, do not assume it is the project.',
  'findings.contract.lpUnlockedWithEvidence': 'LP neither locked nor burned',
  'findings.contract.lpUnlockedWithEvidence.detail':
    'RugCheck reports{lockPctText}; on-chain verification shows {withdrawablePct}% of LP held by ordinary wallets, which can withdraw that liquidity at any time.{accountGapNote}RugCheck-recorded LP holders: {lpEvidenceText} — use this to check who holds the withdrawable portion.',
  'findings.contract.lpHoldersUnverifiable': 'Holders of circulating LP cannot be verified',
  'findings.contract.lpHoldersUnverifiable.detail':
    'RugCheck reports: {lockPct} (on-chain verification shows this ratio is LP no longer in circulation), but no LP holder breakdown was returned this time, so it is impossible to confirm who holds the remaining circulating portion — this is neither grounds for a rug-pull finding nor evidence of a lock.{lpMint}',
  'findings.contract.lpHoldersUnverifiableNoPct': 'Holders of circulating LP cannot be verified',
  'findings.contract.lpHoldersUnverifiableNoPct.detail':
    'RugCheck reports a ratio (on-chain verification shows it is LP no longer in circulation), but no LP holder breakdown was returned this time, so it is impossible to confirm who holds the remaining circulating portion — this is neither grounds for a rug-pull finding nor evidence of a lock.{lpMint}',
  'findings.contract.lpLockUnknown': 'LP lock status unknown',
  'findings.contract.lpLockUnknown.detail':
    'A liquidity pool definitely exists, but LP could not be verified as locked or burned — rug-pull risk stands.',
  'findings.contract.mutableMetadata': 'Mutable metadata',
  'findings.contract.mutableMetadata.detail':
    'The project can change the name/icon — common, but usable for impersonation.',

  // ── Liquidity & flow ──────────────────────────────────────────────
  'findings.liquidity.noData': 'Liquidity data missing',
  'findings.liquidity.noData.detail':
    'Could not fetch pool depth, volume or buy/sell counts, so liquidity pulls, wash trading and honeypot risk cannot be assessed. This dimension is excluded from the score — verify on DexScreener yourself.',
  'findings.liquidity.rugDetected': 'RugCheck has flagged this token as rugged',
  'findings.liquidity.rugDetected.detail':
    'RugCheck flagged this token as rugged based on on-chain liquidity and price history. There is no position size worth discussing here.',
  'findings.liquidity.lowCurveReserves': 'Very little real SOL in the curve',
  'findings.liquidity.lowCurveReserves.detail':
    'Only {sol} SOL, so the price is easily crushed by small amounts and slippage will be very high.',
  'findings.liquidity.notGraduated': 'Not graduated (still on the bonding curve)',
  'findings.liquidity.notGraduated.detail':
    'Real SOL in the curve: {sol}. At this stage there is no real liquidity pool, only curve depth.',
  'findings.liquidity.graduated': 'Graduated',
  'findings.liquidity.graduated.detail': 'Migrated to an AMM with a real liquidity pool.',
  'findings.liquidity.honeypot': 'Heavy buying but almost impossible to sell',
  'findings.liquidity.honeypot.detail':
    'Of {totalTrades} trades only {sellTrades} are sells ({countSharePct}%). One-sided buying usually is not strength — it means selling is restricted, the classic honeypot pattern.',
  'findings.liquidity.sellPressureDominant': 'Sell pressure dominates',
  'findings.liquidity.sellPressureDominant.detail':
    'Sell volume share {sellSharePct}%, net inflow {netInflowSol} SOL.{sizeEvidence}',
  'findings.liquidity.sellPressureDominantNoSol': 'Sell pressure dominates',
  'findings.liquidity.sellPressureDominantNoSol.detail':
    'Sell volume share {sellSharePct}% (amounts are in {volumeUnit}, so net inflow cannot be computed).{sizeEvidence}',
  'findings.liquidity.balancedInflow': 'Balanced flow with positive net inflow',
  'findings.liquidity.balancedInflow.detail':
    'Sell volume share {sellSharePct}%, net inflow +{netInflowSol} SOL — buyers slightly stronger with normal sell pressure and healthy turnover.',
  'findings.liquidity.countVolumeDivergence': 'Trade count and volume diverge',
  'findings.liquidity.countVolumeDivergence.detail':
    'Buy orders outnumber sells by {countRatio}x, but buy volume is only {volRatioPct}% of sell volume. Small buys are padding the count while large sells distribute.{sizeEvidence}{sellEvidence}',
  'findings.liquidity.countVolumeDivergenceNoSol': 'Trade count and volume diverge',
  'findings.liquidity.countVolumeDivergenceNoSol.detail':
    'Buy orders outnumber sells by {countRatio}x, but buy volume is only {volRatioPct}% of sell volume. Small buys are padding the count while large sells distribute. (Amounts are in {volumeUnit}; per-trade SOL size is unavailable, so this cannot be cross-checked further.){sellEvidence}',
  'findings.liquidity.washTrading': 'Suspected wash trading',
  'findings.liquidity.washTrading.detail':
    '{totalTrades} trades, {totalVolSol} SOL volume, net inflow only {netInflowSol} SOL ({netRatioPct}% of volume). High trade count with near-zero net inflow is usually bots wash-trading to fake momentum.',
  'findings.liquidity.washTradeUnknown': 'Wash trading cannot be determined',
  'findings.liquidity.washTradeUnknown.detail':
    'Got {totalTrades} trades but no SOL-denominated buy/sell amounts (that needs the Helius Enhanced API), so net inflow cannot be used to detect wash trading — only trade counts are available.',

  // ── Holder concentration ──────────────────────────────────────────
  'findings.holders.noData': 'Holder data missing',
  'findings.holders.noData.detail':
    'Could not fetch holder distribution, so manipulation by a dominant holder cannot be assessed. This dimension is excluded from the score — check the holder distribution on RugCheck / Solscan.',
  'findings.holders.caliberNotApplicable': 'Only {holderCount} holders — percentage caliber does not apply',
  'findings.holders.caliberNotApplicable.detail':
    'This token has only {holderCount} holding addresses (below the {minHolders}-holder floor for this statistic), so the Top 10 percentages lose their meaning: the float after excluding pool/burn is tiny, and a few addresses can fill the denominator. Measured on such tokens, median concentration computed "of float" is 90–100%, while "of supply" is only 31–51% — a 20–49 point gap showing **denominator distortion**, not genuinely higher concentration.\nKnown composition of the Top 10: {kinds}. ⚠️ Few holders is itself the biggest risk: with no exit depth, any single sell can crush the price. Check the holder detail address by address instead of relying on the concentration numbers above.',
  'findings.holders.excludedPoolBurnFull': 'Pool and burn addresses excluded',
  'findings.holders.excludedPoolBurnFull.detail':
    'Concentration is computed after excluding {excludedPct}% held by pool / burn / lockup, so normal liquidity is not mistaken for insider control. Real float {circulatingPct}%.',
  'findings.holders.excludedPoolBurnSample': 'Pool and burn addresses excluded',
  'findings.holders.excludedPoolBurnSample.detail':
    'Concentration is computed after excluding {excludedPct}% held by pool / burn / lockup, so normal liquidity is not mistaken for insider control. Real float {circulatingPct}%. (This uses the top-20 holder sample; loading the full holder distribution makes the ratio more accurate.)',
  'findings.holders.top10Danger': 'Top10 holdings overly concentrated',
  'findings.holders.top10Danger.detail':
    'After excluding pool / burn / lockup, the top 10 holders control {top10Pct}% of float (threshold {threshold}%). A few addresses can dump at will. (This token has {holderCount} holders, so the percentage caliber is valid.)',
  'findings.holders.top10Warn': 'Top10 holdings somewhat concentrated',
  'findings.holders.top10Warn.detail':
    'The top 10 holders control {top10Pct}% of float, above the {threshold}% warning line.',
  'findings.holders.top10Healthy': 'Healthy holder distribution',
  'findings.holders.top10Healthy.detail': 'The top 10 holders control only {top10Pct}% of float.',
  'findings.holders.singleWhale': 'Single whale present',
  'findings.holders.singleWhale.detail':
    '{who} {address} holds {circulatingPct}% of float ({supplyPct}% of total supply, float {circulatingDenominatorPct}%). A sell of that size would cause significant slippage.',
  'findings.holders.singleWhaleCustody': 'Single whale present',
  'findings.holders.singleWhaleCustody.detail':
    '{who} {address} holds {circulatingPct}% of float ({supplyPct}% of total supply, float {circulatingDenominatorPct}%). A sell of that size would cause significant slippage. (Custody is not a lock: a multisig can sign it out at any time, so it still counts toward the whale test.)',
  'findings.holders.sniperHeavy': 'Sniper wallets hold a large share',
  'findings.holders.sniperHeavy.detail':
    'Wallets from the earliest trades currently hold {circulatingPct}% of float ({supplyPct}% of total supply) combined, and can dump at any time. (Creator self-buys are excluded; only the portion still in the top 20 is counted, so this is a lower bound. It does not appear when unknown.)',
  'findings.holders.devClusterHigh': 'Dev holdings are high',
  'findings.holders.devClusterHigh.detail':
    'The creator address holds {devCirculatingPct}% of float ({devSupplyPct}% of total supply), and deployer-linked wallets hold {relatedCirculatingPct}% of float ({relatedSupplyPct}% of total supply) — {clusterCirculatingPct}% of float combined (threshold {threshold}%).',
  'findings.holders.devClusterReasonable': 'Dev holdings within a reasonable range',
  'findings.holders.devClusterReasonable.detail':
    'The creator address holds {devCirculatingPct}% of float ({devSupplyPct}% of total supply) — {clusterCirculatingPct}% of float combined ({clusterSupplyPct}% of total supply).',
  'findings.holders.devClusterReasonableWithRelated': 'Dev holdings within a reasonable range',
  'findings.holders.devClusterReasonableWithRelated.detail':
    'The creator address holds {devCirculatingPct}% of float ({devSupplyPct}% of total supply), and linked wallets hold {relatedCirculatingPct}% of float ({relatedSupplyPct}% of total supply) — {clusterCirculatingPct}% of float combined ({clusterSupplyPct}% of total supply).',
  'findings.holders.fewHoldersConcentrated': 'Few holders, heavily concentrated',
  'findings.holders.fewHoldersConcentrated.detail':
    'Only {holderCount} holders combined with {top10Pct}% concentration means no exit depth.',
  'findings.holders.programCustody': 'Program-custodied holdings are {circulatingPct}% of float (not excluded)',
  'findings.holders.programCustody.detail':
    '{count} positions are program-controlled ({labels}), totalling {circulatingPct}% of float ({supplyPct}% of total supply). ⚠️ Multisig/custody is **not a timelock** — it can be signed out at any time, so it still counts toward concentration; it is listed separately here just so you can see it.',
  'findings.holders.timelockKnownUnlock': 'Locked holdings {timelockPct}% (excluded from concentration)',
  'findings.holders.timelockKnownUnlock.detail':
    '{count} time-locked positions ({labels}) total {timelockPct}% and cannot be sold before unlocking, so they are excluded from the Top10 and whale tests. Unlock dates: first {firstUnlockAt}, fully unlocked {allUnlockAt}. ⚠️ Lockups release linearly over time and become sellable once unlocked.',
  'findings.holders.timelockUnknownUnlock': 'Locked holdings {timelockPct}% (excluded from concentration)',
  'findings.holders.timelockUnknownUnlock.detail':
    '{count} time-locked positions ({labels}) total {timelockPct}% and cannot be sold before unlocking, so they are excluded from the Top10 and whale tests. ⚠️ Unlock dates could not be read, so this is honestly marked as "not yet available" — that is not the same as "already unlocked"; watch the expiry dates separately.',

  // ── Developer ─────────────────────────────────────────────────────
  'findings.developer.noData': 'Developer data missing',
  'findings.developer.noData.detail':
    'No deployer information was collected. Historical rug records, dev sell ratio and linked wallets all need an indexer, so none could be assessed — verify the creator address history manually.',
  'findings.developer.creatorUnknown': 'Deployer identity unknown',
  'findings.developer.creatorUnknown.detail':
    'None of the three sources (curve program state, metadata, creation transaction) could determine the creator, so the developer-dimension conclusions cannot be attributed to any specific address.',
  'findings.developer.creatorInferred': 'Deployer identity is inferred',
  'findings.developer.creatorInferred.detail':
    'The creator could not be read from the pump.fun curve or metadata, so the payer of the creation transaction, `{creator}`, is used as the deployer — when a token is launched through a bundler/launchpad, that address is the wallet paying the fee, not the real dev. Discount the dev buy/sell conclusions below accordingly.',
  'findings.developer.launchWalletDiffers': 'Creation wallet is not the creator address',
  'findings.developer.launchWalletDiffers.detail':
    'The developer dimension here is computed from the creator `{creator}`, while the payer of the creation transaction is `{launchWallet}` — the wallet that pays to launch is not necessarily the dev (bundlers/launchpads often launch and then hand the creator over to the real dev). Do not conflate the two.',
  'findings.developer.noPriorTokens': 'No prior token launches',
  'findings.developer.noPriorTokens.detail':
    'The creator is a brand-new wallet. No track record of rugs, but no verifiable success either — this earns no credit.',
  'findings.developer.priorTokensUnverified': 'Outcome of prior launches unverified',
  'findings.developer.priorTokensUnverified.detail':
    'This creator has launched {count} other tokens, but this tool does not trace price/liquidity history, so it cannot tell whether any of them rugged — verify that address\u2019s history manually and do not read this as a "clean record".',
  'findings.developer.bulkLaunch': 'Bulk token launches in a short period',
  'findings.developer.bulkLaunch.detail':
    'This creator launched {count} tokens in the last 7 days. Spray-and-pray launching usually means no intention of building long term.',
  'findings.developer.creatorDumped': 'Deployer fully exited',
  'findings.developer.creatorDumped.detail':
    'The creator has sold the entire position. The team is gone — there is no reason to stay.',
  'findings.developer.devHeavyDump': 'Deployer heavily sold',
  'findings.developer.devHeavyDump.detail': 'Has sold {soldPct}% of what they bought.',
  'findings.developer.devHeavyDumpFast': 'Deployer heavily sold',
  'findings.developer.devHeavyDumpFast.detail':
    'Has sold {soldPct}% of what they bought, with the first sell just {minutes} minutes after launch — a fast exit.',
  'findings.developer.devSold': 'Deployer has sold',
  'findings.developer.devSold.detail':
    'Based on available trade history, sells amount to about {soldPct}% of what they bought (the history window is limited, so this ratio may be distorted). Note: recovering some cost is common in meme coins and is not a rug by itself; but the on-chain balance could not be confirmed, so check the creator address\u2019s current holdings yourself.',
  'findings.developer.devHeld': 'Deployer has not sold',
  'findings.developer.devHeld.detail':
    'The creator still holds {holdingPct}% of what they bought, with no sells observed.',
  'findings.developer.linkedWallet': 'Creator\u2019s first funds came from another wallet',
  'findings.developer.linkedWallet.detail':
    'The first trade was funded by {wallet}. This only shows the source of funds — it is not enough to determine whether that is an intermediary or a mixer. Check that wallet\u2019s nature yourself.',

  // ── Diamond hands ─────────────────────────────────────────────────
  'findings.diamond.noData': 'Holding behaviour cannot be analysed',
  'findings.diamond.noData.detail':
    'Per-address trade detail was not available (the Helius enhanced API was unavailable, or the token has no trades yet), so it is impossible to tell who buys and does not sell. This is not "no diamond hands" — it means this item has no data.',
  'findings.diamond.windowCoverageLow': 'Trade window covers only {coveragePct}% of the timespan',
  'findings.diamond.windowCoverageLow.detail':
    'Recent trades only cover the last {trades} and the first {earlyTrades}, so the counts and ratios below are **observations within the window and almost certainly understated**: wallets that bought during the gap and held are not in the sample. A complete picture requires pulling history per address (not implemented).',
  'findings.diamond.windowCoverageLowWithGap': 'Trade window covers only {coveragePct}% of the timespan',
  'findings.diamond.windowCoverageLowWithGap.detail':
    'Recent trades only cover the last {trades} and the first {earlyTrades}, with about {gapDays} days of missing data in between. So the counts and ratios below are **observations within the window and almost certainly understated**: wallets that bought during the gap and held are not in the sample. A complete picture requires pulling history per address (not implemented).',
  'findings.diamond.noLongTermHolders': 'No long-term holders found',
  'findings.diamond.noLongTermHolders.detail':
    'Among {analyzed} analysable wallets, none match "bought and never sold, still holding, held over {minHoldDays} days".',
  'findings.diamond.noLongTermHoldersWithGap': 'No long-term holders found',
  'findings.diamond.noLongTermHoldersWithGap.detail':
    'Among {analyzed} analysable wallets, none match "bought and never sold, still holding, held over {minHoldDays} days". ⚠️ About {gapDays} days in the middle of the trade window were not retrieved, so this only means "not seen within the window" — it does not prove nobody held long term.',
  'findings.diamond.robotsExcluded': 'Excluded {count} high-frequency addresses',
  'findings.diamond.robotsExcluded.detail':
    'These addresses alternate buys and sells ≥ {robotTrades} times within the window — bot/market-making behaviour rather than diamond hands or retail, so they are excluded from the ratio (including them would completely skew the holding structure).',
  'findings.diamond.holders': 'Diamond hands: {count} (median hold {medianHoldDays} days)',
  'findings.diamond.holders.detail':
    'Of {analyzed} analysable wallets, {count} match "bought and never sold + still holding + held ≥ {minHoldDays} days", {sharePct}% of the total; {strongEvidence} fall within the earliest trade window (strongest evidence) and {addOnCount} added to their position.{topSentence}',
  'findings.diamond.holdersLowCoverage': 'Diamond hands: {count} (median hold {medianHoldDays} days)',
  'findings.diamond.holdersLowCoverage.detail':
    'Of {analyzed} analysable wallets, {count} match "bought and never sold + still holding + held ≥ {minHoldDays} days", {sharePct}% of the total (⚠️ the window covers only {coveragePct}% of the timespan, so the real number should be higher); {strongEvidence} fall within the earliest trade window (strongest evidence) and {addOnCount} added to their position.{topSentence}',
  'findings.diamond.concentratedInLongTerm': 'Supply concentrated among long-term holders',
  'findings.diamond.concentratedInLongTerm.detail':
    'Diamond hands make up {sharePct}% of analysable wallets, suggesting this supply is unlikely to be dumped soon. ⚠️ This describes holding structure only and is not a reason to buy — holders of older tokens naturally hold longer than those of new ones.',

  // ── Sell pressure ─────────────────────────────────────────────────
  'findings.sellPressure.noData': 'Sell pressure distribution cannot be computed',
  'findings.sellPressure.noData.detail':
    'No pairable per-trade data was retrieved (needs both an address\u2019s SOL delta and its token delta), so cost basis cannot be computed. This is not "no sell pressure" — it means this item has no data.',
  'findings.sellPressure.lowAttribution': 'Only {attributionPct}% of trades can be matched to a cost basis',
  'findings.sellPressure.lowAttribution.detail':
    'Of {windowTrades} trades in the window, only {paired} yield both an SOL and a token delta; the rest booked token movements to other accounts (intermediaries/aggregators) and cannot be attributed to a specific buyer. The distribution below therefore **covers only a small part of the supply** and is not the whole picture.',
  'findings.sellPressure.priceUnavailable': 'Implied price unreliable — P&L column disabled',
  'findings.sellPressure.priceUnavailable.detail':
    'No trade in the window allows a price to be inferred.',
  'findings.sellPressure.priceTooOld': 'Implied price unreliable — P&L column disabled',
  'findings.sellPressure.priceTooOld.detail':
    'The most recent trade in the window was {ageHours} hours ago, beyond the {maxAgeHours}-hour freshness limit, so that price no longer represents the current price.',
  'findings.sellPressure.mintedWallets': '{count} addresses obtained tokens by mint/creation (no buy price)',
  'findings.sellPressure.mintedWallets.detail':
    'These addresses received about {tokens} tokens through the creation/mint transaction and paid only network fees — they have **no cost basis**, so they are excluded from the P&L buckets (treating fees as cost yields absurd "gains" of hundreds of thousands of percent). Sell pressure from this supply can only be measured as a share: selling at any price is pure profit for them.',
  'findings.sellPressure.unsoldSummary': 'Unsold supply {unsoldPctOfCirculating}% of float (analysable portion)',
  'findings.sellPressure.unsoldSummary.detail':
    'Unsold supply across {walletCount} wallets costs {totalCostSol} SOL at cost basis; {inProfitCount} are in profit.{biggestTail}⚠️ This covers **only the portion matchable within the window**, not all holdings.',
  'findings.sellPressure.unsoldSummaryBackToEven': 'Unsold supply {unsoldPctOfCirculating}% of float (analysable portion)',
  'findings.sellPressure.unsoldSummaryBackToEven.detail':
    'Unsold supply across {walletCount} wallets costs {totalCostSol} SOL at cost basis; {inProfitCount} are in profit. {backToEvenWallets} wallets totalling {backToEvenPct}% of float sit in the break-even band (-10% to +10%) — that band is the most likely trigger for selling.{biggestTail}⚠️ This covers **only the portion matchable within the window**, not all holdings.',
  'findings.sellPressure.exited': '{exited} wallets have essentially sold out',
  'findings.sellPressure.exited.detail':
    'Within the window these addresses sold ≥ {exitedSoldPct}% of what they bought, so they **no longer count toward sell pressure** — regardless of how much they made (supply that has already left will not dump again).',
  'findings.sellPressure.exitedWithDistributing': '{exited} wallets have essentially sold out',
  'findings.sellPressure.exitedWithDistributing.detail':
    'Within the window these addresses sold ≥ {exitedSoldPct}% of what they bought, so they **no longer count toward sell pressure** — regardless of how much they made (supply that has already left will not dump again). Another {distributing} are distributing (sold {distributingSoldPct}%–{exitedSoldPct}%) and count only for their remaining portion.',
  'findings.sellPressure.deepCoverage': '{deepWallets} wallets have cost basis from full history (not a window estimate)',
  'findings.sellPressure.deepCoverage.detail':
    'Deep mode pulled the full trade history per address for the top {deepAddresses} holders, of which {deepWallets} yield a **real cost basis** and **real sold ratio**. These addresses are unaffected by the gap in the middle of the trade window — their sell records are complete, so rows marked "full history" in the table are markedly more reliable than rows marked "window estimate".',

  // ── Social ────────────────────────────────────────────────────────
  'findings.social.noData': 'Social data missing',
  'findings.social.noData.detail':
    'Could not fetch social buzz data. Community quality cannot be derived on-chain, so this dimension is excluded from the score — verify the project\u2019s X / TG yourself.',
  'findings.social.zeroMentions': 'Zero social mentions',
  'findings.social.zeroMentions.detail':
    'No social mentions detected in the past 24 hours. A project with no community rarely has exit depth.',
  'findings.social.lowHype': 'Social buzz is low',
  'findings.social.lowHype.detail': 'Only {mentions} mentions in 24h — not enough buzz.',
  'findings.social.goodHype': 'Social buzz is sufficient',
  'findings.social.goodHype.detail': '{mentions} mentions in 24h, {growth}% change period over period.',
  'findings.social.suspectedBots': 'Social buzz looks inflated',
  'findings.social.suspectedBots.detail':
    'About {pct}% of mentions come from suspected bot accounts (the same cohort of accounts appearing across multiple meme coins, templated copy, abnormal interaction timing).',
  'findings.social.qualityDoubt': 'Social interaction quality in doubt',
  'findings.social.qualityDoubt.detail':
    '{pct}% of mentions come from suspected bots; the real community share needs manual verification.',
  'findings.social.retweetHeavy': 'Far more retweets than replies',
  'findings.social.retweetHeavy.detail':
    'Retweet/reply ratio {ratio} — a common shape for bought engagement (real communities are discussion-led).',
  'findings.social.tgSpiky': 'Step-change growth in TG members',
  'findings.social.tgSpiky.detail':
    'Member count jumped rather than growing smoothly, consistent with bought followers.',
  'findings.social.fewAuthors': 'Mentions highly concentrated among a few accounts',
  'findings.social.fewAuthors.detail':
    'Averaging {perAuthor} posts per account, indicating a few accounts spamming repeatedly.',
  'findings.social.decaying': 'Buzz is decaying',
  'findings.social.decaying.detail':
    'Mentions changed {growth}% period over period — community attention is declining.',
  'findings.social.lowEngagement': 'Low engagement rate',
  'findings.social.lowEngagement.detail':
    'Real interaction is only {pct}%, so the buzz may be inflated.',
};
