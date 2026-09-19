/**
 * 存量图片迁移到 Cloudflare R2
 *
 * 背景：
 * - 双写上线前，服务器本地 uploads/ 下已有一批压缩图片（用户上传 + SGDB 封面）。
 * - 这些图需要一次性同步到 R2，前端 SmartImg 才能从 CDN 主源加载（失败再回退本地）。
 * - 数据库里图片字段存的都是站内相对路径（/uploads/xxx），无需改写；
 *   R2 的 object key 与去掉 /uploads/ 前缀后的相对路径完全同形（见 r2.js 约定）。
 *
 * 排除项：
 * - backup-originals/：原图灾备，不进 CDN（体量大、非线上访问路径）。
 * - sgdb/thumbs/：SGDB 缩略图，体积极小且可重新下载，不进 R2（少一类写入）。
 *
 * 用法：
 *   node scripts/migrate-to-r2.mjs --dry-run   # 只列出将上传的文件与总大小，不真正上传
 *   node scripts/migrate-to-r2.mjs             # 真正上传（幂等：R2 已存在同 key 则跳过）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, "..", "uploads");
const DRY_RUN = process.argv.includes("--dry-run");

const ENV = {
  endpoint: process.env.R2_ENDPOINT, // 如 https://<account-id>.r2.cloudflarestorage.com
  bucket: process.env.R2_BUCKET,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
};

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// 任意层级下遇到这些目录名一律跳过
const EXCLUDE_DIRS = new Set(["backup-originals", "thumbs"]);

// 递归收集图片文件，返回相对 UPLOADS 的路径（正斜杠，如 sgdb/xxx.webp、xxx.webp）
function collectImages(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectImages(full, base, out);
    } else if (entry.isFile()) {
      if (MIME[path.extname(entry.name).toLowerCase()]) {
        out.push(path.relative(base, full).split(path.sep).join("/"));
      }
    }
  }
  return out;
}

const files = fs.existsSync(UPLOADS) ? collectImages(UPLOADS, UPLOADS, []) : [];
const totalBytes = files.reduce(
  (sum, key) => sum + (fs.statSync(path.join(UPLOADS, ...key.split("/"))).size || 0),
  0
);
const mb = (totalBytes / 1024 / 1024).toFixed(2);
console.log(`[migrate] 共发现 ${files.length} 个待迁移图片，合计 ${mb} MB（已排除 backup-originals / thumbs）。`);

if (DRY_RUN) {
  for (const key of files) console.log(`  · ${key}`);
  console.log("\n[migrate] dry-run 结束，未上传。去掉 --dry-run 真正执行。");
  process.exit(0);
}

if (!(ENV.endpoint && ENV.bucket && ENV.accessKeyId && ENV.secretAccessKey)) {
  console.error("[migrate] 缺少 R2 配置（R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY），请检查 server/.env 后重试。");
  process.exit(1);
}

const client = new S3Client({
  endpoint: ENV.endpoint,
  region: "auto",
  credentials: { accessKeyId: ENV.accessKeyId, secretAccessKey: ENV.secretAccessKey },
});

// 对象是否已存在（404/403 视为不存在），其余错误向上抛
async function exists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: ENV.bucket, Key: key }));
    return true;
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || code === 403 || err?.name === "NotFound" || err?.name === "NoSuchKey") return false;
    throw err;
  }
}

let ok = 0;
let skipped = 0;
let failed = 0;
for (const key of files) {
  const abs = path.join(UPLOADS, ...key.split("/"));
  try {
    if (await exists(key)) {
      skipped++;
      continue;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: ENV.bucket,
        Key: key,
        Body: fs.createReadStream(abs),
        ContentType: MIME[path.extname(key).toLowerCase()],
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    ok++;
    console.log(`  + ${key}`);
  } catch (err) {
    failed++;
    console.error(`  ! ${key} 失败: ${err?.message || err}`);
  }
}

console.log(`\n[migrate] 完成：上传 ${ok}，已存在跳过 ${skipped}，失败 ${failed}。`);
if (failed > 0) process.exit(1);
