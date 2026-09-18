/**
 * 站点数据管理 CLI（仅站长在服务器上运行）
 *
 * 用于：本地 SQLite → 云服务器 MySQL 的数据迁移，以及日常备份/恢复。
 *
 * 支持实体与推荐导入顺序（先建依赖，再建引用方）：
 *   users → tombstones → games → proposals → reviews
 *
 * 用法：
 *   node scripts/data-cli.mjs <entity> <action> [选项]
 *
 *   entity: users | games | reviews | tombstones
 *   action: export | import
 *
 *   选项：
 *     --file <path>        导入时必填：JSON 文件路径
 *     --out <dir>          导出目录（默认 ./data）
 *     --backup-dir <dir>   导入前自动备份目录（默认 ./backups）
 *     --dry-run            仅预览导入结果，不写入数据库
 *
 *   另支持：
 *     node scripts/data-cli.mjs backup   备份全部实体到 backups/<时间戳>/
 *
 * 说明：
 *   - 所有导出保留原主键 id，导入按 id 归并（存在则更新、不存在则新增），
 *     从而保留“评测↔游戏”关联、软删除状态与创建/发布时间。
 *   - @updatedAt 字段（updatedAt）由数据库自动刷新，不写回。
 *   - users 导出会包含 bcrypt 密码哈希（为让迁移后账号可直接登录）；该文件含敏感凭据，请妥善保管、勿上传仓库。
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const prisma = new PrismaClient();

// 各实体：数据访问、JSON 数组字段（需 string ↔ array 互转）
const ENTITIES = {
  users:      { label: "用户",   model: () => prisma.user,        jsonFields: [] },
  tombstones: { label: "游戏墓碑", model: () => prisma.gameTombstone, jsonFields: [] },
  games:      { label: "游戏",   model: () => prisma.game,        jsonFields: ["tags"] },
  reviews:    { label: "评测",   model: () => prisma.gameReview,  jsonFields: ["tags", "ratingParams"] },
  proposals:  { label: "游戏申请", model: () => prisma.gameProposal, jsonFields: [] },
};

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
function parseJSONArray(t) {
  if (t == null) return null;
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
  const meta = ENTITIES[entity];
  const rows = await meta.model().findMany({ orderBy: { id: "asc" } });
  const data = [];
  for (const r of rows) {
    const clone = { ...r };
    for (const f of meta.jsonFields) {
      if (clone[f] != null) clone[f] = parseJSONArray(clone[f]);
    }
    data.push(clone);
  }
  const dir = await ensureDir(outDir);
  const file = path.join(dir, `${entity}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
  return { count: data.length, file };
}

// ---------- 导入（按 id 归并，保留关联与时间戳）----------
async function importEntity(entity, list, { dryRun }) {
  const meta = ENTITIES[entity];
  const model = meta.model();
  // 主键与 @updatedAt 不写回：id 用于归并；updatedAt 由数据库自动刷新
  const SKIP = new Set(["id", "updatedAt"]);

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const item of list) {
    if (item == null || typeof item !== "object") { failed += 1; continue; }
    const id = Number(item.id);
    const data = {};
    for (const [k, v] of Object.entries(item)) {
      if (SKIP.has(k) || v === undefined) continue;
      if (meta.jsonFields.includes(k)) {
        data[k] = Array.isArray(v) ? JSON.stringify(v) : v;
      } else {
        data[k] = v;
      }
    }

    try {
      if (Number.isFinite(id)) {
        const existing = await model.findUnique({ where: { id } });
        if (!dryRun) {
          if (existing) { await model.update({ where: { id }, data }); updated += 1; }
          else { await model.create({ data: { ...data, id } }); created += 1; }
        } else {
          existing ? (updated += 1) : (created += 1);
        }
      } else {
        if (!dryRun) { await model.create({ data }); created += 1; }
        else created += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { created, updated, failed, total: list.length };
}

// ---------- 备份（导入前与单独调用均用到）----------
async function backupAll(backupDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await ensureDir(path.resolve(ROOT, backupDir, ts));
  const summary = {};
  for (const [entity, meta] of Object.entries(ENTITIES)) {
    const { file, count } = await exportEntity(entity, dir);
    summary[entity] = count;
    console.log(`  - ${meta.label} ${count} 条 -> ${path.relative(ROOT, file)}`);
  }
  console.log(`[备份] 完成 -> ${path.relative(ROOT, dir)}`);
  return summary;
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

  if (!Object.prototype.hasOwnProperty.call(ENTITIES, entity) || !["export", "import"].includes(action)) {
    return printHelp();
  }

  if (action === "export") {
    const { count, file } = await exportEntity(entity, path.resolve(ROOT, flags.out));
    const warn = entity === "users" ? "（含密码哈希，请妥善保管）" : "";
    console.log(`[导出] ${entity}${warn}: ${count} 条 -> ${path.relative(ROOT, file)}`);
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
    console.log(`[导入] 开始前自动备份当前库...`);
    await backupAll(flags.backupDir);
  }

  const result = await importEntity(entity, list, flags);
  const tail =
    result.skipped != null
      ? `跳过 ${result.skipped}`
      : `失败 ${result.failed}`;
  console.log(
    `[${flags.dryRun ? "预览" : "导入"}]（${flags.dryRun ? "未写入" : "已写入"}）${entity}: ` +
      `新增 ${result.created}，更新 ${result.updated}，${tail}`
  );
}

function printHelp() {
  console.log(
`站点数据管理 CLI
用法：
  node scripts/data-cli.mjs users export      [--out <dir>]
  node scripts/data-cli.mjs games export      [--out <dir>]
  node scripts/data-cli.mjs reviews export    [--out <dir>]
  node scripts/data-cli.mjs tombstones export [--out <dir>]
  node scripts/data-cli.mjs proposals export  [--out <dir>]
  node scripts/data-cli.mjs <entity> import   --file <path> [--dry-run]
  node scripts/data-cli.mjs backup            [--backup-dir <dir>]

实体与推荐导入顺序（先依赖后被引用）：
  users → tombstones → games → proposals → reviews

说明：
  - 所有导出保留原主键 id；导入按 id 归并（存在则更新，不存在则新增），
    从而保留评测↔游戏关联、软删除状态与创建/发布时间。
  - users 导出含 bcrypt 密码哈希（便于迁移后账号直接登录），文件敏感请勿外泄。
  - 导入前会自动备份当前库到一个新 backups/<时间戳>/ 目录。
  - --dry-run 只预览导入结果，不写入数据库。`
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