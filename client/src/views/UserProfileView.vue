<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { fetchUser } from "@/api/user";
import { fetchReviews } from "@/api/review";
import ReviewCard from "@/components/ReviewCard.vue";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const auth = useAuthStore();
const lang = useLangStore();

const profile = ref(null);
const loadingProfile = ref(true);
const notFound = ref(false);

const reviews = ref([]);
const total = ref(0);
const loadingReviews = ref(false);
const query = reactive({ page: 1 });
const pageSize = 6;

const userId = () => Number(route.params.userId);
const isOwn = () => auth.isLoggedIn && auth.user?.id === userId();

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize) || 1);

async function loadProfile() {
  loadingProfile.value = true;
  notFound.value = false;
  profile.value = null;
  try {
    profile.value = await fetchUser(userId());
  } catch {
    notFound.value = true;
  } finally {
    loadingProfile.value = false;
  }
}

async function loadReviews() {
  loadingReviews.value = true;
  try {
    const data = await fetchReviews({
      page: query.page,
      pageSize,
      authorId: userId(),
    });
    reviews.value = data.list;
    total.value = data.total;
  } finally {
    loadingReviews.value = false;
  }
}

function goPage(p) {
  query.page = p;
  loadReviews();
}

function avatarUrl(url) {
  if (url) return url;
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="64" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>'
  );
}

function formatTime(t) {
  return new Date(t).toLocaleDateString(lang.isEn ? "en-US" : "zh-CN");
}

function routeChange() {
  query.page = 1;
  loadProfile();
  loadReviews();
}

onMounted(routeChange);
</script>

<template>
  <div class="profile-page">
    <p v-if="loadingProfile">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound">{{ lang.t("user.profile.notFound") }}</p>

    <template v-else-if="profile">
      <div class="profile-head">
        <img class="avatar" :src="avatarUrl(profile.avatar)" :alt="displayName(profile)" />
        <div class="info">
          <h1>{{ displayName(profile) }}</h1>
          <p v-if="profile.nickname && profile.nickname !== displayName(profile)" class="account">@{{ profile.username }}</p>
          <p class="bio">{{ profile.bio || lang.t("user.profile.bioEmpty") }}</p>
          <p class="joined">{{ lang.t("user.profile.joined") }} {{ formatTime(profile.createdAt) }}</p>
        </div>
        <RouterLink v-if="isOwn()" class="edit-btn" :to="`/user/${profile.id}/edit`">
          {{ lang.t("user.profile.edit") }}
        </RouterLink>
      </div>

      <h2 class="section-title">{{ lang.t("user.profile.reviews", { n: total }) }}</h2>

      <p v-if="loadingReviews" class="hint">{{ lang.t("loading") }}</p>
      <p v-else-if="reviews.length === 0" class="hint">{{ lang.t("user.profile.noReviews") }}</p>
      <div v-else class="cards">
        <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
      </div>

      <div v-if="totalPages() > 1" class="pager">
        <button :disabled="query.page <= 1" @click="goPage(query.page - 1)">{{ lang.t("common.prev") }}</button>
        <span>{{ query.page }} / {{ totalPages() }}</span>
        <button :disabled="query.page >= totalPages()" @click="goPage(query.page + 1)">{{ lang.t("common.next") }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-head {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}

.avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #e5e7eb;
  flex-shrink: 0;
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info h1 {
  margin: 0;
  font-size: 22px;
}

.bio {
  color: #4b5563;
  margin: 0;
}

.account {
  color: #9ca3af;
  font-size: 14px;
  margin: 0;
}

.joined {
  color: #9ca3af;
  font-size: 13px;
  margin: 0;
}

.edit-btn {
  padding: 8px 16px;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}

.section-title {
  margin: 0;
  font-size: 18px;
}

.hint {
  color: #6b7280;
  text-align: center;
  padding: 30px 0;
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