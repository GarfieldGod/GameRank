<script setup>
import { useLangStore } from "@/stores/lang";
const lang = useLangStore();
</script>

<template>
  <div>
    <h1>{{ lang.t("home.title") }}</h1>
    <p class="muted">{{ lang.t("home.subtitle") }}</p>
  </div>
</template>

<style scoped>
h1 {
  margin-bottom: 12px;
}
.muted {
  color: #6b7280;
}
</style>