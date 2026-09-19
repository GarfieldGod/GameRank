import fs from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// Cloudflare R2 图片双写服务。
//
// 设计：
// - 服务器本地磁盘永远是"主写入 + 兜底"：先落盘本地，再尽力同步到 R2。
// - R2 仅作 CDN 主源：未配置凭证 / 上传失败 / 网络不通时，一律静默降级为仅本地，
//   绝不阻塞或打断上传/拉取主流程（前端 onerror 会回退 /uploads/ 本地路径）。
// - R2 object key 与 /uploads/ 下的相对路径完全同形（如 sgdb/xxx.webp），
//   由 IMG_CDN_BASE（如 https://image-gamerank.garfieldgod.cn）拼接成完整访问地址。

const ENV = {
  endpoint: process.env.R2_ENDPOINT, // 如 https://<account-id>.r2.cloudflarestorage.com
  bucket: process.env.R2_BUCKET,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
};

let client = null;

// R2 是否可用（缺任一配置即视为未启用，整体走纯本地模式）
export function r2Enabled() {
  return !!(ENV.endpoint && ENV.bucket && ENV.accessKeyId && ENV.secretAccessKey);
}

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: ENV.endpoint,
      region: "auto",
      credentials: { accessKeyId: ENV.accessKeyId, secretAccessKey: ENV.secretAccessKey },
    });
  }
  return client;
}

// 公开访问域名（绑在 R2 桶上的自定义域名），未配置返回 null
export function imageCdnBase() {
  return process.env.IMG_CDN_BASE || null;
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// 对象是否已存在（404/403 视为不存在）
async function headKey(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: ENV.bucket, Key: key }));
    return true;
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || code === 403 || err?.name === "NotFound" || err?.name === "NoSuchKey") return false;
    throw err;
  }
}

/**
 * 把本地文件同步到 R2（key 即 /uploads/ 下的相对路径）。
 * 已存在同 key 对象时跳过（幂等）；任何失败只记日志、不抛错，主流程不受影响。
 * @param {string} absPath 本地绝对路径
 * @param {string} publicUrl 站内相对路径，如 /uploads/sgdb/xxx.webp
 * @returns {Promise<boolean>} 是否已在 R2（含跳过）
 */
export async function syncToR2(absPath, publicUrl) {
  if (!r2Enabled()) return false;
  const key = String(publicUrl || "").replace(/^\/uploads\//, "");
  if (!key) return false;
  try {
    const client = getClient();
    if (await headKey(client, key)) return true;
    await client.send(
      new PutObjectCommand({
        Bucket: ENV.bucket,
        Key: key,
        Body: fs.createReadStream(absPath),
        ContentType: MIME[path.extname(absPath).toLowerCase()] || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return true;
  } catch (err) {
    console.warn(`[r2] 同步到 R2 失败（已降级为仅本地存储）: ${key} - ${err?.message ?? err}`);
    return false;
  }
}
