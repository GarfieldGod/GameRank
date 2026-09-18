<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { fetchReview, deleteReview, reactToReview } from "@/api/review";
import { fetchDeletedReview } from "@/api/admin";
import { coverUrl, renderMarkdown, reviewCover, gameDisplayName } from "@/utils/markdown";
import { aspectLabel, aspectColor } from "@/utils/aspects";
import { markReviewsDirty } from "@/utils/dirtySignal";
import { useAuthStore, displayName } from "@/stores/auth";
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
// 评测所属游戏跳转目标（游戏详情路由为 /game/:id 单数）
const gameUrl = computed(() => (review.value?.game?.id ? `/game/${review.value.game.id}` : ""));
// 综合得分固定显示 1 位小数
const ratingText = computed(() => {
  const r = review.value?.rating;
  return r == null ? "" : Number(r).toFixed(1);
});

// 作者信息卡片：昵称（回退用户名）、头像首字母、排行榜游戏数、游戏排名
const authorName = computed(() => review.value?.author?.nickname || review.value?.author?.username || "");
const authorProfileUrl = computed(() => {
  const username = review.value?.author?.username;
  return username ? `/user/${username}` : "";
});
const avatarInitial = computed(() => (authorName.value ? authorName.value.charAt(0).toUpperCase() : "?"));
const reviewTotal = computed(() => review.value?.authorReviewTotal ?? 0);
const rankText = computed(() => {
  const n = review.value?.authorRank;
  return n == null ? "" : lang.t("review.rank", { n });
});

// 分项评分默认收起，点击标题右侧箭头展开/收起
const aspectExpanded = ref(false);

// 点赞/不认可：本地维护，投票后立即更新
const likeCount = ref(0);
const dislikeCount = ref(0);
const myReaction = ref(null);

async function react(kind) {
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  try {
    const r = await reactToReview(review.value.id, kind);
    markReviewsDirty();
    likeCount.value = r.likeCount;
    dislikeCount.value = r.dislikeCount;
    myReaction.value = r.myReaction;
  } catch {
    /* 网络/权限错误静默忽略，保持现状 */
  }
}

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
  // 软删除预览：公开接口不返回已删除评测，数据由 loadPreview 拉取；
  // 先进入加载态，让骨架屏正常展示（与普通详情页一致）
  if (route.query.preview === "deleted") {
    loading.value = true;
    return;
  }
  loading.value = true;
  notFound.value = false;
  try {
    review.value = await fetchReview(route.params.id);
    likeCount.value = review.value.likeCount ?? 0;
    dislikeCount.value = review.value.dislikeCount ?? 0;
    myReaction.value = review.value.myReaction ?? null;
  } catch (err) {
    if (err?.response?.status === 404 || err?.status === 404) {
      router.replace({ name: "not-found" });
    } else {
      notFound.value = true;
    }
  } finally {
    loading.value = false;
  }
}

// —— 软删除评测预览 ——
// 管理页不可见列表点击“预览”跳转到本页（?preview=deleted），
// 从管理接口拉取删除前快照展示；非管理员访问该接口 401，按不存在处理。
const preview = ref(null);
const previewing = computed(() => Boolean(preview.value));
async function loadPreview() {
  if (route.query.preview !== "deleted") {
    preview.value = null;
    return;
  }
  const id = Number(route.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    preview.value = null;
    notFound.value = true;
    loading.value = false;
    return;
  }
  try {
    const r = await fetchDeletedReview(id);
    preview.value = { data: r };
    review.value = r;
    likeCount.value = 0;
    dislikeCount.value = 0;
    myReaction.value = null;
    notFound.value = false;
  } catch {
    preview.value = null;
    notFound.value = true;
  } finally {
    loading.value = false;
  }
}
function exitPreview() {
  router.back();
}

async function onDelete() {
  // 纯管理员（非站长）删除他人评测 = 软删除，须填写删除原因（作者将收到事务通知）
  let reason = null;
  if (auth.isAdmin && !auth.isOwner && !isAuthor.value) {
    reason = window.prompt(lang.t("review.detail.deleteReasonPrompt"), "");
    if (reason == null || !String(reason).trim()) return;
    reason = String(reason).trim();
  }
  if (!window.confirm(lang.t("review.detail.deleteConfirm"))) return;
  try {
    await deleteReview(review.value.id, reason);
    markReviewsDirty();
    router.push("/reviews");
  } catch (err) {
    alert(err?.response?.data?.error || lang.t("review.detail.deleteFailed"));
  }
}

