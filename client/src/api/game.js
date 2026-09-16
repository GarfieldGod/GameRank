import request from "./request";

// 游戏列表（携带登录态时自动包含本人“审核中”的新增游戏）
export function fetchGames(params) {
  return request.get("/games", { params }).then((r) => r.data);
}

// 游戏详情（含该游戏评测，分页）：{ game, reviews, total, page, pageSize, myPendingEdit }
export function fetchGame(id, params) {
  return request.get(`/games/${id}`, { params }).then((r) => r.data);
}

// 创建游戏
export function createGame(payload) {
  return request.post("/games", payload).then((r) => r.data);
}

// 申请编辑既有游戏（普通用户）
export function proposeEditGame(id, payload) {
  return request.post(`/games/${id}/edit-proposal`, payload).then((r) => r.data);
}

// 更新游戏（仅管理员）
export function updateGame(id, payload) {
  return request.put(`/games/${id}`, payload).then((r) => r.data);
}

// 删除游戏（仅管理员）
export function deleteGame(id) {
  return request.delete(`/games/${id}`).then((r) => r.data);
}

// 全部标签及数量：[{ tag, count }]
export function fetchGameTags() {
  return request.get("/games/tags").then((r) => r.data);
}

// SteamGridDB 搜索游戏：返回 { games: [{ id, name }] }
export function sgdbSearchGames(q) {
  return request.get("/games/sgdb/search", { params: { q } }).then((r) => r.data);
}

// 拉取某游戏的三类素材：返回 { grids, logos, heroes }，各至多 20 张 { url, thumb }
export function sgdbAssets(gridId) {
  return request.get("/games/sgdb/assets", { params: { gridId } }).then((r) => r.data);
}

// 把选中的 SteamGridDB 图片下载到本地，返回 { url }
export function sgdbDownload(url) {
  return request.post("/games/sgdb/download", { url }).then((r) => r.data);
}