<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter, RouterLink } from "vue-router";
import { deleteGame, fetchGame } from "@/api/game";
import { fetchProposal } from "@/api/proposal";
import { fetchDeletedGame } from "@/api/admin";
import ReviewCard from "@/components/ReviewCard.vue";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";
import { markGamesDirty, consumeGameDetailDirty, consumeReviewsDirty } from "@/utils/dirtySignal";
import { consumeFromBack } from "@/utils/backSignal";

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
const pageSize = 5;
const page = ref(1); // 已加载到的页号
const loadingMore = ref(false); // 无限滚动加载中

// 其余评测（不含我的评测）可滚动的总条数
const remainingTotal = computed(() => Math.max(0, total.value - (myReview.value ? 1 : 0)));
// 尚未全部加载时继续触发触底追加
const hasMore = computed(() => reviews.value.length < remainingTotal.value);

// 写评测/编辑：我的评测已存在则进入编辑，否则新建并预填该游戏
function openReviewEditor() {
  if (!game.value) return;
  if (myReview.value) {
    router.push(`/reviews/${myReview.value.id}/edit`);
  } else {
    router.push({ path: "/reviews/new", query: { game: lang.gname(game.value) } });
  }
}

// 主名按页面语言取（中文页用中文名，英文页用英文名）；预览模式展示“修改后”的名称
const primaryName = computed(() => lang.gname(displayGame.value));
// 副名：中文页在下方展示另一种语言的英文名；英文页不显示中文名（避免布局上移动，保留占位）
const secondaryName = computed(() => {
  if (!displayGame.value || lang.isEn) return "";
  return displayGame.value.nameEn || "";
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
// 申请编辑：与管理员共用同一编辑页（/games/:id/edit），保存时由该页按角色走「待审核申请」
function goEditApply() {
  if (!game.value) return;
  router.push(`/games/${game.value.id}/edit`);
}

async function onDelete() {
  if (deleting.value || !game.value) return;
  // 纯管理员（非站长）删除游戏 = 软删除，须填写删除原因（站长可在管理页查看到原因）
  let reason = null;
  if (auth.isAdmin && !auth.isOwner) {
    reason = window.prompt(lang.t("game.detail.deleteReasonPrompt"), "");
    if (reason == null || !String(reason).trim()) return;
    reason = String(reason).trim();
  }
  if (!window.confirm(lang.t("game.detail.deleteConfirm", { name: lang.gname(game.value) }))) return;
  deleting.value = true;
  deleteFailed.value = "";
  try {
    await deleteGame(game.value.id, reason);
    markGamesDirty();
    router.push("/games");
  } catch {
    deleteFailed.value = lang.t("game.detail.deleteFailed");
  } finally {
    deleting.value = false;
  }
}

let loadedId = null; // 当前已加载并展示的游戏 id：用于区分「返回缓存详情」与「切换到另一游戏」

async function load(opts = {}) {
  const id = Number(route.params.id);
  // 守卫：KeepAlive 激活缓存的详情组件时，路由参数可能尚未就绪而短暂为 undefined。
  // 此时直接返回、不发请求，避免发出 /api/games/undefined 这类无效请求；
  // 待参数就绪后由 watch(() => route.params.id, load) 再次触发。
  if (!Number.isInteger(id) || id <= 0) return;
  // 软删除预览：公开接口不返回已删除游戏，展示数据由 loadPreview 拉取；
  // 先进入加载态，让骨架屏正常展示（与普通详情页一致）
  if (route.query.preview === "deleted") {
    loading.value = true;
    return;
  }
  const silent = !!opts.silent;
  // 静默刷新（返回缓存详情/数据标记变更）时不重置 loading、不清空现有内容，
  // 避免"加载中"闪烁与 DOM 高度骤变导致滚动位置失效。
  if (!silent) {
    loading.value = true;
    notFound.value = false;
    game.value = null;
    reviews.value = [];
    myPendingEdit.value = false;
    coverLoaded.value = false;
    heroLoaded.value = false;
  }
  try {
    const data = await fetchGame(id, { page: 1, pageSize });
    loadedId = id;
    game.value = data.game;
    total.value = data.total;
    countedReviews.value = data.countedReviews || 0;
    myReview.value = data.myReview || null;
    myPendingEdit.value = Boolean(data.myPendingEdit);
    if (silent) {
      // 静默刷新：保留已滚动的分页与游标，仅合并最新第1页（去重），
      // 避免把已加载的评测列表截断回第1页，也不让游标重置导致重复触底加载
      const have = new Set(reviews.value.map((r) => r.id));
      const fresh = (data.reviews || []).filter((r) => !have.has(r.id));
      reviews.value = [...fresh, ...reviews.value];
    } else {
      page.value = 1;
      reviews.value = data.reviews;
    }
  } catch (err) {
    if (err?.response?.status === 404 || err?.status === 404) {
      router.replace({ name: "not-found" });
    } else {
      notFound.value = true;
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

// 无限滚动：滚动到底部时再加载一页（每页 5 个），追加上去
async function loadMore() {
  if (loadingMore.value || !hasMore.value || loading.value || loadedId == null) return;
  loadingMore.value = true;
  try {
    const data = await fetchGame(loadedId, { page: page.value + 1, pageSize });
    page.value += 1;
    if (data.reviews && data.reviews.length) {
      reviews.value = reviews.value.concat(data.reviews);
    }
  } catch {
    // 触底加载失败不抛错，允许滚动再次触发时重试
  } finally {
    loadingMore.value = false;
  }
}

/* —— 待审核编辑申请预览 ——
   路由带 ?preview=<proposalId> 时进入预览模式：把申请快照（data）覆盖到当前游戏上，
   展示“修改后的详情”，并用四处“已修改”角标标识被改动的字段/位置。
   审批通过时不会改动由评测生成的 score，故预览也不改分数，保持原值。 */
const preview = ref(null); // { id, proposer, data, mode: "proposal" | "deleted" }
// 软删除游戏预览：非弹窗，直接进入游戏详情页展示删除前快照
const previewDeleted = computed(() => preview.value?.mode === "deleted");
function previewProposalId() {
  const v = route.query.preview;
  return v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
}
async function loadPreview() {
  // 软删除预览：从管理接口拉取单条已删除游戏，覆盖为当前展示对象
  if (route.query.preview === "deleted") {
    const id = Number(route.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      preview.value = null;
      notFound.value = true;
      loading.value = false;
      return;
    }
    try {
      const g = await fetchDeletedGame(id);
      preview.value = { mode: "deleted", proposer: g.deletedBy ? displayName(g.deletedBy) : "", data: g };
      game.value = g;
      notFound.value = false;
    } catch {
      preview.value = null;
      notFound.value = true;
    } finally {
      loading.value = false;
    }
    return;
  }
  const id = previewProposalId();
  if (!id) { preview.value = null; return; }
  try {
    const p = await fetchProposal(id);
    preview.value = {
      mode: "proposal",
      id: p.id,
      proposer: p.proposer ? displayName(p.proposer) : "",
      data: p.data || {},
    };
  } catch {
    preview.value = null;
  }
}
// 仅预览模式可用：将申请数据合并到当前游戏，得到“修改后”的展示对象
const previewGame = computed(() => {
  if (!preview.value || !game.value) return null;
  const d = preview.value.data;
  const base = game.value;
  const merged = { ...base };
  for (const k of ["nameZh", "nameEn", "developer", "publisher", "description", "coverImageUrl", "heroImageUrl", "logoImageUrl"]) {
    if (d[k] !== undefined) merged[k] = d[k];
  }
  if (Array.isArray(d.tags)) merged.tags = d.tags.slice();
  return merged;
});
// 有预览时优先展示“修改后”对象
const displayGame = computed(() => previewGame.value || game.value);
const previewing = computed(() => Boolean(preview.value));
// 与当前游戏对比，标记哪些字段被改变（用于“已修改”角标）
const previewChanged = computed(() => {
  if (!preview.value || !game.value) return null;
  const d = preview.value.data;
  const g = game.value;
  const norm = (a, b) => ((a ?? "").trim() !== (b ?? "").trim());
  return {
    name: norm(d.nameZh, g.nameZh),
    nameEn: norm(d.nameEn, g.nameEn),
    description: norm(d.description, g.description),
    developer: norm(d.developer, g.developer),
    publisher: norm(d.publisher, g.publisher),
    cover: norm(d.coverImageUrl, g.coverImageUrl),
    hero: norm(d.heroImageUrl, g.heroImageUrl),
    tags: Array.isArray(d.tags)
      && (d.tags.slice().sort().join("\u0000") !== (g.tags || []).slice().sort().join("\u0000")),
  };
});
function exitPreview() {
  // 已删除游戏无公开详情页，返回来源页（通常是从管理页跳转而来）
  if (previewDeleted.value) {
    router.back();
  } else {
    router.replace(`/game/${game.value?.id}`);
  }
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

// —— 详情页被 KeepAlive 缓存期间保存/恢复滚动位置 ——
// 与列表页一致：离开时（onBeforeRouteLeave）读真实 scrollY 存下，
// 返回时通过返回按钮则恢复原位，经导航栏/普通跳转进入则置顶。
// 数据变更标记（发布/编辑/删除评测或更新游戏封面）存在时先刷新再恢复滚动。
const savedScroll = ref(0);
onBeforeRouteLeave(() => {
  savedScroll.value = window.scrollY || 0;
});

onMounted(() => {
  load();
  loadPreview();
});

// 触底无限滚动：观察评测区底部哨兵，进入视口即加载下一批
const loadMoreRef = ref(null);
let loadMoreObserver = null;
function initLoadMoreObserver() {
  if (loadMoreObserver) return;
  const el = loadMoreRef.value;
  if (!el) return;
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) loadMore();
  });
  loadMoreObserver.observe(el);
}
watch(hasMore, (more) => {
  if (more) {
    // 评测追加使页面变长后，哨兵随之下移；重新扫描确保观察到位
    nextTick(initLoadMoreObserver);
  }
});
onBeforeUnmount(() => {
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }
});
// 路由参数变化时：真正切换到另一游戏则正常加载；返回该缓存详情（id 未变）则静默刷新，
// 避免清空内容导致"加载中"闪烁与滚动位置失效。
watch(() => route.params.id, (val) => {
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) return;
  load({ silent: n === loadedId });
});
// 预览入口变化（进入/切换/退出编辑申请预览）：重新加载待审快照
watch(() => route.query.preview, () => {
  loadPreview();
});
// 有概率因异步图片/内容尚未撑起页面高度导致恢复被钳制回顶部（随加载速度浮动），
// 故在 RAF 循环里等待可滚高度足以到达目标位置（或超时兜底）后再恢复。
function restoreScroll(target) {
  const deadline = Date.now() + 2000;
  const go = () => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (max >= target || Date.now() > deadline) {
      window.scrollTo(0, Math.min(target, max));
    } else {
      requestAnimationFrame(go);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
}

onActivated(async () => {
  // 返回/激活时若该游戏被编辑过（标记 id 匹配当前）或评测有变更，则静默刷新自我
  // （不清空内容、不闪"加载中"）。games 脏标记留给游戏库，不在详情页消费。
  const detailDirty = consumeGameDetailDirty();
  if ((detailDirty != null && detailDirty === game.value?.id) || consumeReviewsDirty()) {
    await load({ silent: true });
  }
  await nextTick();
  if (consumeFromBack()) {
    restoreScroll(savedScroll.value);
  } else {
    window.scrollTo(0, 0);
  }
});
</script>

<template>
  <div
    class="game-page"
    :class="{ 'flush-nav': !!game?.heroImageUrl, 'content-fade': !loading && !notFound }"
  >
    <template v-if="loading">
      <!-- 真实容器空态占位：复用 .hero/.info 容器与真实尺寸（封面 6:9 固定比例），
           容器高度加载前后一致，配合内容淡入避免加载完成时跳变 -->
      <div class="hero">
        <div class="sk" style="width: 240px; max-width: 100%; aspect-ratio: 6 / 9; align-self: stretch; flex: 0 0 auto; border-radius: 10px"></div>
        <div class="info">
          <div class="sk sk-h26 sk-w70" style="margin: 4px 0 2px"></div>
          <div class="sk sk-h10 sk-w40" style="margin: 8px 0 20px"></div>
          <div class="sk sk-text sk-w95"></div>
          <div class="sk sk-text sk-w88"></div>
          <div class="sk sk-text sk-w80"></div>
          <div style="display: flex; gap: 28px; margin: 16px 0">
            <div class="sk sk-h10" style="width: 30%"></div>
            <div class="sk sk-h10" style="width: 26%"></div>
          </div>
          <div class="sk sk-h16" style="width: 42%"></div>
          <div class="sk sk-h12" style="width: 30%; margin-top: 10px"></div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin: 18px 2px 24px">
        <div class="sk sk-h18" style="width: 68px"></div>
        <div class="sk sk-h18" style="width: 92px"></div>
        <div class="sk sk-h18" style="width: 74px"></div>
      </div>
      <div class="sk sk-card" style="margin-bottom: 16px"></div>
      <div class="sk sk-card" style="margin-bottom: 16px"></div>
    </template>
    <p v-else-if="notFound">{{ lang.t("game.detail.notFound") }}</p>

    <template v-else-if="game">
      <!-- 预览横幅：编辑申请 / 软删除游戏预览 -->
      <div v-if="previewing" class="preview-banner" :class="{ deleted: previewDeleted }">
        <span class="preview-tag">{{ previewDeleted ? lang.t("admin.deletedPreviewTag") : lang.t("admin.changed") }}</span>
        <span class="preview-text">
          <template v-if="previewDeleted">
            {{ lang.t("admin.deletedGameBanner", { name: preview.proposer || "" }) }}
            <em v-if="preview.data.deleteReason" class="preview-reason">{{ lang.t("admin.deletedReason", { reason: preview.data.deleteReason }) }}</em>
          </template>
          <template v-else>{{ lang.t("admin.previewBy", { name: preview.proposer || "" }) }}</template>
        </span>
        <button class="preview-exit" @click="exitPreview">{{ previewDeleted ? lang.t("admin.backToAdmin") : lang.t("admin.exitPreview") }}</button>
      </div>

      <!-- 顶部 Hero 背景条：绝对定位、左/右出血铺满整屏，位于卡片后台；
           高度随图片自然比例自适应，不参与文档流、不影响卡片定位 -->
      <div v-if="displayGame.heroImageUrl" class="hero-bg">
        <SmartImg
          class="hero-bg-img"
          :class="{ loaded: heroLoaded }"
          :src="displayGame.heroImageUrl"
          :alt="lang.gname(displayGame)"
          @load="onHeroLoad"
        />
        <span v-if="previewing && previewChanged?.hero" class="diff-badge badge-hero">{{ lang.t("admin.changed") }}</span>
      </div>
      <div class="hero">
        <SmartImg
          class="cover"
          :class="{ loaded: coverLoaded }"
          :src="cover(displayGame.coverImageUrl)"
          :alt="lang.gname(displayGame)"
          @load="onCoverLoad"
        />
        <span v-if="previewing && previewChanged?.cover" class="diff-badge badge-cover">{{ lang.t("admin.changed") }}</span>
        <div class="info">
          <div class="info-title">
            <div class="title-line">
              <h1>{{ primaryName }}</h1>
              <span v-if="previewChanged?.name || previewChanged?.nameEn" class="diff-badge">{{ lang.t("admin.changed") }}</span>
            </div>
            <div class="title-alt" :class="{ hidden: !secondaryName }">{{ secondaryName }}</div>
          </div>

          <p class="intro-title">
            {{ lang.t("game.detail.desc") }}
            <span v-if="previewing && previewChanged?.description" class="diff-badge">{{ lang.t("admin.changed") }}</span>
          </p>
          <p class="desc">{{ displayGame.description || "—" }}</p>

          <div class="info-footer">
            <div class="facts">
              <div class="fact">
                <span class="fact-label">{{ lang.t("game.detail.developer") }}</span>
                <span class="fact-value">{{ displayGame.developer || lang.t("game.detail.unknown") }}</span>
                <span v-if="previewing && previewChanged?.developer" class="diff-badge">{{ lang.t("admin.changed") }}</span>
              </div>
              <div class="fact">
                <span class="fact-label">{{ lang.t("game.detail.publisher") }}</span>
                <span class="fact-value">{{ displayGame.publisher || lang.t("game.detail.unknown") }}</span>
                <span v-if="previewing && previewChanged?.publisher" class="diff-badge">{{ lang.t("admin.changed") }}</span>
              </div>
            </div>

            <div class="info-bottom">
              <template v-if="!previewing">
                <div v-if="canManage" class="admin-bar">
                  <RouterLink class="btn-edit" :to="`/games/${game.id}/edit`">{{ lang.t("game.detail.edit") }}</RouterLink>
                  <button class="btn-delete" :disabled="deleting" @click="onDelete">{{ lang.t("game.detail.delete") }}</button>
                  <span v-if="deleteFailed" class="err">{{ deleteFailed }}</span>
                </div>
                <div v-else-if="canProposeEdit" class="prop-actions">
                  <button class="prop-btn" @click="goEditApply">{{ lang.t("game.detail.proposeEdit") }}</button>
                </div>
                <p v-else-if="auth.isLoggedIn && !auth.isAdmin && myPendingEdit" class="edit-pending">
                  {{ lang.t("game.detail.editPendingHint") }}
                </p>
              </template>
            </div>
          </div>

          <div class="score-pill">
            <template v-if="game.score != null">
              <span class="sc-num">{{ game.score.toFixed(1) }}</span>
            </template>
            <span v-else class="sc-na">{{ lang.t("game.detail.noScore") }}</span>
          </div>
          <div v-if="!previewDeleted && game.score != null" class="counted-reviews">
            {{ lang.t("game.detail.countedReviews", { n: countedReviews }) }}
          </div>
        </div>
      </div>

      <!-- 标签放在游戏信息模块下方，横向排列 -->
      <div v-if="displayGame.tags && displayGame.tags.length" class="tags-row">
        <span v-if="previewing && previewChanged?.tags" class="diff-badge badge-tags">{{ lang.t("admin.changed") }}</span>
        <span v-for="t in displayGame.tags" :key="t" class="tag">{{ lang.tag(t) }}</span>
      </div>

      <!-- 评测区仅公开页面展示：软删除游戏预览无评测数据，避免误示为空 -->
      <section v-if="!previewDeleted" class="reviews-section">
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
        <div v-if="reviews.length" class="cards other">
          <ReviewCard v-for="r in reviews" :key="r.id" :review="r" detail-panel />
        </div>

        <div v-if="hasMore" ref="loadMoreRef" class="reviews-load-more">
          <span v-if="loadingMore" class="load-more-tip">{{ lang.t("loading") }}</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* 申请预览横幅：固定在内容顶部，提示当前正查看某位申请人的修改预算 */
.preview-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--warn-border);
  border-radius: 10px;
  background: var(--warn-bg);
  color: var(--warn-text);
  position: relative;
  z-index: 1; /* 置于 Hero 背景条(z-index:0)之上，避免背景图淡入后盖住横幅 */
}
/* 软删除预览横幅：危险色系，区分“已删除”状态 */
.preview-banner.deleted {
  border-color: var(--danger);
  background: var(--danger-bg);
  color: var(--danger);
}
.preview-tag {
  font-size: 12px;
  font-weight: 700;
  background: var(--warn-border);
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.preview-banner.deleted .preview-tag {
  background: var(--danger);
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
  border: 1px solid var(--warn-border);
  border-radius: 6px;
  background: transparent;
  color: var(--warn-text);
  font-size: 13px;
  cursor: pointer;
}
.preview-exit:hover {
  background: var(--warn-border);
  color: #fff;
}
.preview-banner.deleted .preview-exit {
  border-color: var(--danger);
  color: var(--danger);
}
.preview-banner.deleted .preview-exit:hover {
  background: var(--danger);
  color: #fff;
}

/* “已修改”角标：橙色小胶囊，标识被申请改动的字段/位置 */
.diff-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--warn-border);
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  line-height: 1; /* 不受父级 line-height(如 hero-bg 的 0)影响，保持胶囊高度正常 */
}
.title-line {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}
/* 封面左上角、Hero 背景条右上角的“已修改”角标（hero 为绝对定位容器，以此定位） */
.badge-cover {
  position: absolute;
  left: 24px;
  top: 24px;
  z-index: 2;
}
.badge-hero {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
}

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

