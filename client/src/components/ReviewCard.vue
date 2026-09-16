<script setup>
import { coverUrl, reviewCover, gameDisplayName } from "@/utils/markdown";
import { useLangStore } from "@/stores/lang";

defineProps({
  review: { type: Object, required: true },
});

const lang = useLangStore();

function formatTime(t) {
  return new Date(t).toLocaleDateString(lang.isEn ? "en-US" : "zh-CN");
}
</script>

<template>
  <RouterLink class="card" :to="`/reviews/${review.id}`">
    <img class="cover" :src="coverUrl(reviewCover(review))" :alt="gameDisplayName(review, lang.isEn)" />
    <div class="body">
      <div class="title-row">
        <h3 class="title">{{ review.title }}</h3>
        <span class="rating">{{ Number(review.rating).toFixed(1) }}</span>
      </div>
      <div class="meta">
        <span>{{ review.author?.username }}</span>
        <span>{{ formatTime(review.publishedAt) }}</span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: var(--shadow-sm);
}

.cover {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: var(--surface-2);
}

.body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.title {
  font-size: 16px;
  color: var(--text);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rating {
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 14px;
  white-space: nowrap;
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}
</style>