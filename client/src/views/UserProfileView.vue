<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { fetchUser } from "@/api/user";
import { fetchReviews, deleteReview } from "@/api/review";
import { fetchMyProposals } from "@/api/proposal";
import { gameDisplayName } from "@/utils/markdown";
import { extractError } from "@/api/request";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

const profile = ref(null);
const loadingProfile = ref(true);
const notFound = ref(false);

const reviews = ref([]);
const total = ref(0);
const loadingReviews = ref(false);
const query = reactive({ page: 1 });
const pageSize = 6;
const activeTab = ref(["published", "draft", "submission"].includes(route.query.tab) ? route.query.tab : "published"); // 'published' | 'draft' | 'submission'

// 事务（游戏申请）列表
const proposals = ref([]);
const loadingProposals = ref(false);

const userId = () => Number(route.params.userId);
const isOwn = () => auth.isLoggedIn && auth.user?.id === userId();
const isDraftTab = () => activeTab.value === "draft";
const isSubmissionTab = () => activeTab.value === "submission";

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
    const isDraft = isDraftTab();
    const data = await fetchReviews({
      page: query.page,
      pageSize,
      authorId: userId(),
      status: isDraft ? "DRAFT" : undefined,
      sort: isDraft ? undefined : "rating",
    });
    reviews.value = data.list;
    total.value = data.total;
  } finally {
    loadingReviews.value = false;
  }
}

async function loadProposals() {
  loadingProposals.value = true;
  try {
    proposals.value = await fetchMyProposals();
  } finally {
    loadingProposals.value = false;
  }
}

// 申请展示名：新增用申请数据名，编辑用现有游戏名
function proposalName(p) {
  if (p.kind === "ADD") return p.data.nameZh || p.game?.nameZh || "";
  return p.game?.nameZh || p.data.nameZh || "";
}
// 申请进入详情：被拒绝的新增申请目标游戏已删除，不回链
function proposalTarget(p) {
  if (p.status === "REJECTED" && p.kind === "ADD") return null;
  return p.gameId ? `/game/${p.gameId}` : null;
}
function proposalStatus(p) {
  return `proposal.status.${String(p.status).toLowerCase()}`;
}
// 编辑待审核申请（PENDING）：进入编辑界面按申请数据预填，保存后更新该申请
function editProposal(p) {
  router.push(`/games/new?editProposal=${p.id}`);
}
// 重新申请：被拒绝的新增→进入添加游戏编辑界面并预填；被拒绝的编辑→回到目标游戏详情页
function reapply(p) {
  if (p.kind === "EDIT") {
    if (p.gameId) router.push(`/game/${p.gameId}`);
    return;
  }
  const q = new URLSearchParams();
  q.set("reapply", "1");
  const d = p.data || {};
  for (const k of ["nameZh", "nameEn", "developer", "publisher"]) {
    if (d[k]) q.set(k, d[k]);
  }
  if (d.description) q.set("description", d.description);
  if (d.score != null) q.set("score", d.score);
  if (d.coverImageUrl) q.set("coverImageUrl", d.coverImageUrl);
  if (Array.isArray(d.tags)) q.set("tags", d.tags.join(","));
  router.push("/games/new?" + q.toString());
}
function proposalCover(p) {
  return p.game?.coverImageUrl || p.data?.coverImageUrl || "";
}

function formatRating(r) {
  return (Number(r.rating) || 0).toFixed(1);
}

function coverOf(r) {
  return r.game?.coverImageUrl || r.coverImageUrl || "";
}

