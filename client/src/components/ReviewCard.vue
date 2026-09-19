<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { coverUrl, renderMarkdown, reviewCover, gameDisplayName } from "@/utils/markdown";
import { aspectLabel } from "@/utils/aspects";
import { reactToReview } from "@/api/review";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { markReviewsDirty } from "@/utils/dirtySignal";

const props = defineProps({
  review: { type: Object, required: true },
  // 评测库页：左侧展示游戏封面/名称/评分/排名的纵向面板
  gamePanel: { type: Boolean, default: false },
  // 游戏详情页评测变体：以评测库面板布局为基础，但不显示游戏封面与名称，分数移到卡片右上角
  detailPanel: { type: Boolean, default: false },
});

const lang = useLangStore();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// 封面淡入：图片加载完成后才显示（与游戏库封面同款加载方式），按评测 id 去重
const loadedCovers = reactive(new Set());
function onCoverLoad(id) {
  if (id != null) loadedCovers.add(id);
}
function isCoverLoaded(id) {
  return id != null && loadedCovers.has(id);
}

// 点赞/不认可数量与当前用户态度：本地维护，投票后即时更新
const local = reactive({
  likeCount: props.review.likeCount ?? 0,
  dislikeCount: props.review.dislikeCount ?? 0,
  myReaction: props.review.myReaction ?? null,
});
watch(
  () => props.review,
  (r) => {
    local.likeCount = r?.likeCount ?? 0;
    local.dislikeCount = r?.dislikeCount ?? 0;
    local.myReaction = r?.myReaction ?? null;
  }
);

const html = computed(() => renderMarkdown(props.review?.content || ""));
const author = computed(() => props.review?.author || {});
const authorName = computed(() => {
  const n = author.value.nickname?.trim();
  if (n) return n;
  return author.value.username || "";
});
const avatarInitial = computed(() => (authorName.value ? authorName.value.charAt(0).toUpperCase() : "?"));

// 评测对应的游戏：封面 + 名称（链接到游戏详情页）
const gameCover = computed(() => coverUrl(reviewCover(props.review)));
const gameName = computed(() => gameDisplayName(props.review, lang.isEn));
const gameId = computed(() => props.review?.game?.id ?? null);
// 作者主页链接
const authorProfileUrl = computed(() => {
  const username = author.value?.username;
  return username ? `/user/${username}` : "";
});
// 该作者评测排名：n=名次（含文案前缀）
const rankText = computed(() => {
  const r = props.review?.authorRank;
  if (r == null) return "";
  return lang.t("review.rank", { n: r });
});
// 该作者已发布的评测总数（排行榜游戏数）
const reviewTotal = computed(() => props.review?.authorReviewTotal ?? 0);
// 分项评分（若有）
const aspects = computed(() =>
  Array.isArray(props.review?.ratingParams) ? props.review.ratingParams : []
);
// 综合得分固定显示 1 位小数
const ratingText = computed(() => {
  const r = props.review?.rating;
  return r == null ? "" : Number(r).toFixed(1);
});
// 跳转目标：评测详情 / 游戏详情（注意游戏详情路由为 /game/:id 单数）
const reviewUrl = computed(() => (props.review?.id ? `/reviews/${props.review.id}` : ""));
const gameUrl = computed(() => (gameId.value ? `/game/${gameId.value}` : ""));
function goReview() {
  if (reviewUrl.value) router.push(reviewUrl.value);
}

// 整卡点击即进评测详情：仅当点击落在「空白 / 正文」区时生效；
// 命中带自身跳转或交互的元素（链接、按钮、游戏名行）时不拦截，交由它们各自处理。
function onCardClick(e) {
  if (!e.target.closest || e.target.closest("a, button, .gline")) return;
  goReview();
}

function formatTime(t) {
  if (!t) return "";
  return new Date(t).toLocaleString(lang.isEn ? "en-US" : "zh-CN");
}

