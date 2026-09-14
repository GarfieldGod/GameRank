<script setup>
import { onMounted, reactive, ref } from "vue";
import { fetchReviews } from "@/api/review";
import ReviewCard from "@/components/ReviewCard.vue";
import { useLangStore } from "@/stores/lang";

const lang = useLangStore();

const reviews = ref([]);
const total = ref(0);
const loading = ref(false);

// 支持从 URL 参数带入初始 tag（例如标签跳转）
const query = reactive({ keyword: "", tag: "", page: 1 });
const pageSize = 6;

// 常见标签候选，点击即筛选
const tagOptions = ["RPG", "动作", "冒险", "开放世界", "独立", "射击", "策略", "竞速"];

async function load() {
  loading.value = true;
  try {
    const data = await fetchReviews({
      page: query.page,
      pageSize,
      keyword: query.keyword.trim() || undefined,
      tag: query.tag || undefined,
    });
    reviews.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

function selectTag(tag) {
  query.tag = query.tag === tag ? "" : tag;
  query.page = 1;
  load();
}

function goPage(p) {
  query.page = p;
  load();
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize) || 1);

onMounted(load);
</script>

<template>
  <div class="list-page">
    <div class="toolbar">
      <form class="search" @submit.prevent="onSearch">
        <input v-model="query.keyword" :placeholder="lang.t('review.list.searchPlaceholder')" />
        <button type="submit">{{ lang.t("review.list.searchSubmit") }}</button>
      </form>
      <RouterLink class="create-btn" to="/reviews/new">{{ lang.t("review.list.write") }}</RouterLink>
    </div>

    <div class="tags">
      <button
        v-for="t in tagOptions"
        :key="t"
        class="tag"
        :class="{ active: query.tag === t }"
        @click="selectTag(t)"
      >
        {{ t }}
      </button>
      <button v-if="query.tag" class="tag clear" @click="selectTag(query.tag)">{{ lang.t("review.list.clear") }}</button>
    </div>

    <p v-if="loading" class="hint">{{ lang.t("loading") }}</p>
    <p v-else-if="reviews.length === 0" class="hint">{{ lang.t("review.list.empty") }}</p>

    <div v-else class="cards">
      <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
    </div>

    <div v-if="totalPages() > 1" class="pager">
      <button :disabled="query.page <= 1" @click="goPage(query.page - 1)">{{ lang.t("common.prev") }}</button>
      <span>{{ query.page }} / {{ totalPages() }}</span>
      <button :disabled="query.page >= totalPages()" @click="goPage(query.page + 1)">{{ lang.t("common.next") }}</button>
    </div>
  </div>
</template>

<style scoped>
.list-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search {
  flex: 1;
  display: flex;
  gap: 8px;
}

.search input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.search button,
.create-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  text-decoration: none;
  font-size: 14px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
}

.tag.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.tag.clear {
  color: #dc2626;
  border-color: #fca5a5;
}

.hint {
  color: #6b7280;
  text-align: center;
  padding: 40px 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.pager button {
  padding: 6px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.pager button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>