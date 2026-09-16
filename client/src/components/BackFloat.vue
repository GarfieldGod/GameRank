<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

// 路由就绪后箭头才渲染：避免刷新时主页/首帧短暂闪现（route.name 尚未解析）
const routeReady = ref(false);
onMounted(() => {
  router.isReady().then(() => {
    routeReady.value = true;
  });
});

// 顶层页集合：处于这些页面时不显示返回箭头
const HUB = new Set(["home", "game-list", "review-list"]);
// 是否显示返回箭头：非顶层页显示；自己的主页隐藏、别人的主页显示
const showBack = computed(() => {
  if (!routeReady.value) return false;
  if (route.name === "user-profile") {
    const isOwn = auth.isLoggedIn && auth.user?.id != null && Number(route.params.userId) === auth.user.id;
    return !isOwn;
  }
  return !HUB.has(route.name);
});

function onBack() {
  router.back();
}
</script>

<template>
  <button
    v-if="showBack"
    class="back-fab"
    type="button"
    :title="lang.isEn ? 'Back' : '返回'"
    aria-label="返回"
    @click="onBack"
  >
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15 4l-8 8 8 8z"/></svg>
  </button>
</template>

<style scoped>
/* 返回浮窗：position:fixed，不随页面滚动移动。
   水平定位用 max(内侧贴边, 内容左缘外侧)，以实际内容宽度(--content-w)为基准：
   · 有空间时（宽屏）落在内容容器左缘外侧 20px 处（按钮宽40 + 间隔20 = 左移60），不占据内容；
   · 空间不足时退化为内侧贴边(16px)，侵入内容左上角。 */
.back-fab {
  position: fixed;
  left: 0;
  top: 80px; /* 导航栏高 56 + .page 上内边距 24 = 内容卡片顶部 */
  transform: translateX(max(16px, calc((100vw - var(--content-w, 960px)) / 2 - 60px)));
  z-index: 40; /* 低于导航栏(50)，高于正文 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-1);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.back-fab:hover {
  background: var(--hover);
  color: var(--primary);
}
</style>