// 正文折叠：超长时给出「查看完整评测」
const bodyEl = ref(null);
const expanded = ref(false);
const longContent = ref(false);
function checkLong() {
  if (bodyEl.value) longContent.value = bodyEl.value.scrollHeight > 270;
}
onMounted(() => nextTick(checkLong));
watch(
  () => props.review?.content,
  () => {
    expanded.value = false;
    nextTick(checkLong);
  },
  { immediate: true }
);

// 展开后检测正文是否真的达到三倍高度的截断上限；
// 未达上限则完整显示（无渐变截断、无额外按钮），只有真正超长被截断时才显示遮罩与「查看完整内容」。
const overflowed = ref(false);
watch(
  [expanded, longContent],
  async () => {
    if (!longContent.value || !expanded.value) {
      overflowed.value = false;
      return;
    }
    await nextTick();
    overflowed.value = !!bodyEl.value && bodyEl.value.scrollHeight > bodyEl.value.clientHeight;
  }
);

async function react(kind) {
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  try {
    const r = await reactToReview(props.review.id, kind);
    markReviewsDirty();
    local.likeCount = r.likeCount;
    local.dislikeCount = r.dislikeCount;
    local.myReaction = r.myReaction;
  } catch {
    /* 网络/权限错误静默忽略，保持现状 */
  }
}
</script>

