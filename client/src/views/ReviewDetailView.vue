<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { fetchReview, deleteReview } from "@/api/review";
import { coverUrl, renderMarkdown, reviewCover, gameDisplayName } from "@/utils/markdown";
import { aspectLabel, aspectColor } from "@/utils/aspects";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

const review = ref(null);
const loading = ref(true);
const notFound = ref(false);

const html = computed(() => renderMarkdown(review.value?.content || ""));
const params = computed(() => (Array.isArray(review.value?.ratingParams) ? review.value.ratingParams : []));
// 综合得分固定显示 1 位小数
const ratingText = computed(() => {
  const r = review.value?.rating;
  return r == null ? "" : Number(r).toFixed(1);
});

// 当前登录用户是否是作者
const isAuthor = computed(
  () => Boolean(review.value) && auth.isLoggedIn && review.value.authorId === auth.user?.id
);

// 能否删除：作者本人或管理员（管理员可删他人的评测）
const canDelete = computed(() => auth.isLoggedIn && (isAuthor.value || auth.isAdmin));

function formatTime(t) {
  return new Date(t).toLocaleString(lang.isEn ? "en-US" : "zh-CN");
}

async function load() {
  loading.value = true;
  notFound.value = false;
  try {
    review.value = await fetchReview(route.params.id);
  } catch {
    notFound.value = true;
  } finally {
    loading.value = false;
  }
}

async function onDelete() {
  if (!window.confirm(lang.t("review.detail.deleteConfirm"))) return;
  try {
    await deleteReview(review.value.id);
    router.push("/reviews");
  } catch (err) {
    alert(err?.response?.data?.error || lang.t("review.detail.deleteFailed"));
  }
}

load();
</script>

<template>
  <div class="detail-page">
    <p v-if="loading">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound">{{ lang.t("review.detail.notFound") }}</p>

    <template v-else-if="review">
      <img class="cover" :src="coverUrl(reviewCover(review))" :alt="gameDisplayName(review, lang.isEn)" />

      <div class="head">
        <h1>{{ review.title }}</h1>
        <div class="head-meta">
          <span class="game">{{ gameDisplayName(review, lang.isEn) }}</span>
          <span class="rating">{{ ratingText }} {{ lang.t("review.detail.unit") }}</span>
        </div>
        <div class="author">
          {{ lang.t("review.detail.authorBy", { name: review.author?.username }) }}
          · {{ lang.t("review.detail.published") }} {{ formatTime(review.publishedAt) }}
          <span v-if="review.updatedAt !== review.publishedAt" class="updated">
            · {{ lang.t("review.detail.updated") }} {{ formatTime(review.updatedAt) }}
          </span>
        </div>
        <div v-if="isAuthor" class="actions">
          <RouterLink class="btn edit" :to="`/reviews/${review.id}/edit`">{{ lang.t("review.detail.edit") }}</RouterLink>
          <button class="btn danger" @click="onDelete">{{ lang.t("review.detail.delete") }}</button>
        </div>
        <div v-else-if="canDelete" class="actions">
          <button class="btn danger" @click="onDelete">{{ lang.t("review.detail.delete") }}</button>
        </div>
      </div>

      <section v-if="params.length" class="aspects">
        <h2>{{ lang.t("review.detail.aspects") }} <span class="aspects-total">{{ ratingText }}</span></h2>
        <ul class="aspect-list">
          <li v-for="(p, i) in params" :key="i" class="aspect">
            <span class="aspect-dot" :style="{ background: aspectColor(p.aspect) }"></span>
            <div class="aspect-body">
              <div class="aspect-head">
                <span class="aspect-name">{{ aspectLabel(p.aspect, lang.isEn) }}</span>
                <span class="aspect-score">
                  {{ Number(p.score).toFixed(1) }}
                  <em class="aspect-weight">{{ p.weight }}%</em>
                </span>
              </div>
              <p class="aspect-content">{{ p.content }}</p>
            </div>
          </li>
        </ul>
      </section>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <article class="markdown" v-html="html"></article>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 40px;
}

.cover {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  border-radius: 12px;
  background: var(--surface-2);
}

.head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head h1 {
  margin: 0;
  font-size: 26px;
}

.head-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.game {
  font-size: 15px;
  color: var(--text-1);
}

.rating {
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  border-radius: 8px;
  padding: 3px 10px;
}

.author {
  color: var(--text-2);
  font-size: 14px;
}

.updated {
  color: var(--text-3);
}

.actions {
  display: flex;
  gap: 10px;
}

.aspects {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  background: var(--surface);
}
.aspects h2 {
  margin: 0 0 14px;
  font-size: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
}
.aspects-total {
  color: var(--score-text);
  background: var(--score-bg);
  font-size: 15px;
  font-weight: 700;
  border-radius: 8px;
  padding: 2px 10px;
}
.aspect-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aspect {
  display: flex;
  gap: 12px;
}
.aspect-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}
.aspect-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.aspect-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.aspect-name {
  font-weight: 600;
  color: var(--text);
}
.aspect-score {
  color: var(--warn-text);
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
}
.aspect-weight {
  font-style: normal;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 500;
  margin-left: 6px;
}
.aspect-content {
  margin: 0;
  color: var(--text-1);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  font-size: 14px;
}

.btn.edit {
  background: var(--primary);
  color: #fff;
}

.btn.danger {
  background: var(--danger);
  color: #fff;
}
</style>

<style>
/* 渲染后的 markdown 基础排版 */
.markdown {
  line-height: 1.75;
  font-size: 16px;
}
.markdown h1,
.markdown h2,
.markdown h3 {
  margin: 1.2em 0 0.5em;
}
.markdown p {
  margin: 0.6em 0;
}
.markdown ul,
.markdown ol {
  padding-left: 1.4em;
  margin: 0.6em 0;
}
.markdown code {
  background: var(--surface-2);
  color: var(--text-1);
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}
.markdown pre {
  background: var(--surface-2);
  color: var(--text-1);
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
}
.markdown pre code {
  background: none;
  padding: 0;
}
.markdown blockquote {
  border-left: 4px solid var(--border-strong);
  padding-left: 12px;
  color: var(--text-2);
  margin: 0.6em 0;
}
.markdown img {
  max-width: 100%;
  border-radius: 8px;
}
</style>