// 排行榜简介：优先取一句话简评，没有则取正文第一段
function briefOf(r) {
  if (r.brief && r.brief.trim()) return r.brief.trim();
  const first = (r.content || "")
    .replace(/[#*_>`~-]/g, "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean) || "";
  return first.length > 80 ? first.slice(0, 80) + "…" : first;
}

function goPage(p) {
  query.page = p;
  loadReviews();
}

const deletingId = ref(null);
async function removeDraft(d) {
  if (!window.confirm(lang.t("user.profile.deleteDraft"))) return;
  deletingId.value = d.id;
  try {
    await deleteReview(d.id);
    reviews.value = reviews.value.filter((x) => x.id !== d.id);
    total.value -= 1;
  } catch (err) {
    window.alert(extractError(err, lang.t("user.profile.deleteFailed")));
  } finally {
    deletingId.value = null;
  }
}

function switchTab(tab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  if (tab === "submission") {
    loadProposals();
  } else {
    query.page = 1;
    loadReviews();
  }
}

function avatarUrl(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const fill = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="${fg}" font-size="64" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>`
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

      <div class="tabs" v-if="isOwn()">
        <button
          class="tab"
          :class="{ active: activeTab === 'published' }"
          @click="switchTab('published')"
        >
          {{ lang.t("user.profile.published") }}
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'draft' }"
          @click="switchTab('draft')"
        >
          {{ lang.t("user.profile.drafts") }}
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'submission' }"
          @click="switchTab('submission')"
        >
          {{ lang.t("user.profile.submissions") }}
        </button>
      </div>

      <template v-if="isSubmissionTab()">
        <h2 class="section-title">{{ lang.t("user.profile.submissions") }}（{{ proposals.length }}）</h2>
        <p v-if="loadingProposals" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="proposals.length === 0" class="hint">{{ lang.t("user.profile.noProposals") }}</p>
        <div v-else class="proposal-list">
          <div v-for="p in proposals" :key="p.id" class="proposal-item">
            <img v-if="proposalCover(p)" class="prop-cover" :src="proposalCover(p)" alt="" loading="lazy" />
            <div v-else class="prop-cover placeholder">{{ (proposalName(p) || "?")[0] }}</div>
            <div class="prop-info">
              <div class="prop-top">
                <span class="prop-kind">{{ lang.t(`proposal.kind.${p.kind}`) }}</span>
                <span class="prop-status" :class="`st-${String(p.status).toLowerCase()}`">{{ lang.t(proposalStatus(p)) }}</span>
              </div>
              <a
                v-if="proposalTarget(p)"
                class="prop-name"
                :href="proposalTarget(p)"
              >{{ proposalName(p) }}</a>
              <span v-else class="prop-name no-link">{{ proposalName(p) }}</span>
              <span class="prop-time">{{ lang.t("proposal.time", { t: formatTime(p.createdAt) }) }}</span>
              <span v-if="p.rejectReason" class="prop-reject">{{ lang.t("proposal.rejectReason") }}：{{ p.rejectReason }}</span>
              <div class="prop-ops">
                <button v-if="p.status === 'PENDING'" class="prop-btn" @click="editProposal(p)">
                  {{ lang.t("proposal.edit") }}
                </button>
                <button v-if="p.status === 'REJECTED'" class="prop-btn" @click="reapply(p)">
                  {{ lang.t("proposal.reapply") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <h2 class="section-title">
          {{ isDraftTab() ? lang.t("user.profile.drafts", { n: total }) : lang.t("user.profile.reviews", { n: total }) }}
        </h2>

        <p v-if="loadingReviews" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="reviews.length === 0" class="hint">
          {{ isDraftTab() ? lang.t("user.profile.noDrafts") : lang.t("user.profile.noReviews") }}
        </p>
        <div v-else-if="!isDraftTab()" class="ranking-list">
          <RouterLink v-for="r in reviews" :key="r.id" class="ranking-item" :to="`/reviews/${r.id}`">
            <img class="rank-cover" :src="coverOf(r)" :alt="gameDisplayName(r, lang.isEn)" loading="lazy" />
            <div class="rank-info">
              <span class="rank-game">{{ gameDisplayName(r, lang.isEn) }}</span>
              <span v-if="briefOf(r)" class="rank-brief">{{ briefOf(r) }}</span>
            </div>
            <span class="rank-score">{{ formatRating(r) }}</span>
          </RouterLink>
        </div>
        <div v-else class="draft-list">
          <div v-for="d in reviews" :key="d.id" class="draft-item">
            <RouterLink class="draft-link" :to="`/reviews/${d.id}/edit`">
              <div class="draft-main">
                <span class="draft-title">{{ d.title }}</span>
                <span class="draft-game">{{ gameDisplayName(d, lang.isEn) }}</span>
              </div>
              <span class="draft-meta">
                {{ lang.t("user.profile.updatedTime", { t: formatTime(d.updatedAt) }) }}
              </span>
              <span class="draft-edit">{{ lang.t("user.profile.continueEdit") }}</span>
            </RouterLink>
            <button class="draft-delete" :disabled="deletingId === d.id" @click="removeDraft(d)">
              {{ lang.t("common.delete") }}
            </button>
          </div>
        </div>

        <div v-if="totalPages() > 1" class="pager">
          <button :disabled="query.page <= 1" @click="goPage(query.page - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ query.page }} / {{ totalPages() }}</span>
          <button :disabled="query.page >= totalPages()" @click="goPage(query.page + 1)">{{ lang.t("common.next") }}</button>
        </div>
      </template>
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
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border);
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
  color: var(--text);
}

.bio {
  color: var(--text-1);
  margin: 0;
}

.account {
  color: var(--text-3);
  font-size: 14px;
  margin: 0;
}

.joined {
  color: var(--text-3);
  font-size: 13px;
  margin: 0;
}

.edit-btn {
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}

.section-title {
  margin: 0;
  font-size: 18px;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

.draft-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.draft-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  transition: box-shadow 0.15s;
}
.draft-item:hover {
  box-shadow: var(--shadow-sm);
}
.draft-link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: inherit;
}
.draft-delete {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--danger);
  font-size: 13px;
  cursor: pointer;
}
.draft-delete:hover {
  background: var(--danger-bg);
}
.draft-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.draft-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.draft-title {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-game {
  color: var(--text-2);
  font-size: 13px;
}
.draft-meta {
  color: var(--text-3);
  font-size: 13px;
  flex-shrink: 0;
}
.draft-edit {
  color: var(--primary);
  font-size: 13px;
  flex-shrink: 0;
}

.hint {
  color: var(--text-2);
  text-align: center;
  padding: 30px 0;
}

.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ranking-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s;
}
.ranking-item:hover {
  box-shadow: var(--shadow-sm);
}
.rank-cover {
  width: 96px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--surface-2);
}
.rank-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank-game {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-brief {
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rank-score {
  font-size: 24px;
  font-weight: 800;
  color: var(--warn-text);
  flex-shrink: 0;
}

/* 事务（申请）列表 */
.proposal-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.proposal-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  transition: box-shadow 0.15s;
}
.proposal-item:hover {
  box-shadow: var(--shadow-sm);
}
.prop-cover {
  width: 96px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--surface-2);
}
.prop-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--text-3);
}
.prop-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prop-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prop-kind {
  font-size: 12px;
  color: var(--text-2);
  background: var(--hover);
  padding: 2px 8px;
  border-radius: 4px;
}
.prop-name {
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prop-name:hover {
  text-decoration: underline;
}
.prop-name.no-link {
  color: var(--text);
  cursor: default;
}
.prop-time {
  color: var(--text-3);
  font-size: 13px;
}
.prop-reject {
  color: var(--danger);
  font-size: 13px;
}
.prop-ops {
  display: flex;
  gap: 8px;
  align-self: flex-start;
  margin-top: 2px;
}
.prop-btn {
  padding: 6px 14px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
}
.prop-btn:hover {
  background: var(--primary);
  color: #fff;
}
.prop-status {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 600;
  flex-shrink: 0;
}
.prop-status.st-pending {
  color: var(--warn-text);
  background: var(--warn-bg);
}
.prop-status.st-approved {
  background: var(--success);
  color: #fff;
}
.prop-status.st-rejected {
  color: var(--danger);
  background: var(--danger-bg);
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

@media (max-width: 520px) {
  .draft-meta {
    display: none;
  }
}
</style>