<template>
  <article class="card" :class="{ panel: gamePanel || detailPanel, detail: detailPanel }" @click="onCardClick">
    <!-- 非评测库页：顶部横向封面栏 -->
    <RouterLink v-if="!gamePanel && !detailPanel && (gameName || gameCover)" class="game" :to="gameId ? `/game/${gameId}` : ''">
      <SmartImg v-if="gameCover" class="gcover" :src="gameCover" :alt="gameName" referrerpolicy="no-referrer" loading="lazy" />
      <span v-else class="gcover ph">{{ gameName?.charAt(0) || "G" }}</span>
      <span class="gname">{{ gameName }}</span>
    </RouterLink>

    <!-- 详情页顶部容器：排行+作者+评分+简述 水平排列于左/右容器之上 -->
    <div v-if="detailPanel" class="dbanner">
      <RouterLink v-if="authorProfileUrl" class="lauthor" :to="authorProfileUrl">
        <SmartImg v-if="author.avatar" class="lavatar" :src="author.avatar" :alt="authorName" referrerpolicy="no-referrer" />
        <span v-else class="lavatar ph">{{ avatarInitial }}</span>
        <span class="luserblock">
          <span class="lusername" :title="authorName">{{ authorName }}</span>
          <span v-if="reviewTotal > 0" class="lcount">{{ lang.t("review.rankTotal", { m: reviewTotal }) }}</span>
        </span>
      </RouterLink>
      <span v-if="review.authorRank != null" class="rank" :title="rankText">#{{ review.authorRank }}</span>
      <RouterLink v-if="review.brief" class="brief" :to="reviewUrl">{{ review.brief }}</RouterLink>
      <span v-if="ratingText" class="dscore" :title="lang.t('review.rating', { n: ratingText })">{{ ratingText }}</span>
    </div>

    <!-- 评测库页：左侧纵向游戏信息面板 -->
    <div v-if="gamePanel" class="left">
      <!-- 游戏名、分数整行：位于封面图上方 -->
      <div v-if="gamePanel && (gameName || gameCover)" class="gline" :title="gameName" @click="gameUrl && router.push(gameUrl)">
        <span class="lname">{{ gameName }}</span>
        <span class="gscore" :title="lang.t('review.rating', { n: ratingText })">{{ ratingText }}</span>
      </div>
      <RouterLink v-if="gamePanel && gameUrl && (gameName || gameCover)" class="lcoverlink" :to="gameUrl">
        <SmartImg
          v-if="gameCover"
          class="lcover"
          :class="{ loaded: isCoverLoaded(review.id) }"
          :src="gameCover"
          :alt="gameName"
          referrerpolicy="no-referrer"
          loading="lazy"
          @load="onCoverLoad(review.id)"
        />
        <span v-else class="lcover ph">{{ gameName?.charAt(0) || "G" }}</span>
      </RouterLink>
      <!-- 左侧分项评分：随正文一同折叠/展开，点击进入评测详情 -->
      <RouterLink v-if="longContent && aspects.length" class="aspects" :class="{ collapsed: !expanded }" :to="reviewUrl">
        <ul>
          <li v-for="(a, i) in aspects" :key="i">
            <span class="an" :title="aspectLabel(a.aspect, lang.isEn)">{{ aspectLabel(a.aspect, lang.isEn) }}</span>
            <span class="as">{{ Number(a.score).toFixed(1) }}</span>
          </li>
        </ul>
      </RouterLink>
      <!-- 底部整体：头像+用户名+排行榜+游戏排位（仅评测库；详情页作者组已置顶） -->
      <div v-if="!detailPanel" class="lfooter">
        <RouterLink v-if="authorProfileUrl" class="lauthor" :to="authorProfileUrl">
          <SmartImg v-if="author.avatar" class="lavatar" :src="author.avatar" :alt="authorName" referrerpolicy="no-referrer" />
          <span v-else class="lavatar ph">{{ avatarInitial }}</span>
          <span class="luserblock">
            <span class="lusername" :title="authorName">{{ authorName }}</span>
            <span v-if="reviewTotal > 0" class="lcount">{{ lang.t("review.rankTotal", { m: reviewTotal }) }}</span>
          </span>
        </RouterLink>
        <span v-if="review.authorRank != null" class="rank" :title="rankText">
          {{ rankText }}
        </span>
      </div>
    </div>

    <div class="right">
      <div v-if="!detailPanel" class="top">
        <span v-if="!gamePanel && review.authorRank != null" class="rank" :title="rankText">
          {{ rankText }}
        </span>
        <RouterLink v-if="!gamePanel && authorProfileUrl" class="alink" :to="authorProfileUrl">
          <SmartImg v-if="author.avatar" class="avatar" :src="author.avatar" :alt="authorName" referrerpolicy="no-referrer" />
          <span v-else class="avatar ph">{{ avatarInitial }}</span>
          <span class="author" :title="authorName">{{ authorName }}</span>
        </RouterLink>
        <span v-if="!gamePanel && !authorProfileUrl" class="author" :title="authorName">{{ authorName }}</span>
        <RouterLink v-if="review.brief" class="brief" :to="reviewUrl">{{ review.brief }}</RouterLink>
      </div>
      <!-- 详情页：分项评分并入右侧正文上方（左侧容器已移除） -->
      <RouterLink v-if="detailPanel && aspects.length" class="aspects" :class="{ collapsed: !expanded }" :to="reviewUrl">
        <ul>
          <li v-for="(a, i) in aspects" :key="i">
            <span class="an" :title="aspectLabel(a.aspect, lang.isEn)">{{ aspectLabel(a.aspect, lang.isEn) }}</span>
            <span class="as">{{ Math.round(Number(a.score)) }}</span>
          </li>
        </ul>
      </RouterLink>

    <div class="main">
      <div v-if="!gamePanel && !detailPanel" class="score" :title="lang.t('review.rating', { n: Number(review.rating).toFixed(1) })">
        {{ Number(review.rating).toFixed(1) }}
      </div>
      <div class="bodywrap">
        <div
          ref="bodyEl"
          class="body"
          :class="{
            collapsed: longContent && !expanded,
            opened: longContent && expanded,
            trunc: longContent && expanded && overflowed,
          }"
          v-html="html"
        ></div>
        <button
          v-if="!gamePanel && !detailPanel && longContent"
          type="button"
          class="expand"
          @click.stop="expanded = !expanded"
        >
          {{ expanded ? lang.t("review.collapse") : lang.t("review.viewFull") }}
        </button>
      </div>
    </div>

    <div class="meta">
      <!-- 评测库页：查看更多/收起 与 查看完整内容 驻左；时间、点赞、不认可靠右 -->
      <div v-if="(gamePanel || detailPanel) && longContent" class="cta">
        <button type="button" class="expand" @click.stop="expanded = !expanded">
          {{ expanded ? lang.t("review.collapse") : lang.t("review.viewFull") }}
        </button>
        <button v-if="expanded && overflowed" type="button" class="expand full" @click.stop="goReview">
          {{ lang.t("review.viewFullContent") }}
        </button>
      </div>
      <span class="time">{{ formatTime(review.publishedAt) }}</span>
      <div class="reactions">
        <button
          type="button"
          class="reaction"
          :class="{ active: local.myReaction === 'like' }"
          @click="react('like')"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 11h3l.5-5a2 2 0 0 1 4 0l-.7 3H18a2 2 0 0 1 2 2.2l-1 6A2 2 0 0 1 17 19H7M7 11v8M2 11v8h5v-8H2z" />
          </svg>
          {{ lang.t("review.like") }}
          <span class="cnt">{{ local.likeCount }}</span>
        </button>
        <button
          type="button"
          class="reaction down"
          :class="{ active: local.myReaction === 'dislike' }"
          @click="react('dislike')"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 13h-3l-.5 5a2 2 0 0 1-4 0l.7-3H6a2 2 0 0 1-2-2.2l1-6A2 2 0 0 1 7 5h10M17 13V5M22 13V5h-5v8h5z" />
          </svg>
          {{ lang.t("review.dislike") }}
          <span class="cnt">{{ local.dislikeCount }}</span>
        </button>
      </div>
    </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}
