<script setup>
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchGames, fetchGameTags } from "@/api/game";
import { useLangStore } from "@/stores/lang";

const lang = useLangStore();
const games = ref([]);
const tagOptions = ref([]);
const selectedTag = ref("");
const keyword = ref("");
const loading = ref(true);

function cover(url) {
  if (url) return url;
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="18" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>'
  );
}

function parseGame(g) {
  return { ...g, tags: Array.isArray(g.tags) ? g.tags : (g.tags ? JSON.parse(g.tags) : []) };
}

// 加载游戏列表：有搜索关键字时搜索库中全部游戏，否则按选中标签过滤
async function load() {
  try {
    const kw = keyword.value.trim();
    const params = kw ? { keyword: kw } : selectedTag.value ? { tag: selectedTag.value } : undefined;
    const data = await fetchGames(params);
    games.value = data.map(parseGame);
  } finally {
    loading.value = false;
  }
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
  load();
}

// 搜索库中全部游戏：清除标签筛选
function onSearch() {
  selectedTag.value = "";
  load();
}

function clearSearch() {
  keyword.value = "";
  load();
}

onMounted(() => {
  load();
  loadTags();
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
          <span class="tag-name">{{ t.tag }}</span>
          <span class="count">{{ t.count }}</span>
        </button>
      </aside>

      <div class="main">
        <form class="search-bar" @submit.prevent="onSearch">
          <input v-model="keyword" :placeholder="lang.t('games.searchPlaceholder')" />
          <button type="submit">{{ lang.t("games.search") }}</button>
          <button v-if="keyword" type="button" @click="clearSearch">
            {{ lang.t("games.clearSearch") }}
          </button>
        </form>

        <p v-if="loading" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="games.length === 0" class="hint">
          {{ keyword ? lang.t("games.noMatch") : lang.t("games.empty") }}
        </p>

        <div v-else class="grid">
          <div v-for="g in games" :key="g.id" class="card">
            <RouterLink class="card-link" :to="`/game/${g.id}`">
              <img class="cover" :src="cover(g.coverImageUrl)" :alt="lang.gname(g)" />
            </RouterLink>
            <div class="body">
              <RouterLink class="row" :to="`/game/${g.id}`" style="text-decoration: none; color: inherit">
                <h3>{{ lang.gname(g) }}</h3>
                <span v-if="g.score != null" class="score">{{ g.score }}</span>
              </RouterLink>
              <div class="tags">
                <span v-for="t in g.tags" :key="t" class="tag">{{ t }}</span>
              </div>
            </div>
          </div>
        </div>
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
  color: #6b7280;
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
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  position: sticky;
  top: 76px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
}

.sidebar-title {
  margin: 0 6px 8px;
  font-size: 14px;
  color: #6b7280;
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
  color: #374151;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.tag-item:hover {
  background: #f3f4f6;
}

.tag-item.active {
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}

.tag-item .count {
  font-size: 12px;
  color: #9ca3af;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 1px 7px;
}

.tag-item.active .count {
  background: #e0e7ff;
  color: #4338ca;
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

.search-bar input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
}

.search-bar input:focus {
  outline: none;
  border-color: #2563eb;
}

.search-bar button {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.search-bar button:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.hint {
  color: #6b7280;
  text-align: center;
  padding: 30px 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}

.card-link {
  display: block;
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

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.row h3 {
  margin: 0;
  font-size: 16px;
}

.score {
  background: #fde68a;
  color: #92400e;
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 14px;
}

.tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  font-size: 12px;
  background: #f3f4f6;
  border-radius: 4px;
  padding: 2px 8px;
  color: #4b5563;
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