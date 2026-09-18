import request from "./request";

// 获取用户公开资料
export function fetchUser(userId) {
  return request.get(`/users/${userId}`).then((r) => r.data);
}

// 获取全部用户（含角色，供站长管理页使用）
export function fetchUsers() {
  return request.get("/users").then((r) => r.data);
}

// 心跳上报：更新当前登录用户最近活跃时间（在线状态判定）
export function heartbeat() {
  return request.post("/auth/heartbeat").catch(() => {});
}

// 编辑本人资料（头像/简介）
export function updateProfile(payload) {
  return request.put("/users/me", payload).then((r) => r.data);
}

// 修改本人密码（需输入原密码）
export function changePassword(payload) {
  return request.put("/users/me/password", payload).then((r) => r.data);
}

// 注销账号：当前登录用户身份置为已注销并强制下线
export function deactivateAccount() {
  return request.post("/users/me/deactivate").then((r) => r.data);
}

// 设为管理员 / 取消管理员：PUT /api/admin/users/:id/role（仅站长可调用，服务端二次校验）
export function setUserRole(userId, role) {
  return request.put(`/admin/users/${userId}/role`, { role }).then((r) => r.data);
}