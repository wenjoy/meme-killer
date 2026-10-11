/**
 * 全量持有人明细 API —— 只服务**已经扫描过**的代币。
 *
 * GET /api/holders?mint=…&page=1&pageSize=50&q=&kind=&includeEmpty=0&format=json|csv
 *
 * 为什么不在这里现拉链上数据：明细要复用扫描时算好的分类（池 / 销毁 / 锁仓 /
 * dev / 关联 / 狙击），而这份分类依赖池地址推导、creator 解析、托管反查 ——
 * 在这里重做等于把半个扫描再跑一遍。
 * 所以扫描时把合并分类后的持有人列表缓存下来（10 分钟），这里只做筛选与分页；
 * 缓存过期就明确要求重新扫描，**不拿旧数据假装是新的**。
 *
 * 全量数据是几千到几万行，绝不能一次性返回给浏览器（几 MB），
 * 因此分页在服务端做，CSV 也在服务端生成。
 */
import { NextResponse } from 'next/server';

import { MAX_PAGE_SIZE, getCachedOwnerList, toHolderRows } from '@/providers/holderList';
import type { HolderKind } from '@/core/analyzers/holders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: HolderKind[] = [
  'pool',
  'burn',
  'timelock',
  'custody',
  'dev',
  'related',
  'sniper',
  'retail',
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mint = (url.searchParams.get('mint') ?? '').trim();
  if (!mint) return NextResponse.json({ error: '请提供 mint 地址' }, { status: 400 });

  const cached = getCachedOwnerList(mint);
  if (!cached) {
    return NextResponse.json(
      {
        error:
          '该代币的全量持有人明细不在缓存里（或已过期）。请先扫描一次该代币，再点「加载全部持有人」。',
        code: 'NEED_SCAN',
      },
      { status: 409 },
    );
  }

  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get('pageSize') ?? '50') || 50),
  );
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const includeEmpty = url.searchParams.get('includeEmpty') === '1';
  const kinds = (url.searchParams.get('kind') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is HolderKind => (KINDS as string[]).includes(k));

  let rows = cached.owners;
  if (!includeEmpty) rows = rows.filter((o) => o.amount > 0);
  if (kinds.length > 0) rows = rows.filter((o) => kinds.includes(o.kind));
  if (q) rows = rows.filter((o) => o.owner.toLowerCase().includes(q));

  const meta = {
    ...cached.meta,
    cacheAgeMs: cached.ageMs,
    page,
    pageSize,
    filtered: rows.length,
    totalOwners: cached.owners.length,
  };

  if (url.searchParams.get('format') === 'csv') {
    const header = ['排名', '地址', '数量', '占总供应百分比', '分类', '计入集中度', '名下账户数'];
    const body = rows.map((o, i) =>
      [i + 1, o.owner, o.amount, o.pct.toFixed(8), o.kind, o.counted ? '是' : '否', o.accounts]
        .map(csvCell)
        .join(','),
    );
    return new NextResponse(`\uFEFF${[header.join(','), ...body].join('\n')}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="holders-${mint.slice(0, 8)}.csv"`,
      },
    });
  }

  const start = (page - 1) * pageSize;
  return NextResponse.json({
    mint,
    meta,
    rows: toHolderRows(rows.slice(start, start + pageSize)),
  });
}
