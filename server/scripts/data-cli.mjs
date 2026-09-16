/**
 * 站点数据管理 CLI（仅站长在服务器上运行）
 *
 * 用法：
 *   node scripts/data-cli.mjs <entity> <action> [选项]
 *
 * entity: games | reviews
 * action: export | import
 *
 * 选项：
 *   --file <path>        导入时必填：JSON 文件路径
 *   --out <dir>          导出目录（默认 ./data）
 *   --backup-dir <dir>   导入前自动备份目录（默认 ./backups）
 *   --dry-run            仅预览导入结果，不写入数据库
 *
 * 另支持：
 *   node scripts/data-cli.mjs backup   备份游戏与评测两类数据
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const prisma = new PrismaClient();

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const positional = [];
  const flags = { file: null, out: "./data", backupDir: "./backups", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file" || a === "--out" || a === "--backup-dir") {
      flags[a.slice(2).replace("-", "")] = argv[++i];
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--help" || a === "-h") {
      flags.help = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------- 共通工具 ----------
function parseTags(t) {
  if (t == null) return [];
  if (Array.isArray(t)) return t;
  try {
    const a = JSON.parse(t);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return path.resolve(dir);
}

async function readJsonFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    throw new Error(`无法读取文件: ${file}（${err.code || err.message}）`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`不是合法的 JSON 文件: ${file}`);
  }
  if (!Array.isArray(data)) throw new Error("JSON 顶层必须是数组");
  return data;
}

// ---------- 导出 ----------
async function exportEntity(entity, outDir) {
  const rows =
    entity === "games"
      ? await prisma.game.findMany({ orderBy: { id: "asc" } })
      : await prisma.gameReview.findMany({ orderBy: { id: "asc" } });

  const data =
    entity === "games"
      ? rows.map((g) => ({ ...g, tags: parseTags(g.tags) }))
      : rows.map((r) => ({
          id: r.id, gameName: r.gameName, coverImageUrl: r.coverImageUrl,
          title: r.title, content: r.content, rating: r.rating,
          ratingParams: r.ratingParams ? JSON.parse(r.ratingParams) : [],
          status: r.status,
          tags: parseTags(r.tags), authorId: r.authorId,
          publishedAt: r.publishedAt, updatedAt: r.updatedAt,
        }));

  const dir = await ensureDir(outDir);
  const file = path.join(dir, `${entity}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
  return { count: data.length, file };
}

// ---------- 导入 ----------
function stripId(item) {
  const { id, createdAt, updatedAt, publishedAt, ...rest } = item;
  return rest;
}

async function importGames(list, { dryRun }) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of list) {
    const nameZh = String(item?.nameZh || "").trim();
    if (!nameZh) { skipped += 1; continue; }

    let tags = null;
    if (Array.isArray(item.tags)) tags = JSON.stringify(item.tags);
    else if (typeof item.tags === "string") tags = item.tags;

    const nameEn =
      typeof item.nameEn === "string" && item.nameEn.trim() ? item.nameEn.trim() : nameZh;
    const score = item.score === undefined || item.score === null ? null : Number(item.score);

    const data = {
      nameEn,
      coverImageUrl: typeof item.coverImageUrl === "string" ? item.coverImageUrl : null,
      score: Number.isNaN(score) ? null : score,
      developer: typeof item.developer === "string" ? item.developer : null,
      publisher: typeof item.publisher === "string" ? item.publisher : null,
      description: typeof item.description === "string" ? item.description : "",
      tags,
    };

    const existing = await prisma.game.findUnique({ where: { nameZh } });
    if (existing) {
      if (!dryRun) await prisma.game.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      if (!dryRun) await prisma.game.create({ data: { nameZh, ...data } });
      created += 1;
    }
  }
  return { created, updated, skipped, total: list.length };
}

async function importReviews(list, { dryRun }) {
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const item of list) {
    const gameName = String(item?.gameName || "").trim();
    const title = String(item?.title || "").trim();
    if (!gameName || !title) { failed += 1; continue; }
    try {
      let tags = null;
      if (Array.isArray(item.tags)) tags = JSON.stringify(item.tags);
      else if (typeof item.tags === "string") tags = item.tags;

      const rating = Number(item.rating);
      const data = {
        gameName,
        coverImageUrl: typeof item.coverImageUrl === "string" ? item.coverImageUrl : null,
        title,
        content: typeof item.content === "string" ? item.content : "",
        rating: Number.isNaN(rating) ? 0 : rating,
        ratingParams: Array.isArray(item.ratingParams) ? JSON.stringify(item.ratingParams) : null,
        status: item.status === "DRAFT" ? "DRAFT" : "PUBLISHED",
        tags,
        authorId: item.authorId == null ? undefined : Number(item.authorId),
      };

      const id = Number(item.id);
      if (id) {
        const existing = await prisma.gameReview.findUnique({ where: { id } });
        if (existing) {
          if (!dryRun) await prisma.gameReview.update({ where: { id }, data });
          updated += 1;
        } else {
          if (!dryRun) await prisma.gameReview.create({ data: { ...data, id } });
          created += 1;
        }
      } else {
        if (!dryRun) await prisma.gameReview.create({ data });
        created += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { created, updated, failed, total: list.length };
}

// ---------- 备份（导入前自动调用）----------
async function backupAll(backupDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await ensureDir(path.resolve(ROOT, backupDir, ts));
  const { file: games, count: gc } = await exportEntity("games", dir);
  const { file: reviews, count: rc } = await exportEntity("reviews", dir);
  console.log(`[备份] 已保存游戏 ${gc} 条、评测 ${rc} 条 -> ${path.relative(ROOT, dir)}`);
  return { games, reviews };
}

async function fileExists(file) {
  try { await access(file); return true; } catch { return false; }
}

// ---------- 主流程 ----------
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [entity, action] = positional;

  if (flags.help || entity === "help") return printHelp();

  if (entity === "backup") {
    await backupAll(flags.backupDir);
    return;
  }

  if (!["games", "reviews"].includes(entity) || !["export", "import"].includes(action)) {
    return printHelp();
  }

  if (action === "export") {
    const { count, file } = await exportEntity(entity, path.resolve(ROOT, flags.out));
    console.log(`[导出] ${entity}: ${count} 条 -> ${path.relative(ROOT, file)}`);
    return;
  }

  // import
  if (!flags.file) {
    console.error("导入必须指定 --file <path>");
    process.exitCode = 1;
    return;
  }
  const src = path.resolve(ROOT, flags.file);
  if (!(await fileExists(src))) {
    console.error(`文件不存在: ${src}`);
    process.exitCode = 1;
    return;
  }
  const list = await readJsonFile(src);

  if (!flags.dryRun) {
    await backupAll(flags.backupDir);
  }

  const result =
    entity === "games"
      ? await importGames(list, flags)
      : await importReviews(list, flags);

  if (flags.dryRun) {
    console.log(
      `[预览]（未写入）${entity}: 新增 ${result.created}，更新 ${result.updated}，` +
        (result.skipped != null ? `跳过 ${result.skipped}` : `失败 ${result.failed}`)
    );
  } else {
    console.log(
      `[导入] ${entity}: 新增 ${result.created}，更新 ${result.updated}，` +
        (result.skipped != null ? `跳过 ${result.skipped}` : `失败 ${result.failed}`)
    );
  }
}

function printHelp() {
  console.log(
`站点数据管理 CLI
用法：
  node scripts/data-cli.mjs games export   [--out <dir>]
  node scripts/data-cli.mjs reviews export [--out <dir>]
  node scripts/data-cli.mjs games import   --file <path> [--dry-run]
  node scripts/data-cli.mjs reviews import --file <path> [--dry-run]
  node scripts/data-cli.mjs backup         [--backup-dir <dir>]

说明：
  导入前会自动备份现有游戏与评测数据到 backups/ 目录。
  --dry-run 只预览导入结果，不写入数据库。`
  );
}

try {
  await main();
} catch (err) {
  console.error(`[错误] ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}