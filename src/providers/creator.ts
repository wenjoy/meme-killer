/**
 * 部署者（creator）的三级来源解析。
 *
 * 实测教训：同一个代币上「创建交易的付款方」与「程序记录的 creator」可以
 * **完全不是一个地址**（`9raUVuze…pump`：付款方 4JBz4tAK… ≠ 曲线里的 Fpi4NERk…）。
 *
 * - 创建交易的付款方只是**付手续费的钱包**。用打包器/launchpad 发币时它是打包器，
 *   不是 dev；README §6 一直这么写，但代码曾经直接拿它当 creator。
 * - pump.fun 把 creator 写在 bonding curve 账户第 49..81 字节（creator fee 收款方），
 *   那是程序自己的状态，也是 `set_creator` 能改的字段 —— 最权威。
 * - pump.fun 代币的 metadata `creators` 实测为空（链上账户也为空），
 *   所以那一级基本只在别的发行平台生效；保留它是为了不把非 pump.fun 的代币判成未知。
 *
 * 抽成纯函数是为了能直接测「谁优先」这件事本身 —— 顺序错了整个开发者维度都在追错人。
 */
export interface CreatorResolution {
  creator?: string;
  source?: 'curve' | 'metadata' | 'create-tx';
  /** 创建交易的付款方；与 creator 不同时才有值（UI 单独展示） */
  launchWallet?: string;
  warnings: string[];
}

export function resolveCreator(input: {
  curveCreator?: string;
  metadataCreator?: string;
  launchWallet?: string;
}): CreatorResolution {
  const { curveCreator, metadataCreator, launchWallet } = input;
  const creator = curveCreator ?? metadataCreator ?? launchWallet;
  const source: CreatorResolution['source'] = curveCreator
    ? 'curve'
    : metadataCreator
      ? 'metadata'
      : launchWallet
        ? 'create-tx'
        : undefined;
  const warnings: string[] = [];

  if (!creator) {
    warnings.push(
      '未能确定部署者地址：pump.fun 曲线状态、metadata creators、创建交易付款方三处都没取到。',
    );
    return { warnings };
  }
  if (source === 'create-tx') {
    warnings.push(
      `未能读到 pump.fun 曲线或 metadata 里的 creator，部署者身份取自创建交易的付款方 ` +
        `${launchWallet}（**推断值**：用打包器/launchpad 发币时，这个地址不是真正的 dev）。`,
    );
  }
  if (launchWallet && launchWallet !== creator) {
    warnings.push(
      `创建交易的付款方 ${launchWallet} 与程序记录的 creator ${creator} **不是同一个地址**：` +
        '本报告的开发者维度按 creator 计算（程序状态更权威）；付款方可能是打包器/launchpad，' +
        '不要把两者混为一谈。',
    );
    return { creator, source, launchWallet, warnings };
  }
  return { creator, source, warnings };
}
