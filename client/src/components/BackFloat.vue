<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { markFromBack } from "@/utils/backSignal";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

// 路由就绪后箭头才渲染：避免刷新时主页/首帧短暂闪现（route.name 尚未解析）
const routeReady = ref(false);

// 是否为编辑类页面：编辑器入口路径以 /edit 结尾，或为新建页 /new
function isEditPage(path) {
  return /\/edit($|\?)/.test(path) || /\/new($|\?)/.test(path);
}

// 历史栈：记录 push 类导航顺序，供「返回时跳过编辑页」计算回退步数。
// router.go() 触发的导航会经 afterEach 再次进入栈，故用 suppressPush 屏蔽，
// 并在 go 之后自行裁剪栈与浏览器历史对齐，避免下次返回的步数错位。
const stack = ref([]);
let suppressPush = false; // onBack 触发的 go 导航不再计入栈
let offNav = null;

// 顶层页集合：处于这些页面时不显示返回箭头
const HUB = new Set(["home", "game-list", "review-list"]);
// 是否显示返回箭头：非顶层页显示；自己的主页隐藏、别人的主页显示。
// 编辑页不在返回时隐藏——返回箭头始终存在，仅点击返回时跳过编辑页。
const showBack = computed(() => {
  if (!routeReady.value) return false;
  if (route.name === "user-profile") {
    const isOwn = auth.isLoggedIn && auth.user?.username != null && route.params.username === auth.user.username;
    return !isOwn;
  }
  return !HUB.has(route.name);
});

onMounted(() => {
  router.isReady().then(() => {
    routeReady.value = true;
    stack.value = [route.fullPath];
    offNav = router.afterEach((to) => {
      if (suppressPush) { suppressPush = false; return; }
      // 进入顶层页（首页/游戏库/评测库）即开启新一轮浏览：清空返回栈，
      // 使这些页面返回按钮不显示，也避免旧历史污染后续返回位置。
      if (HUB.has(to.name)) {
        stack.value = [to.fullPath];
        return;
      }
      stack.value.push(to.fullPath);
    });
  });
});

onBeforeUnmount(() => {
  if (offNav) offNav();
});

// 返回：跳过编辑页（含其新建入口 /new），计算需回退步数并跳转，
// 再将栈裁剪与浏览器历史对齐（裁掉被跳过的记录），保证下一次返回仍正确。
function onBack() {
  const s = stack.value;
  let idx = s.length - 2; // 当前页在栈尾，从它前一位开始向前查找回退目标
  while (idx >= 0 && isEditPage(s[idx])) idx--;
  const best = Math.max(0, idx);
  const delta = Math.max(1, s.length - 1 - best);
  // 标记「来自返回按钮」：列表页 onActivated 据此恢复滚动位置；导航栏/普通跳转则不标记、置顶
  markFromBack();
  suppressPush = true;
  router.go(-delta);
  // go(-delta) 后浏览器当前位于 s[len-1-delta]，栈裁到该位置、保留其前全部条目
  stack.value = s.slice(0, s.length - delta);
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