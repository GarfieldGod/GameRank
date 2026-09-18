<script setup>
import { useRouter } from "vue-router";
import { useLangStore } from "@/stores/lang";

const router = useRouter();
const lang = useLangStore();

function goBack() {
  // 有历史记录则返回上一页，否则回首页
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push("/");
  }
}
</script>

<template>
  <div class="not-found">
    <div class="art">
      <span class="code">404</span>
    </div>
    <h1 class="title">{{ lang.isEn ? "Page Not Found" : "页面不存在" }}</h1>
    <p class="desc">
      {{ lang.isEn
        ? "The page you are looking for may have been deleted, removed, or never existed."
        : "你访问的页面可能已被删除、失效或从未存在过。" }}
    </p>
    <button class="back" @click="goBack">{{ lang.isEn ? "Go Back" : "返回上一页" }}</button>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 60vh;
  text-align: center;
  padding: 40px 20px;
}

.art {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.code {
  font-size: 92px;
  font-weight: 800;
  line-height: 1;
  color: var(--primary);
  letter-spacing: -4px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-1);
  margin: 0;
}

.desc {
  color: var(--text-2);
  font-size: 15px;
  max-width: 420px;
  line-height: 1.6;
  margin: 0;
}

.back {
  margin-top: 10px;
  padding: 10px 26px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.back:hover {
  opacity: 0.85;
}
</style>