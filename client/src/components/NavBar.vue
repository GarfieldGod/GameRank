<script setup>
import { computed, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

const userDisplay = computed(() => displayName(auth.user));

// 移动端共用一块展开面板：汉堡打开「页面菜单」，头像打开「用户菜单」，再点同一按钮收起。
const mobilePanel = ref(null); // null | 'menu' | 'user'
const route = useRoute();
// 与全局断点一致：≤768 视为移动端
function isMobile() {
  return window.innerWidth <= 768;
}
watch(
  () => route.fullPath,
  () => {
    mobilePanel.value = null;
  }
);
// 汉堡：开/关「页面菜单」
function toggleMenu() {
  mobilePanel.value = mobilePanel.value === "menu" ? null : "menu";
}
// 头像：移动端仅作面板开/关（不跳转个人主页）；桌面端跳转个人主页
function onUserToggle() {
  if (isMobile()) {
    mobilePanel.value = mobilePanel.value === "user" ? null : "user";
  } else {
    router.push(`/user/${auth.user?.username}`);
  }
}
function closePanel() {
  mobilePanel.value = null;
}

function onLogout() {
  auth.logout();
  mobilePanel.value = null;
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
      <!-- 移动端汉堡按钮：仅窄屏显示，位于站点标题右侧 -->
      <RouterLink class="brand" to="/">GameRank</RouterLink>
      <button class="menu-btn" :class="{ active: mobilePanel === 'menu' }" @click="toggleMenu" aria-label="菜单" :aria-expanded="mobilePanel === 'menu'">
        <span></span><span></span><span></span>
      </button>
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
          <button type="button" class="user-trigger" :class="{ active: mobilePanel === 'user' }" @click="onUserToggle" :aria-expanded="mobilePanel === 'user'">
            <SmartImg class="avatar" :src="avatarUrl(auth.user?.avatar)" :alt="userDisplay" />
            <span class="user-name">{{ userDisplay }}</span>
          </button>
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

    <!-- 移动端共用一块展开面板：汉堡→页面菜单，头像→用户菜单 -->
    <div v-if="mobilePanel" class="mobile-menu">
      <div v-if="mobilePanel === 'menu'" class="mm-block">
        <RouterLink class="mm-item" to="/">{{ lang.t("nav.home") }}</RouterLink>
        <RouterLink class="mm-item" to="/games">{{ lang.t("nav.games") }}</RouterLink>
        <RouterLink class="mm-item" to="/reviews">{{ lang.t("nav.reviews") }}</RouterLink>
      </div>
      <div v-else class="mm-block">
        <RouterLink v-if="auth.isAdmin" class="mm-item" to="/admin" @click="closePanel">{{ lang.t("nav.manage") }}</RouterLink>
        <RouterLink class="mm-item" :to="`/user/${auth.user?.username}`" @click="closePanel">{{ lang.t("nav.myProfile") }}</RouterLink>
        <RouterLink class="mm-item" to="/reviews/new" @click="closePanel">{{ lang.t("nav.writeReview") }}</RouterLink>
        <button class="mm-item logout" @click="onLogout">{{ lang.t("nav.logout") }}</button>
      </div>
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
  padding: 6px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
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

/* ===== 移动端：汉堡按钮 + 下拉菜单 ===== */
/* 汉堡按钮：桌面端隐藏，窄屏显示为三横线（44×44 触屏目标） */
.menu-btn {
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  margin: 0 0 0 4px;
  padding: 0 11px;
  border: none;
  background: transparent;
  cursor: pointer;
}
.menu-btn span {
  display: block;
  width: 22px;
  height: 2px;
  border-radius: 2px;
  background: var(--text-1);
  transition: transform 0.2s ease, opacity 0.2s ease;
}
/* 展开时三横线变叉 */
.menu-btn.active span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}
.menu-btn.active span:nth-child(2) {
  opacity: 0;
}
.menu-btn.active span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}

/* 下拉菜单：默认隐藏，窄屏且打开时以整行面板出现在导航条下方 */
.mobile-menu {
  display: none;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 2px;
  padding: 10px 0 12px;
  border-top: 1px solid var(--border);
}
.mm-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mm-item {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-1);
  font-family: inherit;
  font-size: 15px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.mm-item:hover {
  background: var(--hover);
  color: var(--primary);
}

.mm-item.logout {
  color: var(--danger);
}

.mm-item.logout:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

/* 窄屏断点：导航收成「汉堡 + Logo · 主题/语言 + 头像/登录」 */
@media (max-width: 768px) {
  .navbar {
    flex-wrap: wrap;
    height: auto;
    min-height: 56px;
    padding: 0 16px;
  }
  .nav-center {
    display: none;
  }
  .side.right {
    gap: 10px;
  }
  /* 站长管理与注册按钮在移动端隐藏 */
  .btn-manage,
  .btn-primary {
    display: none;
  }
  /* 右侧顺序：主题 → 语言 → 登录(未登录) / 头像菜单(已登录) */
  .theme-btn {
    order: 1;
  }
  .lang-btn {
    order: 2;
  }
  .btn-link,
  .user-menu {
    order: 3;
  }
  /* 登录入口在移动端呈按钮形态 */
  .btn-link {
    display: inline-flex;
    align-items: center;
    padding: 6px 16px;
    border: 1px solid currentColor;
    border-radius: 8px;
    font-weight: 600;
    white-space: nowrap;
  }
  .btn-link:hover {
    background: var(--primary-soft);
  }
  .menu-btn {
    display: flex;
  }
  .mobile-menu {
    display: flex;
  }
  /* 移动端头像区：只显示头像（不含用户名），点按展开/收起共用面板；
     不再使用桌面端的浮窗下拉，因此将其隐藏 */
  .user-menu {
    display: flex;
  }
  .user-menu .user-name {
    display: none;
  }
  .user-trigger {
    padding: 2px 0;
  }
  .user-menu .dropdown {
    display: none !important;
  }
  /* 头像当作开关：面板展开时给出选中态 */
  .user-trigger.active {
    background: var(--hover);
  }
}
</style>