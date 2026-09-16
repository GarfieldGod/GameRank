import { defineStore } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { updateProfile } from "@/api/user";

const THEME_KEY = "game-review-theme";

// 未登录时在浏览器本地持久化的主题偏好；未设置时默认暗色
function readLocal() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "light" ? t : "dark";
  } catch {
    return "dark";
  }
}

function writeLocal(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function applyToDom(theme) {
  document.documentElement.dataset.theme = theme;
}

export const useThemeStore = defineStore("theme", {
  state: () => ({ theme: readLocal() }),

  actions: {
    // 应用到页面并写入本地偏好
    apply(theme) {
      this.theme = theme;
      applyToDom(theme);
      writeLocal(theme);
    },

    // 应用当前登录用户的主题（未登录则用本地偏好）
    syncFromUser() {
      const auth = useAuthStore();
      if (auth.isLoggedIn && auth.user?.theme) {
        this.apply(auth.user.theme);
      } else {
        applyToDom(this.theme);
      }
    },

    // 切换并保存：登录用户写入账号(服务端+本地 store)，游客仅存本地
    async toggle() {
      const next = this.theme === "dark" ? "light" : "dark";
      this.apply(next);
      const auth = useAuthStore();
      if (auth.isLoggedIn) {
        try {
          const updated = await updateProfile({ theme: next });
          if (updated?.theme) auth.user = { ...auth.user, theme: updated.theme };
        } catch {
          /* 保存失败不阻断切换 */
        }
      }
    },
  },
});