<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { fetchReview, deleteReview } from "@/api/review";
import { coverUrl, renderMarkdown } from "@/utils/markdown";
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
      <img class="cover" :src="coverUrl(review.coverImageUrl)" :alt="review.gameName" />

      <div class="head">
        <h1>{{ review.title }}</h1>
        <div class="head-meta">
          <span class="game">{{ review.gameName }}</span>
          <span class="rating">{{ review.rating }} {{ lang.t("review.detail.unit") }}</span>
        </div>
        <div class="tags">
          <span v-for="t in review.tags" :key="t" class="tag">{{ t }}</span>
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
  color: #4b5563;
}

.rating {
  background: #fde68a;
  color: #92400e;
  font-weight: 700;
  border-radius: 8px;
  padding: 3px 10px;
}

.tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  background: #eef2ff;
  color: #4338ca;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
}

.author {
  color: #6b7280;
  font-size: 14px;
}

.updated {
  color: #9ca3af;
}

.actions {
  display: flex;
  gap: 10px;
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
  background: #2563eb;
  color: #fff;
}

.btn.danger {
  background: #ef4444;
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
  background: #f3f4f6;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}
.markdown pre {
  background: #111827;
  color: #f9fafb;
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
}
.markdown pre code {
  background: none;
  padding: 0;
}
.markdown blockquote {
  border-left: 4px solid #e5e7eb;
  padding-left: 12px;
  color: #6b7280;
  margin: 0.6em 0;
}
.markdown img {
  max-width: 100%;
  border-radius: 8px;
}
</style>