<script setup>
import { computed, onMounted, ref } from "vue";
import { fetchUsers } from "@/api/user";
import { fetchPendingProposals, approveProposal, rejectProposal } from "@/api/proposal";
import { fetchDeleted, restoreItem, purgeItem } from "@/api/admin";
import { displayName, useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { extractError } from "@/api/request";

const lang = useLangStore();
const auth = useAuthStore();

// 站长与管理员都可进入；站长额外拥有导入导出与管理页与管理员名单
const isOwner = computed(() => auth.isOwner);

// 用户列表：按角色分为管理员 / 普通用户
const users = ref([]);
const loadUserError = ref("");
const admins = computed(() => users.value.filter((u) => u.role === "ADMIN"));
const normalUsers = computed(() => users.value.filter((u) => u.role !== "ADMIN" && u.role !== "OWNER"));

async function loadUsers() {
  try {
    users.value = await fetchUsers();
  } catch (err) {
    loadUserError.value = extractError(err, lang.t("admin.failed"));
  }
}

// 待审核申请（新增 + 编辑）
const proposals = ref([]);
const pendingError = ref("");

async function loadProposals() {
  try {
    proposals.value = await fetchPendingProposals();
  } catch (err) {
    pendingError.value = extractError(err, lang.t("admin.failed"));
  }
}

const pendingAdd = computed(() => proposals.value.filter((p) => p.kind === "ADD"));
const pendingEdit = computed(() => proposals.value.filter((p) => p.kind === "EDIT"));

// 申请展示名称：新增取申请数据名，编辑取目标游戏名
function propName(p) {
  if (p.kind === "ADD") return p.data?.nameZh || p.game?.nameZh || "";
  return p.game?.nameZh || p.data?.nameZh || "";
}
function propRoute(p) {
  return p.gameId ? `/game/${p.gameId}` : null;
}
function propCover(p) {
  return p.game?.coverImageUrl || p.data?.coverImageUrl || "";
}
function proposerName(p) {
  return displayName(p.proposer);
}

async function onApprove(p) {
  try {
    await approveProposal(p.id);
    proposals.value = proposals.value.filter((x) => x.id !== p.id);
  } catch (err) {
    pendingError.value = extractError(err, lang.t("admin.failed"));
  }
}

async function onReject(p) {
  if (!window.confirm(lang.t("admin.rejectConfirm"))) return;
  const reason = window.prompt(lang.t("admin.rejectReasonLabel"), "") || "";
  try {
    await rejectProposal(p.id, reason.trim() || undefined);
    proposals.value = proposals.value.filter((x) => x.id !== p.id);
  } catch (err) {
    pendingError.value = extractError(err, lang.t("admin.failed"));
  }
}

// 软删除（不可见）的游戏与评测：站长可恢复可见或真正删除
const deletedGames = ref([]);
const deletedReviews = ref([]);
const deletedError = ref("");
const deletingId = ref("");

async function loadDeleted() {
  if (!isOwner.value) return;
  try {
    const data = await fetchDeleted();
    deletedGames.value = data.games || [];
    deletedReviews.value = data.reviews || [];
  } catch (err) {
    deletedError.value = extractError(err, lang.t("admin.failed"));
  }
}

async function onRestore(kind, id) {
  if (!window.confirm(lang.t("admin.restoreConfirm"))) return;
  deletingId.value = `${kind}-${id}`;
  try {
    await restoreItem(kind, id);
    if (kind === "game") deletedGames.value = deletedGames.value.filter((g) => g.id !== id);
    else deletedReviews.value = deletedReviews.value.filter((r) => r.id !== id);
  } catch (err) {
    alert(err?.response?.data?.error || lang.t("admin.failed"));
  } finally {
    deletingId.value = "";
  }
}

async function onPurge(kind, id) {
  if (!window.confirm(lang.t("admin.purgeConfirm"))) return;
  deletingId.value = `${kind}-${id}`;
  try {
    await purgeItem(kind, id);
    if (kind === "game") deletedGames.value = deletedGames.value.filter((g) => g.id !== id);
    else deletedReviews.value = deletedReviews.value.filter((r) => r.id !== id);
  } catch (err) {
    alert(err?.response?.data?.error || lang.t("admin.failed"));
  } finally {
    deletingId.value = "";
  }
}

onMounted(() => {
  loadUsers();
  loadProposals();
  loadDeleted();
});
</script>

<template>
  <div class="admin-page">
    <h1>{{ lang.t("admin.title") }}</h1>
    <p class="muted">{{ lang.t("admin.subtitle") }}</p>

    <!-- 待审核新增游戏：站长与管理员均可审批 -->
    <section class="user-card">
      <h2>{{ lang.t("admin.pending") }}（{{ pendingAdd.length }}）</h2>
      <p v-if="pendingError" class="result-msg">{{ pendingError }}</p>
      <p v-if="pendingAdd.length === 0" class="empty-hint">{{ lang.t("admin.noPending") }}</p>
      <ul v-else class="user-list">
        <li v-for="p in pendingAdd" :key="p.id" class="user-row proposal-row">
          <img v-if="propCover(p)" class="u-avatar" :src="propCover(p)" alt="" />
          <span v-else class="u-avatar placeholder">{{ (propName(p) || "?")[0] }}</span>
          <div class="u-info">
            <span class="u-name">{{ propName(p) }}</span>
            <span class="u-account">{{ lang.t("admin.proposalBy", { name: proposerName(p) }) }}</span>
          </div>
          <div class="proposal-actions">
            <RouterLink v-if="propRoute(p)" class="detail-link" :to="propRoute(p)">{{ lang.t("admin.enterDetail") }}</RouterLink>
            <button class="approve-btn" @click="onApprove(p)">{{ lang.t("admin.approve") }}</button>
            <button class="reject-btn" @click="onReject(p)">{{ lang.t("admin.reject") }}</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 待审核编辑申请：站长与管理员均可审批 -->
    <section class="user-card">
      <h2>{{ lang.t("admin.pendingEdit") }}（{{ pendingEdit.length }}）</h2>
      <p v-if="pendingEdit.length === 0" class="empty-hint">{{ lang.t("admin.noPendingEdit") }}</p>
      <ul v-else class="user-list">
        <li v-for="p in pendingEdit" :key="p.id" class="user-row proposal-row">
          <img v-if="propCover(p)" class="u-avatar" :src="propCover(p)" alt="" />
          <span v-else class="u-avatar placeholder">{{ (propName(p) || "?")[0] }}</span>
          <div class="u-info">
            <RouterLink v-if="propRoute(p)" class="u-name link" :to="propRoute(p)">{{ propName(p) }}</RouterLink>
            <span v-else class="u-name">{{ propName(p) }}</span>
            <span class="u-account">{{ lang.t("admin.proposalBy", { name: proposerName(p) }) }}</span>
            <span v-if="p.data?.nameZh && p.data.nameZh !== propName(p)" class="u-detail">
              {{ lang.t("proposal.proposedName") }}：{{ p.data.nameZh }}
            </span>
            <span v-if="p.reason" class="u-detail">{{ p.reason }}</span>
          </div>
          <div class="proposal-actions">
            <button class="approve-btn" @click="onApprove(p)">{{ lang.t("admin.approve") }}</button>
            <button class="reject-btn" @click="onReject(p)">{{ lang.t("admin.reject") }}</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 待审核的不可见列表（软删除的游戏与评测）：仅站长可恢复或真正删除 -->
    <template v-if="isOwner">
      <section class="user-card">
        <h2>{{ lang.t("admin.deletedList") }}（{{ deletedGames.length + deletedReviews.length }}）</h2>
        <p v-if="deletedError" class="result-msg">{{ deletedError }}</p>
        <p v-if="deletedGames.length === 0 && deletedReviews.length === 0" class="empty-hint">
          {{ lang.t("admin.noDeleted") }}
        </p>

        <div v-if="deletedGames.length" class="deleted-group">
          <h3 class="deleted-type">{{ lang.t("admin.deletedGames") }}（{{ deletedGames.length }}）</h3>
          <ul class="user-list">
            <li v-for="g in deletedGames" :key="'g' + g.id" class="user-row proposal-row">
              <img v-if="g.coverImageUrl" class="u-avatar" :src="g.coverImageUrl" alt="" />
              <span v-else class="u-avatar placeholder">{{ (g.nameZh || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name">{{ g.nameZh }}</span>
                <span class="u-account">{{ g.nameEn }}</span>
              </div>
              <div class="proposal-actions">
                <button class="approve-btn" :disabled="deletingId === `game-${g.id}`" @click="onRestore('game', g.id)">
                  {{ lang.t("admin.restore") }}
                </button>
                <button class="purge-btn" :disabled="deletingId === `game-${g.id}`" @click="onPurge('game', g.id)">
                  {{ lang.t("admin.purge") }}
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="deletedReviews.length" class="deleted-group">
          <h3 class="deleted-type">{{ lang.t("admin.deletedReviews") }}（{{ deletedReviews.length }}）</h3>
          <ul class="user-list">
            <li v-for="r in deletedReviews" :key="'r' + r.id" class="user-row proposal-row">
              <span class="u-avatar placeholder">{{ (r.title || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name">{{ r.title }}</span>
                <span class="u-account">{{ lang.t("admin.proposalBy", { name: r.author?.username || "" }) }}</span>
                <span v-if="r.gameName" class="u-detail">{{ r.gameName }}</span>
              </div>
              <div class="proposal-actions">
                <button class="approve-btn" :disabled="deletingId === `review-${r.id}`" @click="onRestore('review', r.id)">
                  {{ lang.t("admin.restore") }}
                </button>
                <button class="purge-btn" :disabled="deletingId === `review-${r.id}`" @click="onPurge('review', r.id)">
                  {{ lang.t("admin.purge") }}
                </button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <div class="user-sections">
      <template v-if="isOwner">
        <section class="user-card">
          <h2>{{ lang.t("admin.adminList") }}（{{ admins.length }}）</h2>
          <p v-if="loadUserError" class="result-msg">{{ loadUserError }}</p>
          <ul class="user-list">
            <li v-for="u in admins" :key="u.id" class="user-row">
              <RouterLink class="u-link" :to="`/user/${u.id}`">
                <img v-if="u.avatar" class="u-avatar" :src="u.avatar" alt="" />
                <span v-else class="u-avatar placeholder">{{ (displayName(u) || "?")[0] }}</span>
                <div class="u-info">
                  <span class="u-name">{{ displayName(u) }}</span>
                  <span class="u-account">@{{ u.username }}</span>
                </div>
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>

      <section class="user-card">
        <h2>{{ lang.t("admin.userList") }}（{{ normalUsers.length }}）</h2>
        <ul class="user-list">
          <li v-for="u in normalUsers" :key="u.id" class="user-row">
            <RouterLink class="u-link" :to="`/user/${u.id}`">
              <img v-if="u.avatar" class="u-avatar" :src="u.avatar" alt="" />
              <span v-else class="u-avatar placeholder">{{ (displayName(u) || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name">{{ displayName(u) }}</span>
                <span class="u-account">@{{ u.username }}</span>
              </div>
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
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

.result-msg {
  color: var(--text-1);
  background: var(--surface-2);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
}

.user-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.user-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  background: var(--surface);
}
.user-card h2 {
  margin: 0 0 12px;
  font-size: 17px;
  color: var(--text);
}
.user-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-2);
}
.u-link {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  text-decoration: none;
  color: inherit;
  padding: 2px;
  border-radius: 6px;
}
.u-link:hover {
  background: var(--hover);
}
.u-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface);
}
.u-avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--text-2);
}
.u-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.u-name {
  font-weight: 600;
  color: var(--text);
}
.u-name.link {
  color: var(--primary);
  text-decoration: none;
}
.u-name.link:hover {
  text-decoration: underline;
}
.u-detail {
  color: var(--text-2);
  font-size: 13px;
}
.u-account {
  font-size: 13px;
  color: var(--text-3);
}
.empty-hint {
  color: var(--text-2);
  font-size: 14px;
  margin: 6px 0;
}
.proposal-row {
  gap: 12px;
}
.proposal-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  align-items: center;
}
.detail-link {
  font-size: 13px;
  color: var(--primary);
  text-decoration: none;
  white-space: nowrap;
  padding: 6px 12px;
  border: 1px solid var(--primary);
  border-radius: 6px;
}
.detail-link:hover {
  background: var(--primary-soft);
}
.approve-btn,
.reject-btn,
.purge-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  cursor: pointer;
}
.approve-btn {
  background: var(--primary);
  color: #fff;
}
.approve-btn:hover {
  background: var(--primary-hover);
}
.reject-btn {
  background: var(--surface);
  color: var(--danger);
  border: 1px solid var(--danger);
}
.reject-btn:hover {
  background: var(--danger-bg);
}
.purge-btn {
  background: var(--surface);
  color: var(--danger);
  border: 1px solid var(--danger);
}
.purge-btn:hover {
  background: var(--danger);
  color: #fff;
}
.deleted-group + .deleted-group {
  margin-top: 14px;
}
.deleted-type {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-2);
  font-weight: 600;
}
</style>