.card:hover {
  border-color: var(--primary);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  background: var(--surface-2);
}

/* 游戏库封面栏：横版封面缩略图 + 游戏名，整条可点击跳转游戏详情 */
.game {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  min-width: 0;
}
.gcover {
  flex-shrink: 0;
  width: 96px;
  height: 54px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--surface-2);
}
.gcover.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-weight: 700;
}
.gname {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.game:hover .gname {
  color: var(--primary);
}

/* —— 评测库页（gamePanel）左侧纵向游戏信息面板 —— */
.card.panel {
  flex-direction: row;
  align-items: stretch;
  gap: 18px;
}
.card.panel .right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.card.panel .left {
  flex-shrink: 0;
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-right: 1px solid var(--border);
  padding-right: 16px;
}
.lcoverlink {
  display: block;
  text-decoration: none;
}
.lcover {
  width: 100%;
  height: 140px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--surface-2);
  display: block;
  opacity: 0; /* 加载完毕后才淡入显示，与游戏库封面同款 */
  transition: opacity 0.5s ease;
}
.lcover.loaded {
  opacity: 1;
}
.lcover.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 20px;
  font-weight: 700;
}
.card.panel .gline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card.panel .gline {
  display: flex;
  align-items: center; /* 游戏名与分数的顶部/底部对齐 */
  gap: 8px;
  min-width: 0;
}
.card.panel .lname {
  min-width: 0;
  display: block;
  font-size: 20px; /* 放大：约为原来两倍的行高 */
  line-height: 1.5;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card.panel .lname:hover {
  color: var(--primary);
}
.card.panel .gscore {
  flex-shrink: 0;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  font-size: 20px;
  line-height: 1.5;
  border-radius: 6px;
  padding: 0 12px;
}
.card.panel .left .rank {
  align-self: flex-start;
}
/* 左侧分项评分，随正文折叠/展开 */
/* 左侧分项评分：无标题，直接显示分项 */
.card.panel .aspects {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
  text-decoration: none;
  color: inherit;
}
.aspects ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.aspects li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.aspects .an {
  min-width: 0;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aspects .as {
  flex-shrink: 0;
  color: var(--text);
  font-weight: 600;
}
.aspects.collapsed {
  flex: 1 1 auto; /* 折叠时吸收剩余高度，使底部与正文收缩位置一致 */
  min-height: 60px; /* 收缩高度减小（让出 10px 给正文） */
  max-height: 60px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(#000 0%, #000 calc(100% - 32px), transparent 100%);
  mask-image: linear-gradient(#000 0%, #000 calc(100% - 32px), transparent 100%);
}
/* 简述：评测库页靠右侧容器左边，可占整行避免过早截断；字号与用户名一致 */
.card.panel .brief {
  margin-left: 0;
  text-align: left;
  max-width: 100%;
  font-size: 18px; /* 与 .lusername 一致 */
  line-height: 1.5;
}
/* 左侧作者行：头像 + 用户名，可点击进入作者主页 */
.lauthor {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  min-width: 0;
}
.lauthor:hover .lusername {
  color: var(--primary);
}
.lavatar {
  flex-shrink: 0;
  width: 45px; /* 1.5x 放大 */
  height: 45px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface-2);
}
.lavatar.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-weight: 600;
  font-size: 18px;
}
.luserblock {
  display: flex;
  flex-direction: column; /* 用户名 + 小字垂直排列 */
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.lusername {
  min-width: 0;
  max-width: 100%;
  font-weight: 600;
  font-size: 18px; /* 1.5x 放大 */
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lcount {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* 评测库页：作者行已移到左侧；顶部保留简介行，固定行高保持卡片收缩时等高 */
.card.panel .top {
  min-height: 22px;
}
/* 评测库页：底部操作栏固定贴在卡片底部右下角；时间位于点赞左侧 */
.card.panel .meta {
  margin-top: auto;
}
.card.panel .meta .time {
  order: -1;
}

/* 顶部一行：排名 + 头像 + 用户名 …… 简述（右对齐） */
.top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.rank {
  flex-shrink: 0;
  min-width: 34px;
  padding: 2px 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-2);
}
.avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface-2);
}
.avatar.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-weight: 600;
}
.alink {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  min-width: 0;
}
.alink:hover .author {
  color: var(--primary);
}
.author {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brief {
  text-decoration: none;
  margin-left: auto; /* 靠右 */
  color: var(--text-2);
  font-size: 14px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}

/* 正文行：分数在左，正文在右 */
.main {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.score {
  flex-shrink: 0;
  width: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  border-radius: 8px;
  padding: 10px 0;
  font-size: 20px;
}
.bodywrap {
  flex: 1;
  min-width: 0;
}
.body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
}
.body.collapsed {
  min-height: 280px; /* 折叠时正文区等高（提高 10px，缩小与查看更多按钮的间距） */
  max-height: 280px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(#000 0%, #000 calc(100% - 56px), transparent 100%);
  mask-image: linear-gradient(#000 0%, #000 calc(100% - 56px), transparent 100%);
}
/* 游戏详情评测卡：正文收缩高度为列表版的一半 */
.card.detail .body.collapsed {
  min-height: 140px;
  max-height: 140px;
}
/* 展开后正文最高为折叠态的三倍（280 × 3），仅在正文确实超长时应用，避免误伤未超长/已完全展开的正文 */
.body.opened {
  max-height: 840px; /* 展开后上限为折叠态三倍；仅在正文确实达到上限时截断（见 .trunc） */
  overflow: hidden;
}
/* 展开态真正超长被截断时才显示底部渐变遮罩，避免误伤已完整展示的正文 */
.body.opened.trunc {
  -webkit-mask-image: linear-gradient(#000 0%, #000 calc(100% - 56px), transparent 100%);
  mask-image: linear-gradient(#000 0%, #000 calc(100% - 56px), transparent 100%);
}
.body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
.expand {
  margin-top: 6px;
  border: none;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 0;
}

/* 底部一行：查看更多（右容器左端）+ 时间 + 点赞/不认可（右端） */
.meta {
  display: flex;
  justify-content: flex-end; /* 默认右对齐，供非评测库页使用 */
  align-items: center;
  gap: 18px;
}
.card.panel .meta .cta {
  order: -2;
  display: flex;
  align-items: center;
  gap: 12px; /* 「收起」与「查看完整内容」之间的空隙增大一倍（原 6px） */
  margin-right: auto; /* 查看更多/查看完整分组贴右容器左端，把时间/点赞推到最右 */
}
.card.panel .expand {
  margin-top: 0; /* 一整行内无需上方间距 */
}
.cta .expand {
  margin-top: 0;
}
.expand.full {
  flex-shrink: 0;
}
.reactions {
  display: flex;
  gap: 8px;
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
.reaction.down.active {
  background: var(--danger-soft, var(--primary-soft));
  color: var(--danger, var(--primary));
  border-color: var(--danger, var(--primary));
}
.meta .time {
  order: 2; /* 非评测库页：时间保持在操作栏最右 */
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
}

/* —— 游戏详情页评测变体（detail）：以评测库面板布局为基础，去掉封面/游戏名，分数移到卡片右上角 —— */
.card.detail {
  position: relative; /* 供右上角分数角标定位 */
  flex-wrap: wrap; /* 顶部容器独占一行，左/右容器换行并列于其下 */
}
.card.panel .lfooter {
  margin-top: auto; /* 作者信息+游戏排位整体沉到左栏底部 */
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card.panel .lfooter .rank {
  align-self: flex-start;
}
.card.detail .aspects.collapsed {
  flex: none; /* 右栏中不撑满，按自身内容高度折叠 */
  min-height: 0; /* 去掉固定收缩高度，避免与正文之间产生空隙 */
  max-height: none;
  overflow: visible;
  -webkit-mask-image: none;
  mask-image: none;
}
/* 详情页分项评分：水平排列，各项以竖线分隔，项目名与分数相邻留一空格 */
.card.detail .aspects ul {
  flex-direction: row;
  flex-wrap: wrap; /* 超过卡片宽度后自动换行 */
  gap: 0;
}
.card.detail .aspects li {
  justify-content: flex-start;
  gap: 6px; /* 项目名与分数之间的空格间距 */
  padding: 0 12px;
  border-left: 1px solid var(--border);
}
.card.detail .aspects li:first-child {
  border-left: none;
  padding-left: 0;
}
.card.detail .aspects {
  margin-top: 0; /* 覆盖评测库规则的 2px 上边距，避免分项上方额外撑大 */
  min-width: 0; /* 窄屏时允许横向压缩，避免横向分项行撑破卡片 */
  padding-left: 5px; /* 分项评分整体距右栏左缘 5px */
}
.card.detail {
  row-gap: 0; /* 覆盖 .card.panel 的 gap:18 在换行后产生的行间距，消除紫线与下面的透明空隙 */
}
.card.detail .right {
  gap: 10px; /* 分项评分到正文、以及正文与操作栏之间的间距 */
  padding-top: 10px; /* 上间距改用 right 自身 padding，与 gap 同值，二者严格相等且空白归属容器 */
}
.card.detail .dbanner {
  flex: 1 1 100%; /* 独占整行，位于左/右容器上方 */
  min-width: 0; /* 允许整行随窄屏收缩，避免行内内容撑破卡片与整页 */
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  margin-bottom: 0; /* 上间距改由 .right 的 padding-top 提供，此处归零避免产生无色的透明间隙 */
  border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.18));
}
/* 详情页作者信息卡片缩小为原来的 70% */
.card.detail .dbanner .lauthor {
  gap: 6px;
}
.card.detail .dbanner .lavatar {
  width: 40px;
  height: 40px;
  font-size: 13px;
}
.card.detail .dbanner .lusername {
  font-size: 16px;
}
.card.detail .dbanner .lcount {
  font-size: 10px;
}
.card.detail .dbanner .rank {
  display: inline-flex;
  align-items: center;
  height: 40px; /* 与头像高度对齐 */
  font-size: 12px;
  padding: 0 8px;
  flex-shrink: 0;
}
.card.detail .brief {
  flex: 1 1 0; /* 简述吸收并让出空间、可收缩，保证右侧固定的分数不被顶出 */
  min-width: 0;
  max-width: 100%; /* 覆盖基础规则 45%，始终在内容卡片内 */
  white-space: nowrap; /* 单行，超出直接截断省略 */
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px; /* 该处简述缩小 4px（18→14） */
  color: var(--text-2);
  text-align: right;
}
.card.detail .dscore {
  display: inline-flex;
  align-items: center;
  min-height: 40px; /* 与头像高度对齐 */
  margin-left: auto; /* 分数始终靠右端 */
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  font-size: 18px;
  line-height: 1.4;
  border-radius: 6px;
  padding: 0 10px;
  margin-right: 10px;
  flex-shrink: 0;
}
</style>