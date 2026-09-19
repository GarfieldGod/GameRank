// 前端图片压缩工具：上传前统一「等比限宽 + 转 WebP」。
// 原则：只缩小不上采样；原图已足够小则原样返回；任何环节失败都回退原图，
// 保证压缩永远不会阻断上传流程。
const SKIP_SIZE = 200 * 1024; // 原图小于 200KB 不重编码，避免无意义的质量损失

/**
 * 压缩图片
 * @param {Blob|File} file 原始图片
 * @param {object} [opts]
 * @param {number} [opts.maxEdge=1600] 输出长边上限（等比缩小，绝不放大）
 * @param {number} [opts.quality=0.85] WebP 质量 0~1
 * @param {string} [opts.type="image/webp"] 输出格式（不支持时浏览器自动回退 png）
 * @param {boolean} [opts.skipIfSmall=true] 小图直接跳过
 * @returns {Promise<Blob|File>} 压缩后的 File（或原样返回的 file）
 */
export async function compressImage(
  file,
  { maxEdge = 1600, quality = 0.85, type = "image/webp", skipIfSmall = true } = {}
) {
  // GIF 动图 canvas 会丢动画帧，一律跳过
  if (!(file instanceof Blob) || file.type === "image/gif") return file;
  if (skipIfSmall && file.size <= SKIP_SIZE) return file;
  try {
    const bitmap = await decode(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === "function") bitmap.close();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality)
    );
    // 压缩结果反而更大（如小图重编码膨胀）时保留原文件
    if (blob.size >= file.size) return file;
    return toFile(file, blob);
  } catch {
    return file; // 解码/编码失败：回退原图，不阻断上传
  }
}

// 解码：优先 createImageBitmap（内存友好），不支持时回退 <img>
async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* 个别编码不支持时走 <img> 回退 */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

// 用新 blob 重建 File，文件名跟随实际内容格式（后端按扩展名落盘）
function toFile(orig, blob) {
  const base = (orig.name || "image").replace(/\.[^.]+$/, "") || "image";
  const ext =
    blob.type === "image/webp" ? ".webp" : blob.type === "image/png" ? ".png" : ".jpg";
  try {
    return new File([blob], base + ext, { type: blob.type });
  } catch {
    return blob;
  }
}
