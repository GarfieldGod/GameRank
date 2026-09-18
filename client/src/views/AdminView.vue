<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { fetchUsers, setUserRole } from "@/api/user";
import { fetchPendingProposals, approveProposal, rejectProposal } from "@/api/proposal";
import { fetchDeleted, restoreItem, purgeItem, deleteUser } from "@/api/admin";
import { displayName, useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { extractError } from "@/api/request";
import { markGamesDirty, markReviewsDirty } from "@/utils/dirtySignal";

const lang = useLangStore();
const auth = useAuthStore();

// 站长与管理员都可进入；站长额外拥有导入导出与管理页与管理员名单
const isOwner = computed(() => auth.isOwner);

// 用户列表搜索：复用游戏库搜索框交互（输入过滤、叉号清除）
const searchKeyword = ref("");
function matchesKeyword(u) {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return true;
  return displayName(u).toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw);
}
function clearSearch() {
  searchKeyword.value = "";
}

// 用户列表：按角色分为管理员 / 普通用户（搜索后过滤），均按最近活跃时间降序（新登录在前）
const users = ref([]);
const loadUserError = ref("");
// 在线用户按最近活跃并列排前；离线也按上次在线时间排；从未活跃的排最后
function byActive(a, b) {
  const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : -Infinity;
  const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : -Infinity;
  return tb - ta;
}
const allAdmins = computed(() => users.value.filter((u) => u.role === "ADMIN"));
const allNormalUsers = computed(() => users.value.filter((u) => u.role !== "ADMIN" && u.role !== "OWNER"));
const admins = computed(() => allAdmins.value.filter(matchesKeyword).slice().sort(byActive));
const normalUsers = computed(() => allNormalUsers.value.filter(matchesKeyword).slice().sort(byActive));
// 上次在线时间格式化
function formatTime(t) {
  return new Date(t).toLocaleString(lang.isEn ? "en-US" : "zh-CN");
}

// 分页：管理员每页 10，普通用户每页 20；不足整页不显示翻页
const adminPageSize = 10;
const userPageSize = 20;
const adminPage = ref(1);
const userPage = ref(1);
const adminPageCount = computed(() => Math.max(1, Math.ceil(admins.value.length / adminPageSize)));
const userPageCount = computed(() => Math.max(1, Math.ceil(normalUsers.value.length / userPageSize)));
const pagedAdmins = computed(() =>
  admins.value.slice((adminPage.value - 1) * adminPageSize, adminPage.value * adminPageSize)
);
const pagedNormalUsers = computed(() =>
  normalUsers.value.slice((userPage.value - 1) * userPageSize, userPage.value * userPageSize)
);
function goAdminPage(p) {
  adminPage.value = Math.min(adminPageCount.value, Math.max(1, p));
}
function goUserPage(p) {
  userPage.value = Math.min(userPageCount.value, Math.max(1, p));
}
// 数据变更（如彻底删除用户）后人数变少时收敛页码，避免停留在空页
watch(adminPageCount, (c) => {
  if (adminPage.value > c) adminPage.value = c;
});
watch(userPageCount, (c) => {
  if (userPage.value > c) userPage.value = c;
});
// 搜索关键词变化时回到第 1 页
watch(searchKeyword, () => {
  adminPage.value = 1;
  userPage.value = 1;
});

// 彻底删除已注销用户：仅站长可见可用（服务端 ownerOnly + role==REVOKED 二次校验）
const deletingUserId = ref(null);
async function onDeleteUser(u) {
  if (!window.confirm(lang.t("admin.purgeUserConfirm", { name: displayName(u) }))) return;
  deletingUserId.value = u.id;
  try {
    await deleteUser(u.id);
    await loadUsers();
  } catch (err) {
    loadUserError.value = extractError(err, lang.t("admin.failed"));
  } finally {
    deletingUserId.value = null;
  }
}

let loadingUsers = false;
async function loadUsers() {
  if (loadingUsers) return;
  loadingUsers = true;
  try {
    users.value = await fetchUsers();
  } catch (err) {
    loadUserError.value = extractError(err, lang.t("admin.failed"));
  } finally {
    loadingUsers = false;
  }
}

// 在线判定：最近活跃时间距今不足 ONLINE_TTL 视为在线（与心跳间隔 30s 匹配，容错一次心跳）
const ONLINE_TTL = 60000;
function isOnline(u) {
  return !!u?.lastActiveAt && Date.now() - new Date(u.lastActiveAt).getTime() < ONLINE_TTL;
}

