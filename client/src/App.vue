<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import BackFloat from "@/components/BackFloat.vue";
import BackTopFloat from "@/components/BackTopFloat.vue";
import NavBar from "@/components/NavBar.vue";
import { heartbeat } from "@/api/user";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const auth = useAuthStore();
const theme = useThemeStore();

// 游戏库页面加宽容器，使左侧标签筛选更靠左
const isWide = computed(() => route.path === "/games");

// 登录期间每 30s 上报一次心跳，维持在线状态（判定阈值 60s）
let hbTimer = null;
function startHeartbeat() {
  stopHeartbeat();
  heartbeat();
  hbTimer = setInterval(() => {
    if (auth.isLoggedIn) heartbeat();
  }, 30000);
}
function stopHeartbeat() {
  if (hbTimer) {
    clearInterval(hbTimer);
    hbTimer = null;
  }
}

// 登录态变化（登录/登出/刷新）后：同步账号主题，并启停心跳
watch(
  () => auth.isLoggedIn,
  (on) => {
    theme.syncFromUser();
    if (on) startHeartbeat();
    else stopHeartbeat();
  }
);

// 切回本标签页时同步一次实时角色：站长在别处提拔/降职后，回到页面即更新按钮与入口
function onFocus() {
  if (document.visibilityState === "visible") auth.syncRole();
}
onMounted(() => {
  // 刷新页面后 store 已恢复登录态，watch 不会触发，需主动启动心跳
  if (auth.isLoggedIn) startHeartbeat();
  window.addEventListener("focus", onFocus);
});
onBeforeUnmount(() => {
  stopHeartbeat();
  window.removeEventListener("focus", onFocus);
});
</script>

<template>
  <div id="app" :style="{ '--content-w': isWide ? '1200px' : '960px' }">
    <NavBar />
    <BackFloat />
    <BackTopFloat />
    <main class="page" :class="{ wide: isWide }">
      <RouterView v-slot="{ Component }">
        <KeepAlive :include="['GameListView', 'ReviewListView', 'GameDetailView']">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px;
  transition: max-width 0.15s;
}

.page.wide {
  max-width: 1200px;
}
</style>