// 路由参数（评测 id / 是否软删除预览）变化时统一重置并重新加载。
// 详情页会复用同一组件实例（如 /reviews/3 → /reviews/4、普通详情 ↔ 删除预览），
// 若不监听，路由变化后不会重新拉取，界面残留上一篇文章的脏数据。
function reloadForRoute() {
  review.value = null;
  preview.value = null;
  likeCount.value = 0;
  dislikeCount.value = 0;
  myReaction.value = null;
  loading.value = true;
  notFound.value = false;
  if (route.query.preview === "deleted") {
    loadPreview();
  } else {
    load();
  }
}
watch(() => [route.params.id, route.query.preview], reloadForRoute, { immediate: true });
</script>

<template>
  <div class="detail-page" :class="{ 'content-fade': !loading && !notFound }">
    <template v-if="loading">
      <!-- 真实容器空态占位：封面宽高比已固定(与加载完成一致)，复用 .head/.author-card 容器，
           容器高度加载前后一致，配合内容淡入避免跳变 -->
      <div class="sk" style="width: 100%; aspect-ratio: 16 / 9; max-height: 360px; border-radius: 12px"></div>
      <div class="head">
        <div class="sk sk-h24 sk-w65" style="margin: 2px 0"></div>
        <div style="display: flex; align-items: center; gap: 14px; margin: 6px 0 4px">
          <div class="sk sk-h12 sk-w32"></div>
          <div class="sk sk-h14 sk-w12"></div>
        </div>
        <div class="sk-text sk-w88"></div>
        <div class="sk-text sk-w60"></div>
      </div>
      <div class="author-card">
        <div style="display: flex; align-items: center; gap: 12px; padding: 4px 0">
          <div class="sk" style="width: 42px; height: 42px; border-radius: 50%; flex: 0 0 auto"></div>
          <div style="flex: 1">
            <div class="sk sk-h14 sk-w24" style="margin-bottom: 8px"></div>
            <div class="sk sk-h10 sk-w18"></div>
          </div>
          <div class="sk sk-h28" style="width: 12%"></div>
        </div>
      </div>
      <div class="sk-text sk-w95"></div>
      <div class="sk-text sk-w90"></div>
      <div class="sk-text sk-w75"></div>
      <div class="sk-text sk-w88" style="margin-bottom: 26px"></div>
    </template>
    <p v-else-if="notFound">{{ lang.t("review.detail.notFound") }}</p>

    <template v-else-if="review">
      <!-- 预览横幅：软删除评测预览（管理页不可见列表跳转而来） -->
      <div v-if="previewing" class="preview-banner">
        <span class="preview-tag">{{ lang.t("admin.deletedPreviewTag") }}</span>
        <span class="preview-text">
          {{ lang.t("admin.deletedReviewBanner", { name: review.deletedBy ? displayName(review.deletedBy) : "" }) }}
          <em v-if="review.deleteReason" class="preview-reason">{{ lang.t("admin.deletedReason", { reason: review.deleteReason }) }}</em>
        </span>
        <button class="preview-exit" @click="exitPreview">{{ lang.t("admin.backToAdmin") }}</button>
      </div>

      <RouterLink v-if="gameUrl" class="cover-link" :to="gameUrl" :title="gameDisplayName(review, lang.isEn)">
        <img class="cover" :src="coverUrl(reviewCover(review))" :alt="gameDisplayName(review, lang.isEn)" />
      </RouterLink>
      <img v-else class="cover" :src="coverUrl(reviewCover(review))" :alt="gameDisplayName(review, lang.isEn)" />

      <div class="head">
        <h1>{{ review.title }}</h1>
        <div class="head-meta">
          <RouterLink v-if="gameUrl" class="game" :to="gameUrl">{{ gameDisplayName(review, lang.isEn) }}</RouterLink>
          <span v-else class="game">{{ gameDisplayName(review, lang.isEn) }}</span>
          <span class="rating">{{ ratingText }}<em class="unit">{{ lang.t("review.detail.unit") }}</em></span>
        </div>
        <p v-if="review.brief" class="brief">{{ review.brief }}</p>
      </div>

      <!-- 作者信息卡片：上容器=作者信息（头像+昵称/排行+时间），下容器=分项评测 -->
      <div v-if="review.author || params.length" class="author-card">
        <div v-if="review.author" class="ac-row">
          <RouterLink class="ac-main" :to="`/user/${review.author.username}`">
            <img v-if="review.author.avatar" class="ac-avatar" :src="review.author.avatar" :alt="authorName" referrerpolicy="no-referrer" />
            <span v-else class="ac-avatar ph">{{ avatarInitial }}</span>
            <span class="ac-info">
              <span class="ac-name" :title="authorName">{{ authorName }}</span>
              <span v-if="reviewTotal > 0" class="ac-count">{{ lang.t("review.rankTotal", { m: reviewTotal }) }}</span>
            </span>
          </RouterLink>
          <RouterLink
            v-if="review.authorRank != null"
            class="ac-rank"
            :to="authorProfileUrl"
            :title="rankText"
          >#{{ review.authorRank }}</RouterLink>
          <div class="ac-side">
            <div class="actions">
              <RouterLink v-if="!previewing && isAuthor" class="btn edit" :to="`/reviews/${review.id}/edit`">{{ lang.t("review.detail.edit") }}</RouterLink>
              <button v-if="!previewing && canDelete" class="btn danger" @click="onDelete">{{ lang.t("review.detail.delete") }}</button>
            </div>
            <div class="ac-times">
              <span class="published">{{ lang.t("review.detail.published") }} {{ formatTime(review.publishedAt) }}</span>
              <span v-if="review.updatedAt !== review.publishedAt" class="updated">
                · {{ lang.t("review.detail.updated") }} {{ formatTime(review.updatedAt) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="params.length" class="ac-aspects">
          <div class="aspect-header" @click="aspectExpanded = !aspectExpanded">
            <h2>{{ lang.t("review.detail.aspects") }}</h2>
            <button
              type="button"
              class="aspect-toggle"
              :class="{ expanded: aspectExpanded }"
              :aria-label="aspectExpanded ? '收起分项评测' : '展开分项评测'"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          <Transition name="aspect">
          <ul v-if="aspectExpanded" class="aspect-list">
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
          </Transition>
        </div>
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <article class="markdown" v-html="html"></article>

      <!-- 正文与页面底部分界线：可交互的点赞/不认可按钮居右（预览模式隐藏） -->
      <div v-if="!previewing" class="body-foot">
        <div class="reactions">
          <button
            type="button"
            class="reaction"
            :class="{ active: myReaction === 'like' }"
            @click="react('like')"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 11h3l.5-5a2 2 0 0 1 4 0l-.7 3H18a2 2 0 0 1 2 2.2l-1 6A2 2 0 0 1 17 19H7M7 11v8M2 11v8h5v-8H2z" />
            </svg>
            {{ lang.t("review.like") }}
            <span class="cnt">{{ likeCount }}</span>
          </button>
          <button
            type="button"
            class="reaction down"
            :class="{ active: myReaction === 'dislike' }"
            @click="react('dislike')"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 13h-3l-.5 5a2 2 0 0 1-4 0l.7-3H6a2 2 0 0 1-2-2.2l1-6A2 2 0 0 1 7 5h10M17 13V5M22 13V5h-5v8h5z" />
            </svg>
            {{ lang.t("review.dislike") }}
            <span class="cnt">{{ dislikeCount }}</span>
          </button>
        </div>
      </div>
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

/* 加载完成时高度已被空态容器锁定，仅做一次柔和淡入，避免内容替换时的生硬跳变 */
.detail-page.content-fade {
  animation: review-content-fade 0.28s ease;
}
@keyframes review-content-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 软删除评测预览横幅：危险色系，标识“已删除”状态 */
.preview-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--danger);
  border-radius: 10px;
  background: var(--danger-bg);
  color: var(--danger);
}
.preview-tag {
  font-size: 12px;
  font-weight: 700;
  background: var(--danger);
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.preview-text {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-reason {
  font-style: normal;
  opacity: 0.85;
  margin-left: 8px;
}
.preview-exit {
  flex-shrink: 0;
  padding: 5px 12px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  background: transparent;
  color: var(--danger);
  font-size: 13px;
  cursor: pointer;
}
.preview-exit:hover {
  background: var(--danger);
  color: #fff;
}

.cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 360px;
  object-fit: cover;
  border-radius: 12px;
  background: var(--surface-2);
}

/* 游戏封面可点击：hover 轻微放大提示跳转游戏详情 */
.cover-link {
  display: block;
  border-radius: 12px;
  overflow: hidden;
}
.cover-link img {
  transition: transform 0.2s ease;
}
.cover-link:hover img {
  transform: scale(1.02);
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
  gap: 14px;
  min-width: 0;
}

.game {
  flex-shrink: 0; /* 简述过宽时优先收缩简述，而不是截断游戏名 */
  min-width: 0;
  font-size: 36px; /* 行高 42px，正好等于分数框高度 */
  line-height: 1.5;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 游戏名可点击：跳转游戏详情 */
.game {
  text-decoration: none;
  transition: color 0.15s;
}
a.game:hover {
  color: var(--primary);
}

.rating {
  flex-shrink: 0;
  height: 42px; /* 固定分数框高度，与游戏名字体行高一致 */
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  font-size: 20px;
  border-radius: 6px;
  padding: 0 14px;
}

.rating .unit {
  font-style: normal;
  font-size: 14px;
  font-weight: 500;
  opacity: 0.85;
}

.brief {
  color: var(--text-2);
  font-size: 16px;
  line-height: 1.6;
  margin: 0; /* 简述独立成行，位于游戏名下方，超长时自然换行 */
}

.published {
  white-space: nowrap;
}

.updated {
  color: var(--text-3);
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 26px; /* + 发布时间行(22px) = 48px，对齐头像；保留高度占位 */
}
.actions .btn {
  padding: 4px 14px;
  font-size: 13px;
}

.author-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 18px;
  background: var(--surface);
}
.ac-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ac-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  height: 48px; /* 与头像高度一致：使 操作按钮(26) + 发布时间行(22) 总高 = 48 */
  gap: 0;
  margin-left: auto;
}
.ac-times {
  display: flex;
  align-items: center;
  height: 22px; /* 与操作按钮(26)合计 48px，对齐头像 */
  gap: 8px;
  color: var(--text-2);
  font-size: 13px;
  white-space: nowrap;
}
.ac-aspects {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.ac-main {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  min-width: 0;
}
.ac-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface-2);
}
.ac-avatar.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  font-weight: 700;
}
.ac-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ac-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-main:hover .ac-name {
  color: var(--primary);
}
.ac-count {
  font-size: 12px;
  color: var(--text-2);
}
.ac-rank {
  flex-shrink: 0;
  height: 42px; /* 与游戏分数框等高 */
  min-width: 34px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-2);
  white-space: nowrap;
}
.ac-rank:hover {
  color: var(--primary);
}

.aspect-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}
.aspect-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text);
}
.aspect-toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 6px;
  cursor: pointer;
  transition: transform 0.2s ease, color 0.15s, background 0.15s;
}
.aspect-toggle:hover {
  color: var(--primary);
  background: var(--surface-2);
}
.aspect-toggle.expanded {
  transform: rotate(180deg);
}
.aspect-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aspect-enter-active,
.aspect-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.aspect-enter-from,
.aspect-leave-to {
  opacity: 0;
  transform: translateY(-6px);
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

/* 正文底部分界线：点赞数、不认可数居右 */
.body-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--border-strong);
}
.reactions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.reaction {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  padding: 4px 12px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.reaction .cnt {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-1);
}
.reaction:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.reaction.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}
.reaction.active .cnt { color: var(--primary); }
.reaction.down.active {
  background: var(--danger-soft, var(--primary-soft));
  color: var(--danger, var(--primary));
  border-color: var(--danger, var(--primary));
}
.reaction.down.active .cnt { color: var(--danger, var(--primary)); }
</style>