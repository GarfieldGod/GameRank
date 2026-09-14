import request from "./request";

// 游戏列表
export function fetchGames(params) {
  return request.get("/games", { params }).then((r) => r.data);
}

// 游戏详情（含该游戏评测，分页）：{ game, reviews, total, page, pageSize }
export function fetchGame(id, params) {
  return request.get(`/games/${id}`, { params }).then((r) => r.data);
}

// 创建游戏
export function createGame(payload) {
  return request.post("/games", payload).then((r) => r.data);
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