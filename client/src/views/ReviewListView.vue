<script setup>
import { nextTick, onActivated, onDeactivated, onMounted, reactive, ref } from "vue";
import { fetchReviews } from "@/api/review";
import ReviewCard from "@/components/ReviewCard.vue";
import { useLangStore } from "@/stores/lang";

const lang = useLangStore();
defineOptions({ name: "ReviewListView" });

const reviews = ref([]);
const total = ref(0);
const loading = ref(false);

// 支持从 URL 参数带入初始筛选（keyword only）
const query = reactive({ keyword: "", page: 1 });
const pageSize = 6;

async function load() {
  loading.value = true;
  try {
    const data = await fetchReviews({
      page: query.page,
      pageSize,
      keyword: query.keyword.trim() || undefined,
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

function goPage(p) {
  query.page = p;
  load();
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize) || 1);

onMounted(load);

// —— 列表被 KeepAlive 缓存期间保存/恢复滚动位置 ——
const savedScroll = ref(0);
onDeactivated(() => {
  savedScroll.value = window.scrollY || 0;
});
onActivated(async () => {
  await nextTick();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.scrollTo(0, savedScroll.value);
  }));
});
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
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
}

.search button,
.create-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  text-decoration: none;
  font-size: 14px;
}

.hint {
  color: var(--text-2);
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