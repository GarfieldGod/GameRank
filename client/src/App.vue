<script setup>
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import NavBar from "@/components/NavBar.vue";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const auth = useAuthStore();
const theme = useThemeStore();

// 游戏库页面加宽容器，使左侧标签筛选更靠左
const isWide = computed(() => route.path === "/games");

// 登录态变化（登录/登出/刷新）后，同步并应用账号对应的主题
watch(
  () => auth.isLoggedIn,
  () => theme.syncFromUser()
);
</script>

<template>
  <div id="app">
    <NavBar />
    <main class="page" :class="{ wide: isWide }">
      <RouterView v-slot="{ Component }">
        <KeepAlive :include="['GameListView', 'ReviewListView']">
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