// 管理页停留时周期刷新各用户最近活跃时间，让在线圆点保持较实时（不解构分页/分组）
let onlineTimer = null;
function startOnlinePoll() {
  stopOnlinePoll();
  onlineTimer = setInterval(async () => {
    if (loadingUsers) return;
    try {
      const fresh = await fetchUsers();
      const acts = new Map(fresh.map((f) => [f.id, f.lastActiveAt]));
      for (const u of users.value) {
        if (acts.has(u.id)) u.lastActiveAt = acts.get(u.id);
      }
    } catch {
      // 轮询失败静默忽略，等待下次
    }
  }, 20000);
}
function stopOnlinePoll() {
  if (onlineTimer) {
    clearInterval(onlineTimer);
    onlineTimer = null;
  }
}

// 设为管理员 / 取消管理员：仅站长可见可用（服务端 ownerOnly 二次校验）
const roleBusy = ref("");
async function onSetRole(u, role) {
  const isAdmin = role === "ADMIN";
  const name = displayName(u);
  const key = isAdmin ? "user.profile.setAdminConfirm" : "user.profile.revokeAdminConfirm";
  if (!window.confirm(lang.t(key, { name }))) return;
  roleBusy.value = `${u.id}-${role}`;
  try {
    await setUserRole(u.id, role);
    await loadUsers();
  } catch (err) {
    loadUserError.value = extractError(err, lang.t("admin.roleFailed"));
  } finally {
    roleBusy.value = "";
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
// 库封面图：logo → 详情封面 → 背景（与游戏库卡片同款优先级）
function libCover(game, data) {
  return (
    game?.logoImageUrl || game?.coverImageUrl || game?.heroImageUrl ||
    data?.logoImageUrl || data?.coverImageUrl || data?.heroImageUrl ||
    ""
  );
}
function propCover(p) {
  return libCover(p.game, p.data);
}
function proposerName(p) {
  return displayName(p.proposer);
}
// 执行软删除的管理员展示名（昵称回退账号）
function operatorName(u) {
  return u?.nickname || u?.username || "";
}

async function onApprove(p) {
  try {
    await approveProposal(p.id);
    markGamesDirty();
    // 审批通过可能触发评测重映射（ADD 恢复同名游戏关联）或改动游戏封面/名称（EDIT），
    // 一并标记评测脏，让评测库 KeepAlive 缓存刷新，避免旧封面/旧跳转残留
    markReviewsDirty();
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
    if (kind === "game") markGamesDirty();
    else markReviewsDirty();
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
    if (kind === "game") markGamesDirty();
    else markReviewsDirty();
  } catch (err) {
    alert(err?.response?.data?.error || lang.t("admin.failed"));
  } finally {
    deletingId.value = "";
  }
}

// 通用分页：从列表数据源取出当前页子集（每页 pageSize 条）
function usePaged(listRef, pageSize) {
  const page = ref(1);
  const count = computed(() => Math.max(1, Math.ceil(listRef.value.length / pageSize)));
  const paged = computed(() =>
    listRef.value.slice((page.value - 1) * pageSize, page.value * pageSize)
  );
  watch(count, () => {
    if (page.value > count.value) page.value = count.value;
  });
  function go(p) {
    page.value = Math.min(count.value, Math.max(1, p));
  }
  // reactive 包裹以解包内部 ref/computed，模板中可直接用 paged/count/page（无需 .value）
  return reactive({ page, count, paged, go });
}

// 三个审核区的列表分页（每页 10）：待审核新增 / 待审核编辑 / 不可见列表
const addPage = usePaged(pendingAdd, 10);
const editPage = usePaged(pendingEdit, 10);
const delGamePage = usePaged(deletedGames, 10);
const delReviewPage = usePaged(deletedReviews, 10);

onMounted(() => {
  loadUsers();
  loadProposals();
  loadDeleted();
  startOnlinePoll();
});
onBeforeUnmount(stopOnlinePoll);
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
        <li v-for="p in addPage.paged" :key="p.id" class="user-row proposal-row">
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
      <div v-if="addPage.count > 1" class="pager">
        <button :disabled="addPage.page <= 1" @click="addPage.go(addPage.page - 1)">{{ lang.t("common.prev") }}</button>
        <span>{{ addPage.page }} / {{ addPage.count }}</span>
        <button :disabled="addPage.page >= addPage.count" @click="addPage.go(addPage.page + 1)">{{ lang.t("common.next") }}</button>
      </div>
    </section>

    <!-- 待审核编辑申请：站长与管理员均可审批 -->
    <section class="user-card">
      <h2>{{ lang.t("admin.pendingEdit") }}（{{ pendingEdit.length }}）</h2>
      <p v-if="pendingEdit.length === 0" class="empty-hint">{{ lang.t("admin.noPendingEdit") }}</p>
      <ul v-else class="user-list">
        <li v-for="p in editPage.paged" :key="p.id" class="user-row proposal-row">
          <img v-if="propCover(p)" class="u-avatar" :src="propCover(p)" alt="" />
          <span v-else class="u-avatar placeholder">{{ (propName(p) || "?")[0] }}</span>
          <div class="u-info">
            <RouterLink v-if="propRoute(p)" class="u-name link" :to="propRoute(p)">{{ propName(p) }}</RouterLink>
            <span v-else class="u-name">{{ propName(p) }}</span>
            <span class="u-account">
              {{ lang.t("admin.proposalBy", { name: proposerName(p) }) }}
              <span v-if="p.reason" class="u-reason">{{ p.reason }}</span>
            </span>
          </div>
          <div class="proposal-actions">
            <RouterLink v-if="propRoute(p)" class="detail-link" :to="`${propRoute(p)}?preview=${p.id}`">{{ lang.t("admin.preview") }}</RouterLink>
            <button class="approve-btn" @click="onApprove(p)">{{ lang.t("admin.approve") }}</button>
            <button class="reject-btn" @click="onReject(p)">{{ lang.t("admin.reject") }}</button>
          </div>
        </li>
      </ul>
      <div v-if="editPage.count > 1" class="pager">
        <button :disabled="editPage.page <= 1" @click="editPage.go(editPage.page - 1)">{{ lang.t("common.prev") }}</button>
        <span>{{ editPage.page }} / {{ editPage.count }}</span>
        <button :disabled="editPage.page >= editPage.count" @click="editPage.go(editPage.page + 1)">{{ lang.t("common.next") }}</button>
      </div>
    </section>

    <!-- 待审核的不可见列表（软删除的游戏与评测）：站长与管理员可查看；仅站长可恢复或真正删除 -->
    <section class="user-card">
      <h2>{{ lang.t("admin.deletedList") }}（{{ deletedGames.length + deletedReviews.length }}）</h2>
        <p v-if="deletedError" class="result-msg">{{ deletedError }}</p>
        <p v-if="deletedGames.length === 0 && deletedReviews.length === 0" class="empty-hint">
          {{ lang.t("admin.noDeleted") }}
        </p>

        <div v-if="deletedGames.length" class="deleted-group">
          <h3 class="deleted-type">{{ lang.t("admin.deletedGames") }}（{{ deletedGames.length }}）</h3>
          <ul class="user-list">
            <li v-for="g in delGamePage.paged" :key="'g' + g.id" class="user-row proposal-row">
              <img v-if="libCover(g)" class="u-avatar" :src="libCover(g)" alt="" />
              <span v-else class="u-avatar placeholder">{{ (g.nameZh || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name">{{ g.nameZh || g.nameEn }}<em v-if="g.nameEn && g.nameZh" class="sub-name">{{ g.nameEn }}</em></span>
                <span class="u-account del-meta">
                  <em v-if="g.deletedBy" class="operator">{{ lang.t("admin.deletedBy", { name: operatorName(g.deletedBy) }) }}</em>
                  <em v-if="g.deleteReason" class="del-reason" :title="g.deleteReason">{{ g.deleteReason }}</em>
                </span>
              </div>
              <div class="proposal-actions">
                <RouterLink class="detail-link" :to="`/game/${g.id}?preview=deleted`">{{ lang.t("admin.preview") }}</RouterLink>
                <button class="approve-btn" :disabled="deletingId === `game-${g.id}`" @click="onRestore('game', g.id)">
                  {{ lang.t("admin.restore") }}
                </button>
                <template v-if="isOwner">
                  <button class="purge-btn" :disabled="deletingId === `game-${g.id}`" @click="onPurge('game', g.id)">
                    {{ lang.t("admin.purge") }}
                  </button>
                </template>
              </div>
            </li>
          </ul>
          <div v-if="delGamePage.count > 1" class="pager">
            <button :disabled="delGamePage.page <= 1" @click="delGamePage.go(delGamePage.page - 1)">{{ lang.t("common.prev") }}</button>
            <span>{{ delGamePage.page }} / {{ delGamePage.count }}</span>
            <button :disabled="delGamePage.page >= delGamePage.count" @click="delGamePage.go(delGamePage.page + 1)">{{ lang.t("common.next") }}</button>
          </div>
        </div>

        <div v-if="deletedReviews.length" class="deleted-group">
          <h3 class="deleted-type">{{ lang.t("admin.deletedReviews") }}（{{ deletedReviews.length }}）</h3>
          <ul class="user-list">
            <li v-for="r in delReviewPage.paged" :key="'r' + r.id" class="user-row proposal-row">
              <img v-if="libCover(r.game) || r.coverImageUrl" class="u-avatar" :src="libCover(r.game) || r.coverImageUrl" alt="" />
              <span v-else class="u-avatar placeholder">{{ (r.gameName || r.title || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name">{{ r.gameName || r.title }}<em class="operator">{{ lang.t("admin.reviewAuthor", { name: r.author?.nickname || r.author?.username || "" }) }}</em><em v-if="r.brief" class="brief">{{ r.brief }}</em></span>
                <span class="u-account">{{ r.title }}</span>
                <span class="u-detail">
                  <em v-if="r.deletedBy" class="operator">{{ lang.t("admin.deletedBy", { name: operatorName(r.deletedBy) }) }}</em>
                  <em v-if="r.deleteReason" class="del-reason" :title="r.deleteReason">{{ r.deleteReason }}</em>
                </span>
              </div>
              <div class="proposal-actions">
                <RouterLink class="detail-link" :to="`/reviews/${r.id}?preview=deleted`">{{ lang.t("admin.preview") }}</RouterLink>
                <button class="approve-btn" :disabled="deletingId === `review-${r.id}`" @click="onRestore('review', r.id)">
                  {{ lang.t("admin.restore") }}
                </button>
                <template v-if="isOwner">
                  <button class="purge-btn" :disabled="deletingId === `review-${r.id}`" @click="onPurge('review', r.id)">
                    {{ lang.t("admin.purge") }}
                  </button>
                </template>
              </div>
            </li>
          </ul>
          <div v-if="delReviewPage.count > 1" class="pager">
            <button :disabled="delReviewPage.page <= 1" @click="delReviewPage.go(delReviewPage.page - 1)">{{ lang.t("common.prev") }}</button>
            <span>{{ delReviewPage.page }} / {{ delReviewPage.count }}</span>
            <button :disabled="delReviewPage.page >= delReviewPage.count" @click="delReviewPage.go(delReviewPage.page + 1)">{{ lang.t("common.next") }}</button>
          </div>
        </div>
      </section>

    <!-- 用户列表：搜索框、管理员列表、用户列表合并到同一卡片，垂直排列 -->
    <section class="user-card">
      <!-- 搜索框：复用游戏库交互（输入过滤、叉号清除） -->
      <div class="search-bar">
        <div class="search-input">
          <input v-model="searchKeyword" :placeholder="lang.t('admin.searchUsers')" />
          <button
            v-if="searchKeyword"
            class="search-clear"
            @click="clearSearch"
            :aria-label="lang.t('admin.clearSearch')"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <p v-if="loadUserError" class="result-msg">{{ loadUserError }}</p>

      <!-- 管理员列表：站长与管理员可查看；仅站长可取消管理员 -->
      <div class="user-group">
        <h2>{{ lang.t("admin.adminList") }}（{{ admins.length }}）</h2>
        <ul class="user-list">
          <li v-for="u in pagedAdmins" :key="u.id" class="user-row">
            <RouterLink class="u-link" :to="`/user/${u.username}`">
              <img v-if="u.avatar" class="u-avatar" :src="u.avatar" alt="" />
              <span v-else class="u-avatar placeholder">{{ (displayName(u) || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name-line">
                  <span class="status-dot" :class="isOnline(u) ? 'on' : 'off'" :title="isOnline(u) ? lang.t('admin.online') : lang.t('admin.offline')"></span>
                  <span class="u-name">{{ displayName(u) }}</span>
                </span>
                <span class="u-account">@{{ u.username }}<em v-if="!isOnline(u) && u.lastActiveAt" class="last-active">{{ lang.t("admin.lastActive", { t: formatTime(u.lastActiveAt) }) }}</em></span>
              </div>
            </RouterLink>
            <div v-if="isOwner" class="proposal-actions">
              <button
                class="reject-btn"
                :disabled="roleBusy === `${u.id}-USER`"
                @click="onSetRole(u, 'USER')"
              >
                {{ lang.t("admin.revokeAdmin") }}
              </button>
            </div>
          </li>
        </ul>
        <div v-if="adminPageCount > 1" class="pager">
          <button :disabled="adminPage <= 1" @click="goAdminPage(adminPage - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ adminPage }} / {{ adminPageCount }}</span>
          <button :disabled="adminPage >= adminPageCount" @click="goAdminPage(adminPage + 1)">{{ lang.t("common.next") }}</button>
        </div>
      </div>

      <!-- 用户列表：站长可设为管理员，管理员不可见 -->
      <div class="user-group">
        <h2>{{ lang.t("admin.userList") }}（{{ normalUsers.length }}）</h2>
        <ul class="user-list">
          <li v-for="u in pagedNormalUsers" :key="u.id" class="user-row">
            <RouterLink class="u-link" :to="`/user/${u.username}`">
              <img v-if="u.avatar" class="u-avatar" :src="u.avatar" alt="" />
              <span v-else class="u-avatar placeholder">{{ (displayName(u) || "?")[0] }}</span>
              <div class="u-info">
                <span class="u-name-line">
                  <span class="status-dot" :class="isOnline(u) ? 'on' : 'off'" :title="isOnline(u) ? lang.t('admin.online') : lang.t('admin.offline')"></span>
                  <span class="u-name">{{ displayName(u) }}</span>
                </span>
                <span class="u-account">@{{ u.username }}<em v-if="!isOnline(u) && u.lastActiveAt" class="last-active">{{ lang.t("admin.lastActive", { t: formatTime(u.lastActiveAt) }) }}</em></span>
              </div>
            </RouterLink>
            <!-- 已注销：彻底删除（仅站长）；否则：设为管理员（仅站长） -->
            <div v-if="isOwner" class="proposal-actions">
              <button
                v-if="u.role === 'REVOKED'"
                class="purge-btn"
                :disabled="deletingUserId === u.id"
                @click="onDeleteUser(u)"
              >
                {{ lang.t("admin.purgeUser") }}
              </button>
              <button
                v-else
                class="approve-btn"
                :disabled="roleBusy === `${u.id}-ADMIN`"
                @click="onSetRole(u, 'ADMIN')"
              >
                {{ lang.t("admin.setAdmin") }}
              </button>
            </div>
          </li>
        </ul>
        <div v-if="userPageCount > 1" class="pager">
          <button :disabled="userPage <= 1" @click="goUserPage(userPage - 1)">{{ lang.t("common.prev") }}</button>
          <span>{{ userPage }} / {{ userPageCount }}</span>
          <button :disabled="userPage >= userPageCount" @click="goUserPage(userPage + 1)">{{ lang.t("common.next") }}</button>
        </div>
      </div>
    </section>
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

/* 用户列表搜索栏：与游戏库搜索框同款交互 */
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

.result-msg {
  color: var(--text-1);
  background: var(--surface-2);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
  margin-bottom: 16px;
}

.user-group + .user-group {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
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
/* 用户名行：在线圆点 + 用户名 左对齐垂直居中 */
.u-name-line {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
/* 在线状态圆点：绿色=在线，灰色=离线 */
.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}
.status-dot.on {
  background: var(--success);
}
.status-dot.off {
  background: var(--text-3);
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
.u-reason {
  color: var(--warn-text);
  font-size: 13px;
  background: var(--warn-bg);
  padding: 1px 8px;
  border-radius: 6px;
  margin-left: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.u-account {
  font-size: 13px;
  color: var(--text-3);
}
/* 离线用户的“上次在线”标注：账号右侧 */
.last-active {
  font-style: normal;
  margin-left: 8px;
  color: var(--text-3);
  font-size: 12px;
}
/* 操作者标注：不可见列表中的“审批者：xxx” */
.operator {
  font-style: normal;
  margin-left: 8px;
  color: var(--text-2);
  font-size: 12px;
}
/* 删除标签行：首个标签与左侧游戏名对齐（无前缀缩进） */
.u-detail > :first-child,
.del-meta > :first-child {
  margin-left: 0;
}
/* 不可见列表的删除原因标签：显示在游戏名/评测游戏名右侧 */
.del-reason {
  font-style: normal;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
  font-weight: 500;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
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
.approve-btn:disabled,
.reject-btn:disabled,
.purge-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.approve-btn:disabled:hover {
  background: var(--primary);
}
.reject-btn:disabled:hover,
.purge-btn:disabled:hover {
  background: var(--surface);
  color: var(--danger);
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
/* 次要名（英文名）：主名右侧，弱化显示 */
.sub-name {
  font-style: normal;
  margin-left: 6px;
  font-weight: 500;
  color: var(--text-2);
  font-size: 13px;
}
/* 评测简述：游戏名右侧 */
.brief {
  font-style: normal;
  margin-left: 8px;
  font-weight: 500;
  color: var(--text-2);
  font-size: 12px;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
</style>