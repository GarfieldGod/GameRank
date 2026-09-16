<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, RouterLink, useRoute } from "vue-router";
import { fetchGames, fetchGameTags } from "@/api/game";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const lang = useLangStore();
const theme = useThemeStore();
const auth = useAuthStore();
const route = useRoute();
defineOptions({ name: "GameListView" });
const games = ref([]);
const tagOptions = ref([]);
const selectedTag = ref("");
const keyword = ref("");
const loading = ref(true); // 首次加载
const loadingMore = ref(false); // 流式加载中
const page = ref(1);
const pageSize = 50;
const total = ref(0);
const hasMore = computed(() => games.value.length < total.value);
const debounceTimer = ref(null);
// 记录已加载完成的封面 id：未就绪前封面透明占位，加载完成后渐变淡入，避免比例/裁剪的跳变
const loadedCovers = reactive(new Set());
function onCoverLoad(id) {
  loadedCovers.add(id);
}
function isCoverLoaded(id) {
  return loadedCovers.has(id);
}
// 添加游戏后跳回时的提示（GET /games?added=1）
const justAdded = ref(Boolean(route.query.added));

function dismissAdded() {
  justAdded.value = false;
}

function cover(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const fill = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="${fg}" font-size="18" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>`
  );
}

function parseGame(g) {
  return { ...g, tags: Array.isArray(g.tags) ? g.tags : (g.tags ? JSON.parse(g.tags) : []) };
}

// 当前请求参数（搜索关键词或选中标签）
function currentParams(no) {
  const p = { page: no, pageSize: pageSize };
  const kw = keyword.value.trim();
  if (kw) p.keyword = kw;
  else if (selectedTag.value) p.tag = selectedTag.value;
  return p;
}

// 加载游戏列表：reset=true 重置为第一页，否则追加下一页
async function load(reset = true) {
  if (reset) {
    loading.value = true;
    loadingMore.value = false;
    games.value = [];
    page.value = 1;
  }
  try {
    const data = await fetchGames(currentParams(page.value));
    total.value = data.total;
    if (reset) {
      games.value = data.list.map(parseGame);
    } else {
      const seen = new Set(games.value.map((g) => g.id));
      games.value = [...games.value, ...data.list.map(parseGame).filter((g) => !seen.has(g.id))];
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

// 流式加载下一页：滑动到底部时触发，一次只加载 50 个
async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  page.value += 1;
  await load(false);
}

// 滚动监听：接近底部时追加下一页
function onScroll() {
  if (loadingMore.value) return;
  const doc = document.documentElement;
  const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 300;
  if (atBottom) loadMore();
}

// 加载标签列表（含数量）
async function loadTags() {
  try {
    tagOptions.value = await fetchGameTags();
  } catch {
    tagOptions.value = [];
  }
}

function selectTag(tag) {
  if (selectedTag.value === tag && !keyword.value) return;
  selectedTag.value = tag;
  keyword.value = ""; // 切换标签时清除搜索
  load(true);
}

// 实时搜索：输入停顿 400ms 后触发，搜索时自动清除标签筛选
watch(keyword, () => {
  clearTimeout(debounceTimer.value);
  debounceTimer.value = setTimeout(() => {
    if (keyword.value.trim()) selectedTag.value = "";
    load(true);
  }, 400);
});

function clearSearch() {
  clearTimeout(debounceTimer.value);
  keyword.value = "";
  selectedTag.value = "";
  load(true);
}

onMounted(() => {
  load(true);
  loadTags();
  window.addEventListener("scroll", onScroll, { passive: true });
});

// —— 列表被 KeepAlive 缓存期间保存/恢复滚动位置 ——
// 必须在 onBeforeRouteLeave 里读取真实 scrollY：onDeactivated 触发时路由已先滚到顶部，
// 此时 window.scrollY 已被置 0，会存成错误值。
const savedScroll = ref(0);
onBeforeRouteLeave(() => {
  savedScroll.value = window.scrollY || 0;
});
onActivated(async () => {
  await nextTick();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.scrollTo(0, savedScroll.value);
  }));
});

onBeforeUnmount(() => {
  clearTimeout(debounceTimer.value);
  window.removeEventListener("scroll", onScroll);
});
</script>

<template>
  <div class="games-page">
    <h1>{{ lang.t("games.title") }}</h1>
    <p class="muted">{{ lang.t("games.subtitle") }}</p>

    <div class="layout">
      <aside class="sidebar">
        <h3 class="sidebar-title">{{ lang.t("games.filter") }}</h3>
        <button
          class="tag-item"
          :class="{ active: selectedTag === '' }"
          @click="selectTag('')"
        >
          {{ lang.t("games.all") }}
        </button>
        <button
          v-for="t in tagOptions"
          :key="t.tag"
          class="tag-item"
          :class="{ active: selectedTag === t.tag }"
          @click="selectTag(t.tag)"
        >
          <span class="tag-name">{{ lang.tag(t.tag) }}</span>
          <span class="count">{{ t.count }}</span>
        </button>
      </aside>

      <div class="main">
        <div class="search-bar">
          <div class="search-input">
            <input v-model="keyword" :placeholder="lang.t('games.searchPlaceholder')" />
            <button
              v-if="keyword"
              type="button"
              class="search-clear"
              @click="clearSearch"
              :aria-label="lang.t('games.clearSearch')"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <RouterLink v-if="auth.isLoggedIn" class="apply-add" to="/games/new">
            {{ lang.t("games.applyAdd") }}
          </RouterLink>
        </div>

        <p v-if="justAdded" class="added-banner">
          {{ lang.t("games.addedPending") }}
          <button type="button" class="close" @click="dismissAdded">×</button>
        </p>

        <p v-if="loading" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="games.length === 0" class="hint empty">
          <template v-if="keyword">{{ lang.t("games.noMatch") }}</template>
          <template v-else>{{ lang.t("games.emptyQ") }}</template>
          <RouterLink class="add-link" to="/games/new">{{ lang.t("games.addNew") }}</RouterLink>{{ lang.t("games.noMatchSuffix") }}
        </p>

        <div v-else class="grid">
          <div v-for="g in games" :key="g.id" class="card">
            <RouterLink class="card-link" :to="`/game/${g.id}`">
              <img
                class="cover"
                :class="{ loaded: isCoverLoaded(g.id) }"
                :src="cover(g.logoImageUrl || g.coverImageUrl || g.heroImageUrl)"
                :alt="lang.gname(g)"
                loading="lazy"
                @load="onCoverLoad(g.id)"
              />
            </RouterLink>
            <div class="body">
              <h3 class="gname">
                <RouterLink :to="`/game/${g.id}`" :title="lang.gname(g)">{{ lang.gname(g) }}</RouterLink>
              </h3>
              <div class="tags">
                <span v-for="t in g.tags.slice(0, 3)" :key="t" class="tag">{{ lang.tag(t) }}</span>
                <span v-if="g.tags.length > 3" class="tag more">+{{ g.tags.length - 3 }}</span>
              </div>
              <span v-if="g.score != null" class="score">{{ g.score.toFixed(1) }}</span>
            </div>
          </div>
        </div>

        <p v-if="loadingMore" class="hint load-more">
          {{ lang.t("loading") }}
        </p>
        <p v-else-if="!loading && games.length && !hasMore" class="hint load-more">
          {{ lang.t("games.loadedAll") }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.games-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  margin: 0;
}

.muted {
  color: var(--text-2);
  margin: 0;
}

.layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

/* 左侧标签筛选栏 */
.sidebar {
  width: 190px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  position: sticky;
  top: 76px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
}

.sidebar-title {
  margin: 0 6px 8px;
  font-size: 14px;
  color: var(--text-2);
  font-weight: 600;
}

.tag-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-1);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.tag-item:hover {
  background: var(--hover);
}

.tag-item.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.tag-item .count {
  font-size: 12px;
  color: var(--text-3);
  background: var(--hover);
  border-radius: 8px;
  padding: 1px 7px;
}

.tag-item.active .count {
  background: var(--primary-soft);
  color: var(--primary);
}

.main {
  flex: 1;
  min-width: 0;
}

/* 游戏列表上方的搜索栏 */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.search-input {
  position: relative;
  flex: 1;
  min-width: 0;
}

.search-input input {
  width: 100%;
  padding: 9px 34px 9px 12px; /* 右侧为叉号按钮留出空间 */
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-1);
  background: var(--surface);
}

.search-input input:focus {
  outline: none;
  border-color: var(--primary);
}

/* 搜索框内部右侧的清空叉号 */
.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}

.search-clear:hover {
  background: var(--hover);
  color: var(--text-1);
}

.apply-add {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
}
.apply-add:hover {
  background: var(--primary-hover);
}

.hint {
  color: var(--text-2);
  text-align: center;
  padding: 30px 0;
}

.load-more {
  padding: 16px 0 4px;
  font-size: 13px;
  color: var(--text-3);
}

/* 添加游戏后回跳的提示条 */
.added-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 14px;
}
.added-banner .close {
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

/* 空状态里的「我来添加」链接：蓝色、悬停下划线 */
.hint.empty {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  flex-wrap: wrap;
}
.add-link {
  color: var(--primary);
  font-weight: 600;
  text-decoration: none;
}
.add-link:hover {
  text-decoration: underline;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  align-items: start; /* 每张卡片保持自身高度，使分数底部精确对齐本卡片标签底部 */
}

.card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: var(--shadow-sm);
}

.card-link {
  display: block;
}

.cover {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: var(--surface-2);
  /* 未就绪时保持透明，图片加载完成后渐变淡入，避免先看到别的比例再跳到裁剪后的突兀感 */
  opacity: 0;
  transition: opacity 0.5s ease;
}
.cover.loaded {
  opacity: 1;
}

.body {
  position: relative; /* 作为分数条绝对定位的参照 */
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gname {
  margin: 0;
  font-size: 16px;
  padding-right: 64px; /* 为右侧放大的分数块留出空间，避免长名重叠 */
  min-width: 0; /* 允许内部截断，撑破 grid 单元格 */
}

.gname a {
  display: block;
  text-decoration: none;
  color: var(--text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis; /* 超长不换行，用 … 收尾 */
}

.gname a:hover {
  color: var(--primary);
}

.score {
  position: absolute;
  right: 14px;
  top: 12px; /* 顶部对齐游戏名顶部 */
  bottom: 12px; /* 底部对齐标签行底部（body 内边距底即标签行底） */
  width: 56px; /* 按比例加宽 */
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--score-bg);
  color: var(--score-text);
  font-weight: 700;
  border-radius: 8px;
  font-size: 19px; /* 按比例放大数字 */
}

.tags {
  display: flex;
  flex-wrap: nowrap; /* 单行展示，避免英文标签超长时换行导致卡片高度不一 */
  gap: 6px;
  width: calc(100% - 78px); /* 限制宽度，标签不会延伸至分数区域 */
  overflow: hidden; /* 超出部分裁切隐藏，但标签仍保留在数据中，仍可按标签找到该游戏 */
  min-height: 24px; /* 无标签时也占一行高度，保证卡片高度一致 */
  align-items: center;
}

.tag {
  font-size: 12px;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 2px 8px;
  color: var(--text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.tag.more {
  color: var(--text-3);
  background: transparent;
  border: 1px dashed var(--border-strong);
  flex-shrink: 0;
}

/* 窄屏时筛选栏横向铺开 */
@media (max-width: 760px) {
  .layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    position: static;
    max-height: none;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .sidebar-title {
    width: 100%;
  }

  .tag-item {
    width: auto;
  }
}
</style>