<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";

const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

const userDisplay = computed(() => displayName(auth.user));

function onLogout() {
  auth.logout();
  router.push({ name: "home" });
}

// 头像：无头像时用默认占位
function avatarUrl(url) {
  if (url) return url;
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="100%" height="100%" fill="#cbd5e1"/><text x="50%" y="54%" fill="#fff" font-size="36" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">G</text></svg>'
  );
}
</script>

<template>
  <nav class="navbar">
    <div class="side left">
      <RouterLink class="brand" to="/">Game Score</RouterLink>
    </div>

    <div class="nav-center">
      <RouterLink class="nav-item" to="/">{{ lang.t("nav.home") }}</RouterLink>
      <RouterLink class="nav-item" to="/games">{{ lang.t("nav.games") }}</RouterLink>
      <RouterLink class="nav-item" to="/reviews">{{ lang.t("nav.reviews") }}</RouterLink>
    </div>

    <div class="side right">
      <template v-if="auth.isLoggedIn">
        <RouterLink v-if="auth.isAdmin" class="btn-add" to="/games/new">{{ lang.t("nav.addGame") }}</RouterLink>
        <RouterLink v-if="auth.isOwner" class="btn-manage" to="/admin">{{ lang.t("nav.manage") }}</RouterLink>

        <div class="user-menu">
          <RouterLink class="user-trigger" :to="`/user/${auth.user?.id}`">
            <img class="avatar" :src="avatarUrl(auth.user?.avatar)" :alt="userDisplay" />
            <span class="user-name">{{ userDisplay }}</span>
          </RouterLink>
          <div class="dropdown">
            <div class="dropdown-inner">
              <RouterLink class="dropdown-item" :to="`/user/${auth.user?.id}`">{{ lang.t("nav.myProfile") }}</RouterLink>
              <RouterLink class="dropdown-item" to="/reviews/new">{{ lang.t("nav.writeReview") }}</RouterLink>
              <button class="dropdown-item logout" @click="onLogout">{{ lang.t("nav.logout") }}</button>
            </div>
          </div>
        </div>

        <button class="lang-btn" @click="lang.toggle()">{{ lang.isEn ? "中文" : "EN" }}</button>
      </template>
      <template v-else>
        <RouterLink class="btn-link" to="/login">{{ lang.t("nav.login") }}</RouterLink>
        <RouterLink class="btn-primary" to="/register">{{ lang.t("nav.register") }}</RouterLink>
        <button class="lang-btn" @click="lang.toggle()">{{ lang.isEn ? "中文" : "EN" }}</button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  padding: 0 24px;
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
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
  color: #2563eb;
}

/* 中间导航：整体居中 */
.nav-center {
  display: flex;
  gap: 20px;
  align-items: center;
}

.nav-item {
  text-decoration: none;
  color: #374151;
  font-size: 15px;
}

.nav-item:hover {
  color: #2563eb;
}

/* 管理员添加游戏按钮，位于头像左侧 */
.btn-add {
  padding: 6px 14px;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}

.btn-add:hover {
  background: #1d4ed8;
}

/* 站长管理入口，位于添加游戏旁边，站长专属 */
.btn-manage {
  padding: 6px 14px;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  border: 1px solid #d1d5db;
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}

.btn-manage:hover {
  border-color: #2563eb;
  color: #2563eb;
  background: #f8faff;
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
  background: #f3f4f6;
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #e5e7eb;
  line-height: 0;
}

.user-name {
  color: #374151;
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
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font-size: 14px;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
}

.dropdown-item:hover {
  background: #f3f4f6;
  color: #2563eb;
}

.dropdown-item.logout {
  color: #dc2626;
}

.dropdown-item.logout:hover {
  background: #fef2f2;
  color: #dc2626;
}

.btn-link {
  color: #2563eb;
  text-decoration: none;
}

.btn-primary {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  text-decoration: none;
  border: 1px solid transparent;
  background: #2563eb;
  color: #fff;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.lang-btn {
  padding: 5px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.lang-btn:hover {
  background: #f3f4f6;
}
</style>