<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { fetchUserByUsername, setUserRole, deactivateAccount } from "@/api/user";
import { fetchReviews, deleteReview } from "@/api/review";
import { fetchMyProposals, deleteProposal } from "@/api/proposal";
import { gameDisplayName } from "@/utils/markdown";
import { extractError } from "@/api/request";
import { useAuthStore, displayName } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";
import { markReviewsDirty } from "@/utils/dirtySignal";

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

// 排行榜封面淡入：图片加载完成后才显示（与游戏库封面同款），按评测 id 去重
const loadedCovers = reactive(new Set());
function onCoverLoad(id) {
  if (id != null) loadedCovers.add(id);
}
function isCoverLoaded(id) {
  return id != null && loadedCovers.has(id);
}
const pageSize = 10;
const activeTab = ref(["published", "draft", "submission", "settings"].includes(route.query.tab) ? route.query.tab : "published"); // 'published' | 'draft' | 'submission' | 'settings'

// 事务（游戏申请）列表
const proposals = ref([]);
const loadingProposals = ref(false);

// 事务（游戏申请）分页：每页 10；不足整页不显示翻页
const proposalPageSize = 10;
const proposalPage = ref(1);
const proposalPageCount = computed(() => Math.max(1, Math.ceil(proposals.value.length / proposalPageSize)));
const pagedProposals = computed(() =>
  proposals.value.slice((proposalPage.value - 1) * proposalPageSize, proposalPage.value * proposalPageSize)
);
function goProposalPage(p) {
  proposalPage.value = Math.min(proposalPageCount.value, Math.max(1, p));
}
watch(proposalPageCount, () => {
  if (proposalPage.value > proposalPageCount.value) proposalPage.value = proposalPageCount.value;
});

// URL 用唯一账号 username（不暴露自增 id）；需要数字 id 的调用都在 profile 加载后用 profile.id
const routeUsername = () => route.params.username;
const isOwn = () => auth.isLoggedIn && auth.user?.username === routeUsername();
const isDraftTab = () => activeTab.value === "draft";
const isSubmissionTab = () => activeTab.value === "submission";
const isSettingsTab = () => activeTab.value === "settings";

// 注销账号：身份置已注销；VIP 与管理员一律置为注销（相当于先降权），并强制本端登出
const deactivating = ref(false);
async function onDeactivate() {
  if (!profile.value || deactivating.value) return;
  if (!window.confirm(lang.t("user.profile.deactivateConfirm"))) return;
  deactivating.value = true;
  try {
    const updated = await deactivateAccount();
    if (profile.value) profile.value.role = updated.role;
    auth.logout();
    activeTab.value = "published";
    router.replace(`/user/${profile.value.username}`);
  } catch (err) {
    window.alert(extractError(err, lang.t("user.profile.deactivateFailed")));
  } finally {
    deactivating.value = false;
  }
}

// 设为管理员 / 取消管理员：仅站长可见可用（服务端 ownerOnly 二次校验）
const roleBusy = ref(false);
async function onRoleToggle() {
  if (!profile.value) return;
  const isAdmin = profile.value.role === "ADMIN";
  const name = displayName(profile.value);
  const key = isAdmin ? "user.profile.revokeAdminConfirm" : "user.profile.setAdminConfirm";
  if (!window.confirm(lang.t(key, { name }))) return;
  roleBusy.value = true;
  try {
    const updated = await setUserRole(profile.value.id, isAdmin ? "USER" : "ADMIN");
    if (profile.value) profile.value.role = updated.role;
  } catch (err) {
    window.alert(extractError(err, lang.t("user.profile.roleFailed")));
  } finally {
    roleBusy.value = false;
  }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize) || 1);

async function loadProfile() {
  loadingProfile.value = true;
  notFound.value = false;
  profile.value = null;
  try {
    profile.value = await fetchUserByUsername(routeUsername());
  } catch (err) {
    if (err?.response?.status === 404 || err?.status === 404) {
      router.replace({ name: "not-found" });
    } else {
      notFound.value = true;
    }
  } finally {
    loadingProfile.value = false;
  }
}

