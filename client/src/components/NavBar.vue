<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

const userDisplay = computed(() => displayName(auth.user));

function onLogout() {
  auth.logout();
  router.push({ name: "home" });
}

// 头像：无头像时用默认占位
function avatarUrl(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const rect = dark ? "#2a2f38" : "#cbd5e1";
  const fg = dark ? "#717a86" : "#ffffff";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="100%" height="100%" fill="${rect}"/><text x="50%" y="54%" fill="${fg}" font-size="36" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">G</text></svg>`
  );
}
</script>

<template>
  <nav class="navbar">
    <div class="side left">
      <RouterLink class="brand" to="/">GameRank</RouterLink>
    </div>

    <div class="nav-center">
      <RouterLink class="nav-item" to="/">{{ lang.t("nav.home") }}</RouterLink>
      <RouterLink class="nav-item" to="/games">{{ lang.t("nav.games") }}</RouterLink>
      <RouterLink class="nav-item" to="/reviews">{{ lang.t("nav.reviews") }}</RouterLink>
    </div>

    <div class="side right">
      <template v-if="auth.isLoggedIn">
        <RouterLink v-if="auth.isAdmin" class="btn-manage" to="/admin">{{ lang.t("nav.manage") }}</RouterLink>

        <div class="user-menu">
          <RouterLink class="user-trigger" :to="`/user/${auth.user?.username}`">
            <img class="avatar" :src="avatarUrl(auth.user?.avatar)" :alt="userDisplay" />
            <span class="user-name">{{ userDisplay }}</span>
          </RouterLink>
          <div class="dropdown">
            <div class="dropdown-inner">
              <RouterLink class="dropdown-item" :to="`/user/${auth.user?.username}`">{{ lang.t("nav.myProfile") }}</RouterLink>
              <RouterLink class="dropdown-item" to="/reviews/new">{{ lang.t("nav.writeReview") }}</RouterLink>
              <button class="dropdown-item logout" @click="onLogout">{{ lang.t("nav.logout") }}</button>
            </div>
          </div>
        </div>

        <button class="theme-btn" @click="theme.toggle()" :title="theme.theme === 'dark' ? '切换到亮色' : '切换到暗色'" aria-label="切换主题">
          <svg class="icon-sun" v-if="theme.theme === 'dark'" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V2a1 1 0 0 1 1-1zM2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm18 0a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1zM12 21a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zM4.2 4.2a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4zm13.4 13.4a1 1 0 0 1 1.4 0l.7.7a1 1 0 0 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4zM19.8 4.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 1 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0zM6.3 17.6a1 1 0 0 1 0 1.4l-.7.7a1 1 0 1 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0z"/></svg>
          <svg class="icon-moon" v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>

        <button class="lang-btn" @click="lang.toggle()">{{ lang.isEn ? "中文" : "EN" }}</button>
      </template>
      <template v-else>
        <RouterLink class="btn-link" to="/login">{{ lang.t("nav.login") }}</RouterLink>
        <RouterLink class="btn-primary" to="/register">{{ lang.t("nav.register") }}</RouterLink>
        <button class="theme-btn" @click="theme.toggle()" :title="theme.theme === 'dark' ? '切换到亮色' : '切换到暗色'" aria-label="切换主题">
          <svg class="icon-sun" v-if="theme.theme === 'dark'" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V2a1 1 0 0 1 1-1zM2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm18 0a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1zM12 21a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zM4.2 4.2a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4zm13.4 13.4a1 1 0 0 1 1.4 0l.7.7a1 1 0 0 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4zM19.8 4.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 1 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0zM6.3 17.6a1 1 0 0 1 0 1.4l-.7.7a1 1 0 1 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0z"/></svg>
          <svg class="icon-moon" v-else viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
        <button class="lang-btn" @click="lang.toggle()">{{ lang.isEn ? "中文" : "EN" }}</button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 50; /* 吸顶，保证滚动时侧边标签列表与顶部始终有稳定间隙 */
  display: flex;
  align-items: center;
  padding: 0 24px;
  height: 56px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.side {
  flex: 1;
  display: flex;
  align-items: center;
}

.side.right {
  justify-content: flex-end;
  gap: 12px;
}

.brand {
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
  color: var(--primary);
}

/* 中间导航：整体居中 */
.nav-center {
  display: flex;
  gap: 20px;
  align-items: center;
}

.nav-item {
  text-decoration: none;
  color: var(--text-1);
  font-size: 15px;
}

.nav-item:hover {
  color: var(--primary);
}

/* 站长管理入口，位于头像左侧，管理员/站长专属 */
.btn-manage {
  padding: 6px 14px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-1);
  border: 1px solid var(--border-strong);
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}

.btn-manage:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}

/* 头像 + 用户名，悬浮出下拉菜单 */
.user-menu {
  position: relative;
  display: flex;
  align-items: center;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  padding: 6px 4px;
  border-radius: 8px;
}

.user-trigger:hover {
  background: var(--hover);
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border);
  line-height: 0;
}

.user-name {
  color: var(--text-1);
  font-weight: 600;
  font-size: 14px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  /* padding-top 为隐形悬停桥：从触发区移入菜单时不间断 */
  padding-top: 8px;
  z-index: 20;
}

.user-menu:hover .dropdown,
.user-trigger:focus-within .dropdown {
  display: block;
}

.dropdown-inner {
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-1);
  font-size: 14px;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
}

.dropdown-item:hover {
  background: var(--hover);
  color: var(--primary);
}

.dropdown-item.logout {
  color: var(--danger);
}

.dropdown-item.logout:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.btn-link {
  color: var(--primary);
  text-decoration: none;
}

.btn-primary {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  text-decoration: none;
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.lang-btn {
  width: 54px; /* 固定宽度：切换“中文/EN”时尺寸不变 */
  height: 32px; /* 与主题按钮等高 */
  padding: 0;
  text-align: center;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.lang-btn:hover {
  background: var(--hover);
}

/* 主题切换按钮：位于用户名右侧 */
.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.theme-btn:hover {
  background: var(--hover);
  color: var(--primary);
}
</style>