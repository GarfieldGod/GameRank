/**
 * SteamGridDB 封面回填脚本
 * 遍历游戏库（默认只处理无封面 / 封面为空或用 '?' 占位的游戏；传 --all 则全部刷新），
 * 按英文名（兜底中文名）搜索 SteamGridDB → 取一张封面 → 下载到本地 uploads/sgdb → 更新库。
 *
 * 用法：
 *   node scripts/sgdb-backfill.mjs          # 只补无封面的
 *   node scripts/sgdb-backfill.mjs --all     # 无视现有封面，全部重新获取
 */
import "dotenv/config";
import prisma from "../src/prismaClient.js";
import { sgdbSearch, sgdbGrids, pickGrid, downloadCover, normalizeName } from "../src/services/sgdb.js";

const ALL = process.argv.includes("--all");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 名称归一化：小写、去特殊符号与多余空格，返回结果名也做同样处理便于比对
const norm = normalizeName;

// 从搜索结果里挑最符合的：优先名称完全等于查询词，其次包含查询词，最后取第一个
function pickMatch(results, query) {
  if (!Array.isArray(results) || !results.length) return null;
  const q = norm(query);
  return (
    results.find((r) => norm(r.name) === q) ||
    results.find((r) => norm(r.name).includes(q)) ||
    results.find((r) => q.includes(norm(r.name))) ||
    results[0]
  );
}

const games = await prisma.game.findMany({ where: { status: "APPROVED" } });
const targets = ALL ? games : games.filter((g) => !g.coverImageUrl || g.coverImageUrl.endsWith("/sgdb/?"));

console.log(`[SGDB] 共 ${games.length} 个已通过游戏，本批处理 ${targets.length} 个。`);

let ok = 0;
let skipped = 0;
let failed = 0;

for (const game of targets) {
  const label = `${game.nameZh}${game.nameEn ? "/" + game.nameEn : ""}`;
  try {
    let gridId = game.steamgriddbId;
    if (!gridId) {
      // 优先英文名搜索，搜不到再用中文名
      const names = [game.nameEn, game.nameZh].filter(Boolean);
      let match = null;
      for (const n of names) {
        const res = await sgdbSearch(n);
        match = pickMatch(res, n);
        if (match) {
          gridId = match.id;
          break;
        }
      }
      if (!gridId) {
        skipped++;
        console.log(`  - 跳过 ${label}: SteamGridDB 搜不到`);
        continue;
      }
    }

    const grids = await sgdbGrids(gridId);
    const g = pickGrid(grids);
    if (!g) {
      skipped++;
      console.log(`  - 跳过 ${label}: 该游戏无封面`);
      continue;
    }

    const coverImageUrl = await downloadCover(g.url);
    await prisma.game.update({
      where: { id: game.id },
      data: { coverImageUrl, steamgriddbId: gridId },
    });
    ok++;
    console.log(`  + ${label} -> ${coverImageUrl}`);
    await sleep(200); // 下载之间稍作间隔
  } catch (err) {
    failed++;
    console.error(`  ! ${label} 失败: ${err?.message || err}`);
    await sleep(600);
  }
}

console.log(`\n[SGDB] 完成：成功 ${ok}，跳过 ${skipped}，失败 ${failed}。`);
await prisma.$disconnect();