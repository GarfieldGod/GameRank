<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { deleteGame, fetchGame, proposeEditGame } from "@/api/game";
import { extractError } from "@/api/request";
import ReviewCard from "@/components/ReviewCard.vue";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const router = useRouter();
const lang = useLangStore();
const auth = useAuthStore();
const theme = useThemeStore();

const game = ref(null);
const reviews = ref([]);
const total = ref(0);
const countedReviews = ref(0);
const myReview = ref(null);
const loading = ref(true);
const notFound = ref(false);
const query = reactive({ page: 1 });
const pageSize = 5;

// 其余评测（不含我的评测）的分页页数
const remainingTotal = computed(() => Math.max(0, total.value - (myReview.value ? 1 : 0)));
const otherTotalPages = () => Math.max(1, Math.ceil(remainingTotal.value / pageSize) || 1);

// 写评测/编辑：我的评测已存在则进入编辑，否则新建并预填该游戏
function openReviewEditor() {
  if (!game.value) return;
  if (myReview.value) {
    router.push(`/reviews/${myReview.value.id}/edit`);
  } else {
    router.push({ path: "/reviews/new", query: { game: lang.gname(game.value) } });
  }
}

// 主名按页面语言取（中文页用中文名，英文页用英文名）
const primaryName = computed(() => lang.gname(game.value));
// 副名：中文页在下方展示另一种语言的英文名；英文页不显示中文名（避免布局上移动，保留占位）
const secondaryName = computed(() => {
  if (!game.value || lang.isEn) return "";
  return game.value.nameEn || "";
});

// 管理员可编辑/删除游戏
const canManage = computed(() => auth.isLoggedIn && auth.isAdmin);
// 普通用户可申请编辑（管理员直接用编辑，无需申请）
const canProposeEdit = computed(
  () => auth.isLoggedIn && !auth.isAdmin && game.value?.status === "APPROVED" && !myPendingEdit.value
);
const deleting = ref(false);
const deleteFailed = ref("");
// 我的编辑申请状态
const myPendingEdit = ref(false);
// 申请编辑表单
const propOpen = ref(false);
const propSubmitted = ref(false);
const propSaving = ref(false);
const propError = ref("");
const editForm = reactive({ nameZh: "", nameEn: "", developer: "", publisher: "", description: "", tagsText: "", reason: "" });

function openProposal() {
  if (!game.value) return;
  editForm.nameZh = game.value.nameZh || "";
  editForm.nameEn = game.value.nameEn || "";
  editForm.developer = game.value.developer || "";
  editForm.publisher = game.value.publisher || "";
  editForm.description = game.value.description || "";
  editForm.tagsText = Array.isArray(game.value.tags) ? game.value.tags.join(", ") : "";
  editForm.reason = "";
  propError.value = "";
  propSubmitted.value = false;
  propOpen.value = true;
}

async function submitProposal() {
  propError.value = "";
  if (!editForm.nameZh.trim()) {
    propError.value = lang.t("game.new.nameRequired");
    return;
  }
  propSaving.value = true;
  try {
    await proposeEditGame(game.value.id, {
      nameZh: editForm.nameZh.trim(),
      nameEn: editForm.nameEn.trim(),
      developer: editForm.developer.trim(),
      publisher: editForm.publisher.trim(),
      description: editForm.description.trim(),
      tags: editForm.tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      reason: editForm.reason.trim() || undefined,
    });
    myPendingEdit.value = true;
    propOpen.value = false;
    propSubmitted.value = true;
  } catch (err) {
    propError.value = extractError(err, lang.t("game.detail.editProposalFailed"));
  } finally {
    propSaving.value = false;
  }
}

async function onDelete() {
  if (deleting.value || !game.value) return;
  if (!window.confirm(lang.t("game.detail.deleteConfirm", { name: lang.gname(game.value) }))) return;
  deleting.value = true;
  deleteFailed.value = "";
  try {
    await deleteGame(game.value.id);
    router.push("/games");
  } catch {
    deleteFailed.value = lang.t("game.detail.deleteFailed");
  } finally {
    deleting.value = false;
  }
}

