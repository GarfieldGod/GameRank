import request from "./request";

// 软删除（不可见）列表：游戏与评测（仅站长）
export function fetchDeleted() {
  return request.get("/admin/deleted").then((r) => r.data);
}

// 恢复可见（仅站长）
export function restoreItem(kind, id) {
  return request.post(`/admin/restore/${kind}/${id}`);
}

// 真正删除（硬删除，仅站长）
export function purgeItem(kind, id) {
  return request.post(`/admin/purge/${kind}/${id}`);
}

// 触发浏览器下载后端生成的 JSON 文件
async function downloadFile(url, filename) {
  const res = await request.get(url, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function exportGames() {
  return downloadFile("/admin/games/export", "games.json");
}

export function exportReviews() {
  return downloadFile("/admin/reviews/export", "reviews.json");
}

export async function importGames(file) {
  const data = JSON.parse(await file.text());
  const r = await request.post("/admin/games/import", { data });
  return r.data;
}

export async function importReviews(file) {
  const data = JSON.parse(await file.text());
  const r = await request.post("/admin/reviews/import", { data });
  return r.data;
}