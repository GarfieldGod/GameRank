import request from "./request";

// 注册：返回用户信息
export function registerUser(payload) {
  return request.post("/auth/register", payload).then((r) => r.data);
}

// 登录：返回 { token, user }
export function loginUser(payload) {
  return request.post("/auth/login", payload).then((r) => r.data);
}

// 获取当前登录用户
export function fetchMe() {
  return request.get("/auth/me").then((r) => r.data);
}