async function load() {
  loading.value = true;
  notFound.value = false;
  game.value = null;
  reviews.value = [];
  propOpen.value = false;
  propSubmitted.value = false;
  myPendingEdit.value = false;
  coverLoaded.value = false;
  heroLoaded.value = false;
  try {
    const data = await fetchGame(route.params.id, {
      page: query.page,
      pageSize,
    });
    game.value = data.game;
    reviews.value = data.reviews;
    total.value = data.total;
    countedReviews.value = data.countedReviews || 0;
    myReview.value = data.myReview || null;
    myPendingEdit.value = Boolean(data.myPendingEdit);
  } catch {
    notFound.value = true;
  } finally {
    loading.value = false;
  }
}

function goPage(p) {
  query.page = p;
  load();
}

function cover(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const fill = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  const text = lang.isEn ? "No cover" : "暂无封面";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="${fg}" font-size="28" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`
  );
}

// —— 背景与卡片完全解耦 ——
// 背景条绝对定位（不占文档流），左/右出血铺满整屏、位于卡片后台；
// 卡片作为首个文档流元素自然顶到容器顶部。背景加载/缩放不会推动或拉动卡片，
// 二者互不干扰，卡片位置始终稳定
const coverLoaded = ref(false);
const heroLoaded = ref(false);
function onCoverLoad() {
  coverLoaded.value = true;
}
function onHeroLoad() {
  heroLoaded.value = true;
}

onMounted(() => {
  load();
});
// 路由参数变化时重新加载
watch(() => route.params.id, load);
</script>

<template>
  <div
    class="game-page"
    :class="{ 'flush-nav': !!game?.heroImageUrl }"
  >
    <p v-if="loading">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound">{{ lang.t("game.detail.notFound") }}</p>

    <template v-else-if="game">
      <!-- 顶部 Hero 背景条：绝对定位、左/右出血铺满整屏，位于卡片后台；
           高度随图片自然比例自适应，不参与文档流、不影响卡片定位 -->
      <div v-if="game.heroImageUrl" class="hero-bg">
        <img
          class="hero-bg-img"
          :class="{ loaded: heroLoaded }"
          :src="game.heroImageUrl"
          :alt="lang.gname(game)"
          @load="onHeroLoad"
        />
      </div>
      <div class="hero">
        <img
          class="cover"
          :class="{ loaded: coverLoaded }"
          :src="cover(game.coverImageUrl)"
          :alt="lang.gname(game)"
          @load="onCoverLoad"
        />
        <div class="info">
          <div class="info-title">
            <h1>{{ primaryName }}</h1>
            <div class="title-alt" :class="{ hidden: !secondaryName }">{{ secondaryName }}</div>
          </div>

          <p class="intro-title">{{ lang.t("game.detail.desc") }}</p>
          <p class="desc">{{ game.description || "—" }}</p>

          <div class="info-footer">
            <div class="facts">
              <div class="fact">
                <span class="fact-label">{{ lang.t("game.detail.developer") }}</span>
                <span class="fact-value">{{ game.developer || lang.t("game.detail.unknown") }}</span>
              </div>
              <div class="fact">
                <span class="fact-label">{{ lang.t("game.detail.publisher") }}</span>
                <span class="fact-value">{{ game.publisher || lang.t("game.detail.unknown") }}</span>
              </div>
            </div>

            <div class="info-bottom">
              <div v-if="canManage" class="admin-bar">
                <RouterLink class="btn-edit" :to="`/games/${game.id}/edit`">{{ lang.t("game.detail.edit") }}</RouterLink>
                <button class="btn-delete" :disabled="deleting" @click="onDelete">{{ lang.t("game.detail.delete") }}</button>
                <span v-if="deleteFailed" class="err">{{ deleteFailed }}</span>
              </div>
              <div v-else-if="canProposeEdit" class="prop-actions">
                <button class="prop-btn" @click="openProposal">{{ lang.t("game.detail.proposeEdit") }}</button>
              </div>
              <p v-else-if="auth.isLoggedIn && !auth.isAdmin && myPendingEdit" class="edit-pending">
                {{ lang.t("game.detail.editPendingHint") }}
              </p>
              <p v-if="propSubmitted" class="edit-ok">{{ lang.t("game.detail.editProposalSubmitted") }}</p>
            </div>
          </div>

          <div class="score-pill">
            <template v-if="game.score != null">
              <span class="sc-num">{{ game.score.toFixed(1) }}</span>
            </template>
            <span v-else class="sc-na">{{ lang.t("game.detail.noScore") }}</span>
          </div>
          <div v-if="game.score != null" class="counted-reviews">
            {{ lang.t("game.detail.countedReviews", { n: countedReviews }) }}
          </div>
        </div>
      </div>

      <!-- 标签放在游戏信息模块下方，横向排列 -->
      <div v-if="game.tags && game.tags.length" class="tags-row">
        <span v-for="t in game.tags" :key="t" class="tag">{{ lang.tag(t) }}</span>
      </div>

      <section v-if="propOpen && game" class="prop-form">
        <h2>{{ lang.t("game.detail.editProposalTitle") }}</h2>
        <p class="prop-hint">{{ lang.t("game.detail.editProposalHint") }}</p>
        <div class="pf-grid">
          <label>{{ lang.t("game.new.nameZh") }} <span class="req">*</span>
            <input v-model="editForm.nameZh" />
          </label>
          <label>{{ lang.t("game.new.nameEn") }}
            <input v-model="editForm.nameEn" />
          </label>
        </div>
        <div class="pf-grid">
          <label>{{ lang.t("game.new.developer") }}
            <input v-model="editForm.developer" />
          </label>
          <label>{{ lang.t("game.new.publisher") }}
            <input v-model="editForm.publisher" />
          </label>
        </div>
        <label>{{ lang.t("game.new.tags") }}
          <input v-model="editForm.tagsText" />
        </label>
        <label>{{ lang.t("game.new.desc") }}
          <textarea v-model="editForm.description" rows="4"></textarea>
        </label>
        <label>{{ lang.t("game.detail.proposeEditReason") }}
          <textarea v-model="editForm.reason" rows="2" :placeholder="lang.t('game.detail.proposeEditReasonPh')"></textarea>
        </label>
        <p v-if="propError" class="err">{{ propError }}</p>
        <div class="pf-actions">
          <button class="pf-submit" :disabled="propSaving" @click="submitProposal">
            {{ propSaving ? lang.t("common.saving") : lang.t("game.detail.submitProposal") }}
          </button>
          <button class="pf-cancel" @click="propOpen = false">{{ lang.t("game.detail.cancelEditProposal") }}</button>
        </div>
      </section>

      <section class="reviews-section">
        <div class="reviews-head">
          <h2>{{ lang.t("game.detail.reviews", { n: total }) }}</h2>
          <button type="button" class="write-review-btn" @click="openReviewEditor">
            {{ myReview ? lang.t("game.detail.edit") : lang.t("game.detail.writeReview") }}
          </button>
        </div>

        <!-- 我的评测：置顶展示 -->
        <template v-if="myReview">
          <div class="block-title">{{ lang.t("game.detail.myReviews") }}</div>
          <div class="cards single">
            <ReviewCard :key="'my-' + myReview.id" :review="myReview" detail-panel />
          </div>
          <div v-if="reviews.length" class="block-title divider">{{ lang.t("game.detail.otherReviews") }}</div>
        </template>

        <p v-if="!myReview && reviews.length === 0" class="hint">{{ lang.t("game.detail.noReviews") }}</p>
        <p v-else-if="myReview && reviews.length === 0" class="hint">{{ lang.t("game.detail.noReviews") }}</p>
        <div v-if="reviews.length" class="cards other">
          <ReviewCard v-for="r in reviews" :key="r.id" :review="r" detail-panel />
        </div>

        <div v-if="otherTotalPages() > 1" class="pager">
          <button :disabled="query.page <= 1" @click="goPage(query.page - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ query.page }} / {{ otherTotalPages() }}</span>
          <button :disabled="query.page >= otherTotalPages()" @click="goPage(query.page + 1)">{{ lang.t("common.next") }}</button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.game-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 40px;
  position: relative;
}

/* 仅在有 Hero 背景图时，把容器上移抵消外层 .page 顶部 padding。
   背景条为绝对定位(顶部贴导航)，不随容器下移；但普通流内容需保留 24px 顶部空隙，
   与返回按钮(top:80px = 导航56 + 24)对齐 */
.game-page.flush-nav {
  margin-top: -24px;
  padding-top: 24px;
}

/* 顶部 Hero 背景条：绝对定位、左/右出血铺满整屏、位于卡片后台。
   不参与文档流，因此背景加载/缩放不会推动卡片，卡片位置始终稳定 */
.hero-bg {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100vw;
  line-height: 0;
  pointer-events: none;
  z-index: 0;
}

.hero-bg-img {
  display: block;
  width: 100%; /* 宽度始终等于网页宽度 */
  height: auto; /* 高度按图片自身比例，随高度自适应 */
  /* 图片底部渐隐：不把页面底色烤进渐变（渐变不可被主题过渡插值），
     而是让图片下沿淡出、露出 body 自身会 0.2s 过渡的 --bg，主题切换即天然同步 */
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 260px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 260px), transparent 100%);
  opacity: 0; /* 加载完成后淡入，避免突然显示 */
  transition: opacity 0.6s ease;
}
.hero-bg-img.loaded {
  opacity: 1;
}

.hero {
  position: relative;
  z-index: 1;
  margin-top: 0;
  display: flex;
  align-items: stretch; /* 左右两列底部对齐 */
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  flex-wrap: wrap;
}

.cover {
  width: 240px;
  max-width: 100%;
  border-radius: 10px;
  object-fit: cover;
  /* 一开始就按 6:9 预留高度：图片加载前卡片即占位到该高度，加载完成后高度不变，避免突变 */
  aspect-ratio: 6 / 9;
  align-self: stretch; /* 信息内容更高时仍拉伸对齐，与 info 等高保证底部对齐 */
  background: var(--surface-2);
  opacity: 0; /* 加载完成前不显示占位灰块，加载后淡入 */
  transition: opacity 0.5s ease;
}
.cover.loaded {
  opacity: 1;
}

.info {
  flex: 1;
  min-width: 220px;
  position: relative; /* score-pill 锚点 */
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 66px; /* 统一标题区高度，避免不同名称导致 UI 高度不一 */
  padding-right: 210px; /* 为右上角分数框预留，避免标题与其重叠 */
}

.info-title h1 {
  margin: 0;
  font-size: 44px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.title-alt {
  font-size: 20px;
  color: var(--text-3); /* 比主名更浅的效果 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 英文页不显示中文名时，保留副名占位高度，避免下方内容上移 */
.title-alt.hidden {
  visibility: hidden;
}

/* 分数：放大版彩色方框（宽x2、高x4），位于游戏信息右上角 */
.score-pill {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 176px;
  height: 120px;
  background: var(--score-bg);
  color: var(--score-text);
  border-radius: 14px;
}

.score-pill .sc-num {
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
}

.score-pill .sc-na {
  font-size: 24px;
  font-weight: 600;
}

/* 计入评测数：位于分数框正下方 */
.counted-reviews {
  position: absolute;
  top: 128px; /* 分数框(120px)下方 */
  right: 0;
  width: 176px;
  text-align: center;
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
}

/* 卡片内简介的小标题：与上方的名字距离翻倍（由 info 基础间距 10px 之上再叠加 10px） */
.intro-title {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  padding-right: 210px; /* 避开右上角分数框 */
}

/* 简介：固定最小/最大行高，超出 4 行截断，保证不同游戏 UI 一致 */
.desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: var(--text-1);
  min-height: 76px; /* ≈3 行 */
  padding-right: 210px; /* 避开右上角分数框 */
  display: -webkit-box;
  -webkit-line-clamp: 4; /* 最多 4 行，超出截断 */
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 底部行：包含制作/发行公司与右下角操作按钮，整体顶到卡片底部，
   从而与左侧 cover 图片的底部对齐 */
.info-footer {
  margin-top: auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* 制作公司、发行公司：水平排列 */
.facts {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.fact {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 15px;
}

.fact-label {
  color: var(--text-2);
  white-space: nowrap;
}

.fact-value {
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 26ch;
}

/* 右下角操作按钮：作为 info-footer 的右侧项，和制作/发行公司处于同一底部行 */
.info-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 标签行：位于游戏信息模块下方，横向排列。
   去除卡片视觉（透明背景、无边框），并用负外边距抵消上下 24px 间隙，
   使标签行与上方信息卡、下方评测卡之间的间距为 0px */
.tags-row {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  background: transparent;
  border: none;
  margin: -24px 0; /* 抵消 game-page 的 24px 间隙，实现 0px */
}

.tag {
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
}

.admin-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.prop-actions {
  display: flex;
  gap: 10px;
}
.prop-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.prop-btn:hover {
  background: var(--primary);
  color: #fff;
}
.edit-pending {
  color: var(--warn-text);
  font-size: 14px;
  margin: 0;
}
.edit-ok {
  color: var(--success);
  font-size: 14px;
  margin: 0;
}

/* 申请编辑表单 */
.prop-form {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.prop-form h2 {
  margin: 0;
  font-size: 18px;
}
.prop-hint {
  color: var(--text-2);
  font-size: 14px;
  margin: 0;
}
.prop-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--text-1);
  flex: 1;
}
.prop-form .req {
  color: var(--danger);
}
.prop-form input,
.prop-form textarea {
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text-1);
  resize: vertical;
}
.pf-grid {
  display: flex;
  gap: 12px;
}
.pf-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pf-submit {
  padding: 10px 22px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.pf-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.pf-cancel {
  padding: 10px 18px;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-edit,
.btn-delete {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-1);
}

.btn-edit:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.btn-delete {
  color: var(--danger);
  border-color: var(--danger);
}

.btn-delete:hover {
  background: var(--danger-bg);
}

.btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.err {
  color: var(--danger);
  font-size: 14px;
}

section h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

/* 评测区：提升层级 + 不透明表面背景，避免被上方 hero 背景条盖住标题或透出背景 */
.reviews-section {
  position: relative;
  z-index: 1;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

/* 评测区头部：标题左侧，写评测按钮右上角 */
.reviews-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.reviews-head h2 {
  margin: 0;
}

.write-review-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.write-review-btn:hover {
  background: var(--primary-hover);
}

.block-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
  margin: 0 0 12px;
}
.block-title.divider {
  margin-top: 22px;
}

/* 我的评测与其余评测都占满整行，逐篇纵向排布展示详细内容 */
.cards.single {
  grid-template-columns: 1fr;
}
.cards.other {
  grid-template-columns: 1fr;
}

.desc p {
  color: var(--text-1);
  line-height: 1.7;
  margin: 0;
}

.hint {
  color: var(--text-2);
  text-align: center;
  padding: 30px 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.pager button {
  padding: 6px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
  color: var(--text-1);
}

.pager button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>