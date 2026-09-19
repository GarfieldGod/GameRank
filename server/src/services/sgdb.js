import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import SGDB from "steamgriddb";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "uploads", "sgdb");
const THUMB_DIR = path.join(PUBLIC_DIR, "thumbs");
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

let client = null;
function getClient() {
  const key = process.env.SGDB_API_KEY;
  if (!key) throw new Error("缺少 SGDB_API_KEY 配置");
  if (!client) client = new SGDB(key);
  return client;
}

// 免费版约 1 请求/秒，这里做进程内限速，避免 429
let lastCall = 0;
async function throttled(fn) {
  const delay = Number(process.env.SGDB_RATE_DELAY) || 1100;
  const wait = Math.max(0, delay - (Date.now() - lastCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}

// 名称归一化：小写、去特殊符号与多余空格（如 "The Elder Scrolls V: Skyrim" → "the elder scrolls v skyrim"）
export function normalizeName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// 按名称搜索 SGDB 游戏（传英文名优先；内部会做归一化，提升带符号/空格游戏的命中率）
export async function sgdbSearch(name) {
  const q = normalizeName(name);
  if (!q) return [];
  return throttled(() => getClient().searchGame(q));
}

// 获取某个 SGDB 游戏 id 的封面（grids）列表
export async function sgdbGrids(gridId) {
  return throttled(() => getClient().getGrids({ type: "game", id: gridId }));
}

// 获取某个 SGDB 游戏 id 的 logo（透明 logo）列表
export async function sgdbLogos(gridId) {
  return throttled(() => getClient().getLogos({ type: "game", id: gridId }));
}

// 获取某个 SGDB 游戏 id 的 hero（横向背景）列表
export async function sgdbHeroes(gridId) {
  return throttled(() => getClient().getHeroes({ type: "game", id: gridId }));
}

// 一次拉取某游戏的三种素材（grids/logo/hero），每种最多 20 张，只回 URL 元数据
export async function fetchAssets(gridId) {
  // 串行调用以复用进程内限速，避免并发打爆免费配额
  const grids = await sgdbGrids(gridId);
  const logos = await sgdbLogos(gridId);
  const heroes = await sgdbHeroes(gridId);
  const toImg = (g) => ({ url: String(g.url || ""), thumb: String(g.thumb || "") });
  const cap = (arr) => (Array.isArray(arr) ? arr.slice(0, 20).map(toImg) : []);
  return { grids: cap(grids), logos: cap(logos), heroes: cap(heroes) };
}

// 从多个封面中挑一张：优先默认 material 风格、按分降序，取原标题图片
export function pickGrid(grids) {
  if (!Array.isArray(grids) || !grids.length) return null;
  const rank = (g) =>
    (g.style === "material" ? 3 : g.style === "alternate" ? 2 : 1) + Math.max(0, 1 - (g.score ?? 0));
  return [...grids].sort((a, b) => b.score - a.score || rank(b) - rank(a))[0] || null;
}

// 把远程封面图下载到本地 uploads/sgdb 目录，返回公开访问路径（/uploads/sgdb/...）
// 下载后统一经 sharp「等比限长边 1600 + 转 WebP(质量82)」压缩落盘，显著减小体积；
// 仅当压缩产物比原图更小时才采用，否则回退存原图；压缩失败同样回退原图，保证不丢图。
export async function downloadCover(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`下载封面失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const baseName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const target = path.join(PUBLIC_DIR, `${baseName}.webp`);
  try {
    await sharp(buf, { animated: false })
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(target);
    if (fs.statSync(target).size >= buf.length) {
      fs.rmSync(target, { force: true });
      return writeOriginal(imageUrl, buf, baseName);
    }
    return `/uploads/sgdb/${path.basename(target)}`;
  } catch {
    return writeOriginal(imageUrl, buf, baseName);
  }
}

// 回退路径：压缩失败或压缩后不更小时，按原图扩展名原样落盘
function writeOriginal(imageUrl, buf, baseName) {
  const extMatch = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(imageUrl);
  const ext = extMatch ? (extMatch[1].toLowerCase() === "jpeg" ? "jpg" : extMatch[1].toLowerCase()) : "png";
  const filename = `${baseName}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC_DIR, filename), buf);
  return `/uploads/sgdb/${filename}`;
}

// 缩略图缓存：把远程缩略图下载并缓存到本地 uploads/sgdb/thumbs，返回本地公开路径。
// 用 URL 哈希做文件名，命中缓存时直接返回，避免重复下载；失败则返回 null。
export async function downloadThumb(imageUrl) {
  const extMatch = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(imageUrl);
  const ext = extMatch ? (extMatch[1].toLowerCase() === "jpeg" ? "jpg" : extMatch[1].toLowerCase()) : "png";
  const name = `${createHash("md5").update(imageUrl).digest("hex")}.${ext}`;
  const file = path.join(THUMB_DIR, name);
  const url = `/uploads/sgdb/thumbs/${name}`;
  if (fs.existsSync(file)) return url;
  const res = await fetch(imageUrl);
  if (!res.ok) return null;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return url;
}