async function loadReviews() {
  if (!profile.value) return; // profile 内才有 id；未就绪时由 loadProfile 完成后重新触发
  loadingReviews.value = true;
  try {
    const isDraft = isDraftTab();
    const data = await fetchReviews({
      page: query.page,
      pageSize,
      authorId: profile.value.id,
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

// 申请展示名：新增用申请数据名，编辑用现有游戏名；删除评测通知用快照游戏名
function proposalName(p) {
  if (p.kind === "DEL") return p.data.gameName || p.data.title || "";
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
  // 库封面优先级：logo → 详情封面 → 背景（与游戏库卡片同款）；先取关联游戏，再取申请快照
  return (
    p.game?.logoImageUrl || p.game?.coverImageUrl || p.game?.heroImageUrl ||
    p.data?.logoImageUrl || p.data?.coverImageUrl || p.data?.heroImageUrl ||
    ""
  );
}

// 重新编辑被删除的评测：按快照预填游戏名与简述，进入评测编辑器（标题由游戏名生成）
function redoReview(p) {
  const d = p.data || {};
  const q = new URLSearchParams();
  if (d.gameName) q.set("game", d.gameName);
  if (d.brief) q.set("brief", d.brief);
  router.push(`/reviews/new?${q.toString()}`);
}

const deletingProposalId = ref(null);
// 删除/取消事务：PENDING（审核中）取消申请，已处理删除记录
async function removeProposal(p) {
  const label = proposalName(p) || "…";
  const msg = p.status === "PENDING"
    ? lang.t("proposal.deletePendingConfirm", { name: label })
    : lang.t("proposal.deleteConfirm", { name: label });
  if (!window.confirm(msg)) return;
  deletingProposalId.value = p.id;
  try {
    await deleteProposal(p.id);
    proposals.value = proposals.value.filter((x) => x.id !== p.id);
  } catch (err) {
    window.alert(extractError(err, lang.t("proposal.deleteFailed")));
  } finally {
    deletingProposalId.value = null;
  }
}

function formatRating(r) {
  return (Number(r.rating) || 0).toFixed(1);
}

function coverOf(r) {
  // 库封面优先级：logo → 详情封面 → 背景（与游戏库/评测卡片同款），避免露出 SteamGridDB grid 图
  return r.game?.logoImageUrl || r.game?.coverImageUrl || r.game?.heroImageUrl || r.coverImageUrl || "";
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
    markReviewsDirty();
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
    proposalPage.value = 1;
    loadProposals();
  } else if (tab !== "settings") {
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
  // 路由可直接以 ?tab=submission 直达（如编辑申请保存后跳回）：此时初始标签已是事务，
  // 主动加载申请列表即可；评测列表依赖 profile（内含 id），待 profile 就绪后再加载
  if (activeTab.value === "submission") {
    loadProposals();
  }
  loadProfile().then(() => {
    if (activeTab.value !== "submission" && activeTab.value !== "settings") {
      loadReviews();
    }
  });
}

onMounted(routeChange);
</script>

<template>
  <div class="profile-page" :class="{ 'content-fade': !loadingProfile && !notFound }">
    <template v-if="loadingProfile">
      <!-- 真实容器空态占位：复用 .profile-head（头像 88px）与 .info 容器，
           容器高度加载前后一致，配合内容淡入避免跳变 -->
      <div class="profile-head">
        <div class="sk" style="width: 88px; height: 88px; border-radius: 50%; flex: 0 0 auto"></div>
        <div class="info">
          <div class="sk sk-h22" style="width: 45%; margin-top: 2px"></div>
          <div class="sk sk-h12" style="width: 32%"></div>
          <div class="sk-text sk-w75"></div>
          <div class="sk sk-h10" style="width: 55%"></div>
        </div>
      </div>
      <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 10px">
        <div class="sk sk-h14" style="width: 72px"></div>
        <div class="sk sk-h14" style="width: 72px"></div>
      </div>
      <div class="sk sk-h18 sk-w50"></div>
      <div class="sk sk-card" style="margin-bottom: 14px"></div>
      <div class="sk sk-card" style="margin-bottom: 14px"></div>
    </template>
    <p v-else-if="notFound">{{ lang.t("user.profile.notFound") }}</p>

    <template v-else-if="profile">
      <div class="profile-head">
        <img class="avatar" :src="avatarUrl(profile.avatar)" :alt="displayName(profile)" />
        <div class="info">
          <div class="name-line">
            <h1>{{ displayName(profile) }}</h1>
            <span v-if="profile.role === 'REVOKED'" class="role-badge revoked">{{ lang.t("user.profile.revokedBadge") }}</span>
            <span v-else-if="profile.role === 'ADMIN'" class="role-badge">{{ lang.t("user.profile.adminBadge") }}</span>
          </div>
          <p v-if="profile.nickname && profile.nickname !== displayName(profile)" class="account">@{{ profile.username }}</p>
          <p class="bio">{{ profile.bio || lang.t("user.profile.bioEmpty") }}</p>
          <p class="joined">{{ lang.t("user.profile.joined") }} {{ formatTime(profile.createdAt) }}</p>
        </div>
        <div class="profile-actions">
          <!-- 设为管理员 / 取消管理员：仅站长可见可用；已是管理员的显示“取消” -->
          <button
            v-if="auth.isOwner && !isOwn()"
            class="role-btn"
            :class="{ revoke: profile.role === 'ADMIN' }"
            :disabled="roleBusy"
            @click="onRoleToggle"
          >
            {{ profile.role === "ADMIN" ? lang.t("user.profile.revokeAdmin") : lang.t("user.profile.setAdmin") }}
          </button>
        </div>
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
        <button
          class="tab"
          :class="{ active: activeTab === 'settings' }"
          @click="switchTab('settings')"
        >
          {{ lang.t("user.profile.settings") }}
        </button>
      </div>

      <!-- 设置：编辑资料、修改密码、注销账号 合并在同一卡片，水平居中 -->
      <template v-if="isSettingsTab()">
        <h2 class="section-title">{{ lang.t("user.profile.settings") }}</h2>
        <div class="settings-card">
          <RouterLink class="settings-btn" :to="`/user/${profile.username}/edit`">
            {{ lang.t("user.profile.edit") }}
          </RouterLink>
          <RouterLink class="settings-btn" :to="`/user/${profile.username}/password`">
            {{ lang.t("user.profile.changePassword") }}
          </RouterLink>
          <button class="settings-btn danger" :disabled="deactivating" @click="onDeactivate">
            {{ lang.t("user.profile.deactivate") }}
          </button>
        </div>
      </template>

      <template v-else-if="isSubmissionTab()">
        <h2 class="section-title">{{ lang.t("user.profile.submissions") }}（{{ proposals.length }}）</h2>
        <p v-if="loadingProposals" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="proposals.length === 0" class="hint">{{ lang.t("user.profile.noProposals") }}</p>
        <div v-else class="proposal-list">
          <div v-for="p in pagedProposals" :key="p.id" class="proposal-item">
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
              <span v-if="p.kind === 'DEL' && p.reason" class="prop-reject">{{ lang.t("proposal.deleteReason") }}：{{ p.reason }}</span>
              <span v-else-if="p.rejectReason" class="prop-reject">{{ lang.t("proposal.rejectReason") }}：{{ p.rejectReason }}</span>
            </div>
            <div class="prop-actions">
              <button v-if="p.kind === 'DEL'" class="prop-btn" @click="redoReview(p)">
                {{ lang.t("proposal.redoReview") }}
              </button>
              <button v-else-if="p.status === 'PENDING'" class="prop-btn" @click="editProposal(p)">
                {{ lang.t("proposal.edit") }}
              </button>
              <button v-else-if="p.status === 'REJECTED'" class="prop-btn" @click="reapply(p)">
                {{ lang.t("proposal.reapply") }}
              </button>
              <button class="prop-btn prop-delete" :disabled="deletingProposalId === p.id" @click="removeProposal(p)">
                {{ lang.t("common.delete") }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="proposalPageCount > 1" class="pager">
          <button :disabled="proposalPage <= 1" @click="goProposalPage(proposalPage - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ proposalPage }} / {{ proposalPageCount }}</span>
          <button :disabled="proposalPage >= proposalPageCount" @click="goProposalPage(proposalPage + 1)">{{ lang.t("common.next") }}</button>
        </div>
      </template>

      <template v-else>
        <h2 class="section-title">
          {{ isDraftTab() ? lang.t("user.profile.drafts", { n: total }) : lang.t(isOwn() ? "user.profile.reviewsOwn" : "user.profile.reviews", { n: total }) }}
        </h2>

        <p v-if="loadingReviews" class="hint">{{ lang.t("loading") }}</p>
        <p v-else-if="reviews.length === 0" class="hint">
          {{ isDraftTab() ? lang.t("user.profile.noDrafts") : lang.t("user.profile.noReviews") }}
        </p>
        <div v-else-if="!isDraftTab()" class="ranking-list">
          <RouterLink v-for="(r, idx) in reviews" :key="r.id" class="ranking-item" :to="`/reviews/${r.id}`">
            <span class="rank-no">{{ r.authorRank ?? idx + 1 }}</span>
            <img class="rank-cover" :class="{ loaded: isCoverLoaded(r.id) }" :src="coverOf(r)" :alt="gameDisplayName(r, lang.isEn)" loading="lazy" @load="onCoverLoad(r.id)" />
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

/* 加载完成时高度已被空态容器锁定，仅做一次柔和淡入，避免内容替换时的生硬跳变 */
.profile-page.content-fade {
  animation: profile-content-fade 0.28s ease;
}
@keyframes profile-content-fade {
  from { opacity: 0; }
  to { opacity: 1; }
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
  margin-top: 4px;
  margin-bottom: 2px;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* 管理员身份徽章：绿色背景 */
.role-badge {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--success);
  padding: 2px 9px;
  border-radius: 999px;
  white-space: nowrap;
  line-height: 1.4;
}

/* 已注销徽章：灰色背景 */
.role-badge.revoked {
  background: var(--text-3);
}

.bio {
  color: var(--text-1);
  margin: 0;
}

/* 设置卡片：编辑资料 / 修改密码 / 注销账号 合并在同一卡片，按钮垂直排列并居中 */
.settings-card {
  display: flex;
  flex-direction: column; /* 三个按钮垂直排列 */
  align-items: center;    /* 水平居中 */
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}
.settings-btn {
  width: 20%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-1);
  text-decoration: none;
  font-size: 15px;
  cursor: pointer;
}
.settings-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.settings-btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.settings-btn.danger:hover {
  background: var(--danger-bg);
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

/* 右侧操作区：编辑资料、修改密码、设为/取消管理员 竖排靠右 */
.profile-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  flex-shrink: 0;
}
.psw-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-1);
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
}
.psw-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.role-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}
.role-btn:hover {
  background: var(--primary);
  color: #fff;
}
.role-btn.revoke {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}
.role-btn.revoke:hover {
  background: var(--danger);
  color: #fff;
}
.role-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
  padding: 10px 14px; /* 垂直方向增大至原约 1.5 倍，抬高整项高度 */
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
.rank-no {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  font-size: 28px;
  font-weight: 800;
  color: var(--text-3);
  display: flex;
  align-items: center;    /* 垂直居中 */
  justify-content: center; /* 水平居中 */
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 0;
}
.rank-cover {
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--surface-2);
  opacity: 0; /* 加载完毕后才淡入显示，与游戏库封面同款 */
  transition: opacity 0.5s ease;
}
.rank-cover.loaded {
  opacity: 1;
}
.rank-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank-game {
  font-size: 22px;
  font-weight: 600;
  padding-bottom: 12px;
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
  justify-content: space-between;
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
.prop-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
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
.prop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.prop-btn.prop-delete {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}
.prop-btn.prop-delete:hover {
  background: var(--danger);
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