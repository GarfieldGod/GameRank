<script setup>
import { coverUrl } from "@/utils/markdown";
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
    <img class="cover" :src="coverUrl(review.coverImageUrl)" :alt="review.gameName" />
    <div class="body">
      <div class="title-row">
        <h3 class="title">{{ review.title }}</h3>
        <span class="rating">{{ review.rating }}</span>
      </div>
      <div class="tags-row">
        <span v-for="t in review.tags" :key="t" class="mini-tag">{{ t }}</span>
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
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

.cover {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: #e5e7eb;
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
  color: #111827;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rating {
  background: #fde68a;
  color: #92400e;
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 14px;
  white-space: nowrap;
}

.tags-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mini-tag {
  font-size: 12px;
  background: #f3f4f6;
  border-radius: 4px;
  padding: 2px 8px;
  color: #4b5563;
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #6b7280;
}
</style>