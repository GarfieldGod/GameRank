<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useLangStore } from "@/stores/lang";

const lang = useLangStore();
const route = useRoute();

// 移动端编辑页/新建页不显示回到顶部按钮
const isMobile = ref(window.innerWidth <= 768);
function onResize() {
  isMobile.value = window.innerWidth <= 768;
}

// 编辑页入口：路径以 /edit 结尾，或为新建页 /new
function isEditPage() {
  const p = route.path;
  return /\/edit($|\?)/.test(p) || /\/new($|\?)/.test(p);
}

const scrolled = ref(false);
const show = computed(() => scrolled.value && !(isMobile.value && isEditPage()));

function onScroll() {
  // 仅当滑动距离超过一个页面高度时显示
  scrolled.value = window.scrollY > window.innerHeight;
}
onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  onScroll();
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onResize);
});

function toTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
</script>

<template>
  <button
    v-if="show"
    class="top-fab"
    type="button"
    :title="lang.isEn ? 'Back to top' : '回到顶部'"
    aria-label="回到顶部"
    @click="toTop"
  >
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 15l8-8 8 8z"/></svg>
  </button>
</template>

<style scoped>
/* 回到顶部浮窗：position:fixed，不随滚动移动。
   水平定位与返回按钮对称（右下角），以实际内容宽度(--content-w)为基准计算内容右缘：
   · 有空间时（宽屏）落在内容容器右缘外侧 20px 处（按钮宽40 + 间隔20 = 右移60），不占据内容；
   · 空间不足时退化为内侧贴边(16px)，侵入内容右下角。 */
.top-fab {
  position: fixed;
  right: 0;
  bottom: 24px;
  transform: translateX(calc(-1 * max(16px, calc((100vw - var(--content-w, 960px)) / 2 - 60px))));
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

.top-fab:hover {
  background: var(--hover);
  color: var(--primary);
}
</style>