<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import NavBar from "@/components/NavBar.vue";

const route = useRoute();
// 游戏库页面加宽容器，使左侧标签筛选更靠左
const isWide = computed(() => route.path === "/games");
</script>

<template>
  <div id="app">
    <NavBar />
    <main class="page" :class="{ wide: isWide }">
      <RouterView />
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