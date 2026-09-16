import axios from "axios";
import { useAuthStore } from "@/stores/auth";

// axios 实例，统一 /api 前缀
const request = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

// 请求拦截：自动携带 JWT
request.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

// 响应拦截：401 时清除登录态（令牌失效）
request.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const auth = useAuthStore();
      auth.logout();
    }
    return Promise.reject(err);
  }
);

// 提取后端错误信息，供页面展示
export function extractError(err, fallback = "请求失败") {
  return err?.response?.data?.error || err?.message || fallback;
}

// 是否为请求超时（axios 超时抛出 code=ECONNABORTED）
export function isTimeout(err) {
  return Boolean(err && (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")));
}

export default request;