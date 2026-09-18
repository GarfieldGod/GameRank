import { defineStore } from "pinia";
import * as authApi from "@/api/auth";

// 显示用户名：有 nickname 用 nickname，否则默认 "Gamer" + 账号
export function displayName(user) {
  const nick = user?.nickname?.trim();
  if (nick) return nick;
  return user?.username ? `Gamer${user.username}` : "";
}

// localStorage 持久化 key
const STORAGE_KEY = "game-review-auth";

// 角色/资料刷新 TTL：普通导航无需每次网络请求 /me，仅超时后或强制刷新才拉取，
// 避免每个路由跳转都阻塞等待一次服务端往返。
const ROLE_REFRESH_TTL = 60_000;
let lastRoleRefresh = 0;

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

function persist(token, user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
}

export const useAuthStore = defineStore("auth", {
  state: () => {
    const saved = loadPersisted();
    return {
      token: saved.token,
      user: saved.user,
    };
  },

  getters: {
    isLoggedIn: (state) => Boolean(state.token),
    // 是否为管理员：身份由后端下发，OWNER 站长同样拥有管理员权限
    isAdmin: (state) => state.user?.role === "ADMIN" || state.user?.role === "OWNER",
    // 是否为站长（最高权限）
    isOwner: (state) => state.user?.role === "OWNER",
  },

  actions: {
    async login({ username, password }) {
      const { token, user } = await authApi.loginUser({ username, password });
      this.token = token;
      this.user = user;
      persist(token, user);
      return user;
    },

    async register({ username, nickname, password, bio, avatar }) {
      const user = await authApi.registerUser({ username, nickname, password, bio, avatar });
      return user;
    },

    // 注册成功后自动登录
    async registerAndLogin(payload) {
      await this.register(payload);
      await this.login({ username: payload.username, password: payload.password });
    },

    logout() {
      this.token = null;
      this.user = null;
      persist(null, null);
    },

    // 刷新登录态：从 /me 拉取最新用户信息（含实时角色）。
    // 仅当令牌确实无效/过期（401）才登出；网络抖动等临时错误不强退，避免误登出。
    // force=true 时总是请求（管理员/站长页用，保证权限即时生效）；否则带 60s TTL 缓存。
    async refresh(force = false) {
      if (!this.token) return;
      const now = Date.now();
      if (!force && now - lastRoleRefresh < ROLE_REFRESH_TTL) return;
      try {
        this.user = await authApi.fetchMe();
        lastRoleRefresh = Date.now();
        persist(this.token, this.user);
      } catch (err) {
        if (err?.response?.status === 401) {
          lastRoleRefresh = Date.now();
          this.logout();
        }
      }
    },

    // 同步最新角色：提拔/降职后无需重新登录，普通导航（TTL内）走缓存，入口即时生效
    async syncRole() {
      if (!this.token) return;
      await this.refresh(false);
    },
  },
});