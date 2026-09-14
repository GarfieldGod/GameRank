<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { deleteGame, fetchGame } from "@/api/game";
import ReviewCard from "@/components/ReviewCard.vue";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const router = useRouter();
const lang = useLangStore();
const auth = useAuthStore();

const game = ref(null);
const reviews = ref([]);
const total = ref(0);
const loading = ref(true);
const notFound = ref(false);
const query = reactive({ page: 1 });
const pageSize = 5;

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize) || 1);

// 管理员可编辑/删除游戏
const canManage = computed(() => auth.isLoggedIn && auth.isAdmin);
const deleting = ref(false);
const deleteFailed = ref("");

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
  try {
    const data = await fetchGame(route.params.id, {
      page: query.page,
      pageSize,
    });
    game.value = data.game;
    reviews.value = data.reviews;
    total.value = data.total;
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
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="28" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">暂无封面</text></svg>'
  );
}

onMounted(load);
// 路由参数变化时重新加载
watch(() => route.params.id, load);
</script>

<template>
  <div class="game-page">
    <p v-if="loading">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound">{{ lang.t("game.detail.notFound") }}</p>

    <template v-else-if="game">
      <div class="hero">
        <img class="cover" :src="cover(game.coverImageUrl)" :alt="lang.gname(game)" />
        <div class="info">
          <h1>{{ lang.gname(game) }}</h1>
          <div v-if="canManage" class="admin-bar">
            <RouterLink class="btn-edit" :to="`/games/${game.id}/edit`">{{ lang.t("game.detail.edit") }}</RouterLink>
            <button class="btn-delete" :disabled="deleting" @click="onDelete">{{ lang.t("game.detail.delete") }}</button>
            <span v-if="deleteFailed" class="err">{{ deleteFailed }}</span>
          </div>
          <div class="score-box">
            <template v-if="game.score != null">
              <span class="score">{{ game.score }}</span>
              <span class="score-label">{{ lang.t("review.detail.unit") }}</span>
            </template>
            <span v-else class="score-na">{{ lang.t("game.detail.noScore") }}</span>
          </div>
          <dl class="facts">
            <div class="fact"><dt>{{ lang.t("game.detail.developer") }}</dt><dd>{{ game.developer || lang.t("game.detail.unknown") }}</dd></div>
            <div class="fact"><dt>{{ lang.t("game.detail.publisher") }}</dt><dd>{{ game.publisher || lang.t("game.detail.unknown") }}</dd></div>
          </dl>
          <div class="tags">
            <span v-for="t in game.tags" :key="t" class="tag">{{ t }}</span>
          </div>
        </div>
      </div>

      <section class="desc">
        <h2>{{ lang.t("game.detail.desc") }}</h2>
        <p>{{ game.description || "—" }}</p>
      </section>

      <section class="reviews-section">
        <h2>{{ lang.t("game.detail.reviews", { n: total }) }}</h2>
        <p v-if="reviews.length === 0" class="hint">{{ lang.t("game.detail.noReviews") }}</p>
        <div v-else class="cards">
          <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
        </div>

        <div v-if="totalPages() > 1" class="pager">
          <button :disabled="query.page <= 1" @click="goPage(query.page - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ query.page }} / {{ totalPages() }}</span>
          <button :disabled="query.page >= totalPages()" @click="goPage(query.page + 1)">{{ lang.t("common.next") }}</button>
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
}

.hero {
  display: flex;
  gap: 24px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
  flex-wrap: wrap;
}

.cover {
  width: 260px;
  max-width: 100%;
  border-radius: 10px;
  object-fit: cover;
  align-self: flex-start;
}

.info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info h1 {
  margin: 0;
  font-size: 26px;
}

.admin-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-edit,
.btn-delete {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.btn-edit:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.btn-delete {
  color: #dc2626;
  border-color: #fca5a5;
}

.btn-delete:hover {
  background: #fef2f2;
}

.btn-delete:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.err {
  color: #dc2626;
  font-size: 14px;
}

.score-box {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.score {
  font-size: 44px;
  font-weight: 800;
  color: #b45309;
}

.score-label {
  color: #6b7280;
}

.score-na {
  font-size: 20px;
  color: #9ca3af;
}

.facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.fact {
  display: flex;
  gap: 8px;
  font-size: 14px;
}

.fact dt {
  color: #6b7280;
  min-width: 56px;
}

.fact dd {
  margin: 0;
  color: #111827;
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

section h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.desc p {
  color: #374151;
  line-height: 1.7;
  margin: 0;
}

.hint {
  color: #6b7280;
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