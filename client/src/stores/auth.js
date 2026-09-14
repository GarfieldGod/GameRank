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

    // 刷新登录态（可选：从 /me 拉取用户信息）
    async refresh() {
      if (!this.token) return;
      try {
        this.user = await authApi.fetchMe();
        persist(this.token, this.user);
      } catch {
        this.logout();
      }
    },
  },
});