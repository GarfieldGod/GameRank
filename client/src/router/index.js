import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("@/views/HomeView.vue"),
    },
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      // 已登录访问登录页时，跳回首页
      meta: { guestOnly: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("@/views/RegisterView.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/reviews",
      name: "review-list",
      component: () => import("@/views/ReviewListView.vue"),
    },
    {
      path: "/reviews/new",
      name: "review-new",
      component: () => import("@/views/ReviewEditorView.vue"),
      // 未登录不可见：发布评测需登录
      meta: { requiresAuth: true },
    },
    {
      // 编辑评测需登录
      path: "/reviews/:id/edit",
      name: "review-edit",
      component: () => import("@/views/ReviewEditorView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/reviews/:id",
      name: "review-detail",
      component: () => import("@/views/ReviewDetailView.vue"),
    },
    {
      path: "/games",
      name: "game-list",
      component: () => import("@/views/GameListView.vue"),
    },
    {
      path: "/game/:id",
      name: "game-detail",
      component: () => import("@/views/GameDetailView.vue"),
    },
    {
      // 添加游戏：所有登录用户均可提交，待审批后公开展示
      path: "/games/new",
      name: "game-new",
      component: () => import("@/views/GameEditorView.vue"),
      meta: { requiresAuth: true },
    },
    {
      // 编辑游戏：管理员直接编辑保存；普通用户进入同一页面，提交后生成待审核编辑申请
      path: "/games/:id/edit",
      name: "game-edit",
      component: () => import("@/views/GameEditorView.vue"),
      meta: { requiresAuth: true },
    },
    {
      // 管理页：站长与管理员均可进入
      path: "/admin",
      name: "admin",
      component: () => import("@/views/AdminView.vue"),
      meta: { requiresAuth: true, adminOnly: true },
    },
    {
      // 个人主页：任何人可访问（URL 用唯一账号 username，避免暴露自增 id）
      path: "/user/:username",
      name: "user-profile",
      component: () => import("@/views/UserProfileView.vue"),
    },
    {
      // 编辑本人资料：需登录（是否本人由页面二次校验）
      path: "/user/:username/edit",
      name: "user-profile-edit",
      component: () => import("@/views/UserProfileEditView.vue"),
      meta: { requiresAuth: true },
    },
    {
      // 修改本人密码：需登录（是否本人由页面二次校验）
      path: "/user/:username/password",
      name: "user-password",
      component: () => import("@/views/UserPasswordView.vue"),
      meta: { requiresAuth: true },
    },
    {
      // 未匹配的路由统一渲染 404 页面
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("@/views/NotFoundView.vue"),
    },
  ],
  // 恢复滚动：缓存页面（列表 + 游戏详情）由 KeepAlive 组件通过
  // onBeforeRouteLeave / onActivated 自行保存恢复滚动，
  // 这里统一 return false 不让路由历史位置与其冲突（否则会用过时位置覆盖正确值）。
  // 其余页面前进时置顶，后退时用浏览器保存位置。
  scrollBehavior(to, _from, savedPosition) {
    if (to.name === "game-list" || to.name === "review-list" || to.name === "game-detail") return false;
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

// 守卫：
// - guestOnly 页面：已登录用户跳回首页
// - requiresAuth 页面：未登录跳登录页，并记录来路以便登录后返回
// - 登录态下每次导航先同步一次实时角色（/me），使提拔/降职后按钮与入口即时生效
router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  // 已登录：同步最新角色，避免使用陈旧缓存判断权限
  if (auth.isLoggedIn) {
    await auth.syncRole();
  }
  // 仅管理员页面：非管理员跳游戏库
  if (to.meta.adminOnly && !auth.isAdmin) {
    return { name: "game-list" };
  }
  // 仅站长页面：非站长跳首页
  if (to.meta.ownerOnly && !auth.isOwner) {
    return { name: "home" };
  }
  if (to.meta.guestOnly && auth.isLoggedIn) {
    return { name: "home" };
  }
  return true;
});

export default router;