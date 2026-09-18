import request from "./request";

// 软删除（不可见）列表：游戏与评测（仅站长）
export function fetchDeleted() {
  return request.get("/admin/deleted").then((r) => r.data);
}

// 单条软删除游戏 / 评测（详情页预览用，站长与管理员可查看）
export function fetchDeletedGame(id) {
  return request.get(`/admin/deleted/games/${id}`).then((r) => r.data);
}
export function fetchDeletedReview(id) {
  return request.get(`/admin/deleted/reviews/${id}`).then((r) => r.data);
}

// 恢复可见（仅站长）
export function restoreItem(kind, id) {
  return request.post(`/admin/restore/${kind}/${id}`);
}

// 真正删除（硬删除，仅站长）
export function purgeItem(kind, id) {
  return request.post(`/admin/purge/${kind}/${id}`);
}

// 彻底删除已注销用户及其全部数据（仅站长）
export function deleteUser(id) {
  return request.delete(`/admin/users/${id}`);
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

// 访客统计（站长/管理员）：历史累计唯一访客 + 近 7 天每日唯一访客
export function fetchVisitStats() {
  return request.get("/admin/visits").then((r) => r.data);
}