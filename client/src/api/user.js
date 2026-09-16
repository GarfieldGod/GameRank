import request from "./request";

// 获取用户公开资料
export function fetchUser(userId) {
  return request.get(`/users/${userId}`).then((r) => r.data);
}

// 获取全部用户（含角色，供站长管理页使用）
export function fetchUsers() {
  return request.get("/users").then((r) => r.data);
}

// 编辑本人资料（头像/简介）
export function updateProfile(payload) {
  return request.put("/users/me", payload).then((r) => r.data);
}