/* 加载完成时：高度已被空态容器锁定，仅做一次柔和淡入，避免内容替换时的生硬跳变 */
.game-page.content-fade {
  animation: game-content-fade 0.28s ease;
}
@keyframes game-content-fade {
  from { opacity: 0; }
  to { opacity: 1; }
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
  min-width: 0;
}
/* 评测卡作为网格项允许收缩到容器宽度内，避免长内容把卡片撑出内容卡片 */
.cards > * {
  min-width: 0;
  max-width: 100%;
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

/* 触底加载区域：作为 IntersectionObserver 哨兵，滚动进入视口即触发追加 */
.reviews-load-more {
  min-height: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 8px;
}
.load-more-tip {
  color: var(--text-2);
  font-size: 13px;
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

/* ===== 移动端（窄屏 ≤768）：hero 单列堆叠 + 流式字号 + 缩小分数框 =====
   桌面端是「左 240px 封面 + 右信息列」，信息列靠 padding-right:210px 给右上角
   176px 分数框让位。窄屏下这套比例会被 240+210 挤爆，故：
   - hero 本就 flex-wrap，这里让封面与信息各占整行 → 上下堆叠；
   - 封面居中、限宽，避免竖图在窄屏过高；
   - 分数框缩小并仍锚定信息列右上角，信息列相应减小 padding-right；
   - 标题用 clamp() 流式缩放，不再固定 44px。 */
@media (max-width: 768px) {
  .hero {
    padding: 14px;
    gap: 16px;
  }
  .cover {
    flex: 1 1 100%;
    width: 100%;
    max-width: 220px;
    margin: 0 auto;
    align-self: auto;
  }
  .info {
    flex: 1 1 100%;
    width: 100%;
    min-width: 0;
  }
  /* 移动端：游戏名与分数垂直排列（名称在上、分数紧随其下），通过 flex order 重排 */
  .info-title {
    order: 1;
    padding-right: 0; /* 分数不再绝对定位右置，标题占满整行 */
    min-height: 0;
    align-items: center;
    text-align: center; /* 游戏名与英文名居中 */
  }
  .info-title h1 {
    font-size: clamp(26px, 8vw, 40px);
  }
  .title-alt {
    font-size: 16px;
  }
  /* 分数改为独立色条（static 进入文档流），居中、自适应宽度，避免通栏过宽 */
  .score-pill {
    order: 2;
    position: static;
    align-self: center;
    width: auto;
    min-width: 120px;
    padding: 0 22px;
    height: 56px;
    flex-direction: row;
    gap: 8px;
    margin: 4px 0 0;
    border-radius: 10px;
  }
  .score-pill .sc-num {
    font-size: 32px;
  }
  .score-pill .sc-na {
    font-size: 16px;
  }
  .counted-reviews {
    order: 3;
    position: static;
    width: 100%;
    text-align: center; /* 计入评测数也居中 */
    margin-bottom: 4px;
    font-size: 12px;
  }
  /* 移动端不显示简介、制作公司、发行公司 */
  .intro-title,
  .desc,
  .facts {
    display: none;
  }
  /* 剩余操作按钮(编辑/删除/申请编辑)居中对齐；footer 仅剩底部的操作组 */
  .info-footer {
    order: 4;
    justify-content: center;
  }
  .fact-value {
    max-width: 20ch;
  }
  .badge-cover {
    left: 14px;
    top: 14px;
  }
  .badge-hero {
    top: 12px;
    right: 12px;
  }
}
</style>