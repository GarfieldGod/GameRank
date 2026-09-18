<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { createReview, updateReview, fetchReview } from "@/api/review";
import { fetchGames } from "@/api/game";
import { renderMarkdown } from "@/utils/markdown";
import { ASPECTS, aspectColor, aspectLabel } from "@/utils/aspects";
import { extractError } from "@/api/request";
import { useLangStore } from "@/stores/lang";
import { markReviewsDirty } from "@/utils/dirtySignal";

const route = useRoute();
const router = useRouter();
const lang = useLangStore();

const isEdit = computed(() => Boolean(route.params.id));

// 分项评分折叠：默认收起，需勾选“启用分项评分”才展开
const showAspects = ref(false);

// 未保存/脏内容守卫：离开或关闭页面时，若必填项内有内容则提示
const showLeaveDialog = ref(false);
let suppressLeave = false;
let leaveNext = null;
const hasContent = computed(() =>
  Boolean(form.gameName.trim() || (form.brief || "").trim() || form.content.trim())
);

onBeforeRouteLeave((_to, _from, next) => {
  if (suppressLeave) {
    suppressLeave = false;
    return next();
  }
  if (!hasContent.value) return next();
  leaveNext = next;
  showLeaveDialog.value = true;
});

const onBeforeUnload = (e) => {
  if (!hasContent.value || suppressLeave) return;
  e.preventDefault();
  e.returnValue = "";
};

async function saveDraftForLeave() {
  if (!form.gameName.trim()) {
    error.value = lang.t("review.editor.draftRequired");
    return;
  }
  loading.value = true;
  try {
    if (isEdit.value) {
      await updateReview(route.params.id, buildPayload("DRAFT"));
    } else {
      await createReview(buildPayload("DRAFT"));
    }
    showLeaveDialog.value = false;
    if (leaveNext) leaveNext();
  } catch (err) {
    error.value = extractError(err, lang.t("review.editor.draftFailed"));
  } finally {
    loading.value = false;
  }
}

function discardAndLeave() {
  showLeaveDialog.value = false;
  if (leaveNext) leaveNext();
}

function cancelLeave() {
  showLeaveDialog.value = false;
  leaveNext = null;
}

const form = reactive({
  gameName: "",
  brief: "",
  content: "",
});

const items = ref([{ aspect: "gameplay", content: "", score: 0, weight: 100 }]);
const error = ref("");
const loading = ref(false);
const notFound = ref(false);
const sliderEl = ref(null);

// 游戏名联想
const suggestions = ref([]);
const showMenu = ref(false);
const menuActive = ref(-1);
let searchTimer = null;

// 草稿保存提示
const draftSaved = ref(false);

const previewHtml = computed(() => renderMarkdown(form.content));

// 供某个分项：该方向是否已被其他分项占用（用于下拉禁用）
function aspectDisabled(key, cur) {
  return items.value.some((x) => x !== cur && x.aspect === key);
}
const unusedAspects = computed(() => ASPECTS.filter((a) => !items.value.some((it) => it.aspect === a.key)));
const nextAspect = computed(() => unusedAspects.value[0] || null);

// 分项综合分：Σ(分数×权重) / Σ权重（保留 1 位小数，0-10）
const aspectOverall = computed(() => {
  const list = items.value;
  if (!list.length) return 0;
  let num = 0;
  let den = 0;
  for (const it of list) {
    const s = Number(it.score) || 0;
    const w = Number(it.weight) || 0;
    num += s * w;
    den += w;
  }
  return den ? Math.round((num / den) * 10) / 10 : 0;
});

// 勾选分项评分时自动计算综合得分；未勾选时由用户手动输入分数（不可输入区域）
const manualScore = ref(0);
const overall = computed(() => (showAspects.value ? aspectOverall.value : manualScore.value));

// 权重滑条：把各项相对权重缩放为整数百分比且总和为 100
function renorm() {
  const n = items.value.length;
  if (!n) return;
  const total = items.value.reduce((s, it) => s + it.weight, 0) || 1;
  let scaled = items.value.map((it) => Math.max(1, (it.weight / total) * 100));
  const floors = scaled.map(Math.floor);
  let used = floors.reduce((s, v) => s + v, 0);
  const diff = Math.round(100 - used);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const arr = [...floors];
  for (let k = 0; k < diff; k++) arr[order[k % order.length].i] += 1;
  let sum = arr.reduce((s, v) => s + v, 0);
  if (sum !== 100) {
    const d = 100 - sum;
    for (let i = 0; i < Math.abs(d); i++) arr[i % n] += d > 0 ? 1 : -1;
  }
  items.value.forEach((it, i) => (it.weight = Math.max(1, arr[i])));
}

// 平均权重：按分项数量均分，和为 100
function equalizeWeights() {
  const n = items.value.length;
  if (!n) return;
  const base = Math.floor(100 / n);
  const arr = Array(n).fill(base);
  for (let i = 1, rem = 100 - base * n; i < n && rem > 0; i++) {
    arr[i] += 1;
    rem--;
  }
  items.value.forEach((it, i) => (it.weight = Math.max(1, arr[i])));
}

// 滑条分段与手柄位置
const segGeom = computed(() => {
  let cum = 0;
  return items.value.map((it) => {
    const left = cum;
    cum += it.weight;
    return { left, right: cum, weight: it.weight, key: it.aspect };
  });
});
const handleGeom = computed(() => {
  const g = segGeom.value;
  return g.slice(0, -1).map((s, i) => ({ left: s.right, index: i }));
});

const drag = ref(null); // { index, startX, w0, w1 }
function startDrag(i, ev) {
  ev.preventDefault();
  drag.value = { index: i, startX: ev.clientX, w0: items.value[i].weight, w1: items.value[i + 1].weight };
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", endDrag);
}
function onDrag(ev) {
  if (!drag.value) return;
  const { index, startX, w0, w1 } = drag.value;
  const rect = sliderEl.value?.getBoundingClientRect();
  const delta = rect?.width ? ((ev.clientX - startX) / rect.width) * 100 : 0;
  const total = w0 + w1;
  const MIN = 5;
  let nw0 = Math.round(Math.min(Math.max(w0 + delta, MIN), total - MIN));
  items.value[index].weight = nw0;
  items.value[index + 1].weight = total - nw0;
}
function endDrag() {
  drag.value = null;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", endDrag);
}

function addAspect() {
  const a = nextAspect.value;
  if (!a) return;
  items.value.push({ aspect: a.key, content: "", score: 0, weight: 10 });
  renorm();
}
function removeAspect(i) {
  items.value.splice(i, 1);
  if (!items.value.length) {
    items.value.push({ aspect: "gameplay", content: "", score: 0, weight: 100 });
  renorm();} else {
    renorm();
  }
}

// 游戏名实时联想（400ms 防抖）
function onGameInput() {
  draftSaved.value = false;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(lookupGame, 400);
}
async function lookupGame() {
  const kw = form.gameName.trim();
  if (!kw) {
    suggestions.value = [];
    showMenu.value = false;
    return;
  }
  try {
    const data = await fetchGames({ keyword: kw, pageSize: 8 });
    suggestions.value = Array.isArray(data?.list) ? data.list : [];
    showMenu.value = suggestions.value.length > 0;
  } catch {
    suggestions.value = [];
    showMenu.value = false;
  }
}
function pickGame(g) {
  form.gameName = lang.isEn ? (g.nameEn || g.nameZh || "") : (g.nameZh || g.nameEn || "");
  showMenu.value = false;
  menuActive.value = -1;
}
function onMenuKeydown(e) {
  if (!showMenu.value && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    menuActive.value = (menuActive.value + 1) % suggestions.value.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    menuActive.value = (menuActive.value - 1 + suggestions.value.length) % suggestions.value.length;
  } else if (e.key === "Enter" && menuActive.value >= 0) {
    e.preventDefault();
    pickGame(suggestions.value[menuActive.value]);
  } else if (e.key === "Escape") {
    showMenu.value = false;
    menuActive.value = -1;
  }
}

function buildPayload(status) {
  const ratingParams = showAspects.value
    ? items.value.map((it) => ({
        aspect: it.aspect,
        content: (it.content || "").trim(),
        score: Number(it.score),
        weight: Number(it.weight),
      }))
    : [];
  return {
    gameName: form.gameName.trim(),
    brief: (form.brief || "").trim(),
    content: form.content,
    rating: overall.value,
    ratingParams,
    status,
  };
}

async function submit() {
  error.value = "";
  if (!form.gameName.trim() || !form.content.trim()) {
    error.value = lang.t("review.editor.required");
    return;
  }
  if (!items.value.length) {
    error.value = lang.t("review.editor.noAspects");
    return;
  }
  if (!showAspects.value) {
    const ms = Number(manualScore.value);
    if (!Number.isFinite(ms) || ms < 0 || ms > 10) {
      error.value = lang.t("review.editor.scoreInvalid");
      return;
    }
  }
  const ratingParams = items.value.map((it) => ({
    aspect: it.aspect,
    content: (it.content || "").trim(),
    score: Number(it.score),
    weight: Number(it.weight),
  }));
  for (const p of ratingParams) {
    if (!Number.isInteger(p.score) || p.score < 0 || p.score > 10) {
      error.value = lang.t("review.editor.scoreInvalid");
      return;
    }
  }

  loading.value = true;
  draftSaved.value = false;
  try {
    if (isEdit.value) {
      await updateReview(route.params.id, buildPayload("PUBLISHED"));
      markReviewsDirty();
      suppressLeave = true;
      router.push("/reviews");
    } else {
      await publishNew(false);
    }
  } catch (err) {
    error.value = extractError(err, isEdit.value ? lang.t("review.editor.updateFailed") : lang.t("review.editor.publishFailed"));
  } finally {
    loading.value = false;
  }
}

// 同一用户对同一游戏只能有一篇评测：发布时若已存在，回 409 提示覆盖
const showOverwrite = ref(false);
function cancelOverwrite() {
  showOverwrite.value = false;
}
function confirmOverwrite() {
  showOverwrite.value = false;
  loading.value = true;
  publishNew(true).catch((err) => {
    error.value = extractError(err, lang.t("review.editor.publishFailed"));
    loading.value = false;
  });
}
async function publishNew(force) {
  try {
    await createReview({ ...buildPayload("PUBLISHED"), force });
    markReviewsDirty();
    suppressLeave = true;
    router.push("/reviews");
  } catch (err) {
    if (!force && err?.response?.data?.code === "REVIEW_EXISTS") {
      showOverwrite.value = true;
      return;
    }
    throw err;
  }
}

async function saveDraft() {
  error.value = "";
  if (!form.gameName.trim()) {
    error.value = lang.t("review.editor.draftRequired");
    return;
  }
  loading.value = true;
  try {
    if (isEdit.value) {
      await updateReview(route.params.id, buildPayload("DRAFT"));
      draftSaved.value = true;
    } else {
      const created = await createReview(buildPayload("DRAFT"));
      router.replace(`/reviews/${created.id}/edit`);
      draftSaved.value = true;
    }
    suppressLeave = true;
  } catch (err) {
    error.value = extractError(err, lang.t("review.editor.draftFailed"));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (isEdit.value) {
    try {
      const r = await fetchReview(route.params.id);
      form.gameName = r.gameName;
      form.brief = r.brief || "";
      form.content = r.content;
      if (Array.isArray(r.ratingParams) && r.ratingParams.length) {
        showAspects.value = true;
        items.value = r.ratingParams.map((p) => ({
          aspect: p.aspect || "gameplay",
          content: p.content || "",
          score: Number(p.score) || 0,
          weight: Number(p.weight) || 0,
        }));
        renorm();
      } else {
        showAspects.value = false;
        manualScore.value = Number(r.rating) || 0;
      }
      // 草稿直接以编辑模式继续
      if (r.status === "DRAFT") draftSaved.value = true;
    } catch {
      notFound.value = true;
    }
  } else if (route.query.game) {
    // 从游戏详情“写评测”进入：预填游戏名（事务里“重新编辑”还会带上原简述）
    form.gameName = String(route.query.game);
    if (route.query.brief) form.brief = String(route.query.brief);
  }
  window.addEventListener("beforeunload", onBeforeUnload);
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  window.removeEventListener("beforeunload", onBeforeUnload);
});
</script>

<template>
  <div class="editor-page">
    <h1>{{ isEdit ? lang.t("review.editor.editTitle") : lang.t("review.editor.newTitle") }}</h1>
    <p v-if="notFound">{{ lang.t("review.editor.newTitle") }}</p>

    <form v-else class="editor" @submit.prevent="submit">
      <div class="basic-block">
      <div class="row">
        <div class="grow editor-title-col">
          <div class="game-input-wrap">
            <span class="field-label">{{ lang.t("review.editor.gameName") }} <span class="req-mark">(<span class="req-text">{{ lang.t("common.required") }}</span><span class="req-star">*</span>)</span></span>
            <input
              v-model="form.gameName"
              :placeholder="lang.t('review.editor.gameNamePlaceholder')"
              @input="onGameInput"
              @focus="onGameInput"
              @keydown="onMenuKeydown"
              @blur="setTimeout(() => (showMenu = false), 150)"
            />
            <ul v-if="showMenu" class="game-menu">
              <li
                v-for="(g, i) in suggestions"
                :key="g.id"
                :class="{ active: i === menuActive }"
                @mousedown.prevent="pickGame(g)"
                @mouseenter="menuActive = i"
              >
                <template v-if="lang.isEn">
                  <span class="gm-zh">{{ g.nameEn || g.nameZh }}</span>
                </template>
                <template v-else>
                  <span class="gm-zh">{{ g.nameZh }}</span>
                  <span class="gm-en">{{ g.nameEn }}</span>
                </template>
              </li>
            </ul>
          </div>
          <label class="titled-field">
            <span class="field-title">{{ lang.t("review.editor.brief") }} <span class="opt-mark">({{ lang.t("common.optional") }})</span></span>
            <input v-model="form.brief" maxlength="50" :placeholder="lang.t('review.editor.briefPlaceholder')" />
          </label>
        </div>
        <div class="score-box">
          <span class="score-title">{{ lang.t("review.editor.score") }} <span class="req-mark">(<span class="req-text">{{ lang.t("common.required") }}</span><span class="req-star">*</span>)</span></span>
          <input
            v-if="!showAspects"
            v-model.number="manualScore"
            class="display-score display-score-input"
            type="number"
            min="0"
            max="10"
            step="0.1"
          />
          <div v-else class="display-score">{{ overall }}</div>
        </div>
      </div>

      </div>

      <!-- 权重滑条 + 分项列表 -->
      <div class="score-block">
        <div class="score-block-title">
          <span>{{ lang.t("review.editor.aspects") }} <span class="opt-mark">({{ lang.t("common.optional") }})</span></span>
          <div class="sb-right">
            <button v-if="showAspects" type="button" class="equal-weight-btn" @click="equalizeWeights">
              {{ lang.t("review.editor.equalWeight") }}
            </button>
            <label class="aspects-toggle">
              <input type="checkbox" v-model="showAspects" :title="lang.t('review.editor.enableAspects')" />
            </label>
          </div>
        </div>

        <div v-if="showAspects" class="aspects-body">

        <div v-if="items.length" class="weight-wrap" ref="sliderEl">
          <div class="slider-labels">
            <div
              v-for="(seg, i) in segGeom"
              :key="'l' + seg.key + i"
              class="sl-label"
              :style="{ width: seg.weight + '%' }"
            >
              <span class="sl-name" :style="{ color: aspectColor(seg.key) }" :title="aspectLabel(seg.key, lang.isEn)">
                {{ aspectLabel(seg.key, lang.isEn) }}
              </span>
              <span class="sl-weight">{{ seg.weight }}%</span>
            </div>
          </div>
          <div class="slider-track">
            <div
              v-for="(seg, i) in segGeom"
              :key="'s' + seg.key + i"
              class="seg"
              :class="{ segFirst: i === 0, segLast: i === segGeom.length - 1 }"
              :style="{ width: seg.weight + '%', background: aspectColor(seg.key) }"
            ></div>
            <button
              v-for="h in handleGeom"
              :key="'h' + h.index"
              type="button"
              class="handle"
              :style="{ left: h.left + '%' }"
              @pointerdown="startDrag(h.index, $event)"
            ></button>
          </div>
        </div>
        <p v-else class="weight-empty">{{ lang.t("review.editor.noAspects") }}</p>
        <p class="weight-hint">{{ lang.t("review.editor.weightHint") }}</p>

        <div class="aspect-list">
          <div v-for="(it, i) in items" :key="i" class="aspect-item">
            <div class="aspect-item-head">
              <span class="aspect-dot" :style="{ background: aspectColor(it.aspect) }"></span>
              <select v-model="it.aspect" class="aspect-select">
                <option v-for="a in ASPECTS" :key="a.key" :value="a.key" :disabled="a.key !== it.aspect && aspectDisabled(a.key, it)">
                  {{ aspectLabel(a.key, lang.isEn) }}
                </option>
              </select>
              <label class="score-field">{{ lang.t("review.editor.aspectScore") }}
                <input v-model.number="it.score" type="number" min="0" max="10" step="1" />
              </label>
              <button type="button" class="remove-btn" title="delete" @click="removeAspect(i)">✕</button>
            </div>
            <textarea v-model="it.content" rows="2" :placeholder="lang.t('review.editor.aspectContent')"></textarea>
          </div>

          <button type="button" class="add-item-btn" :disabled="!nextAspect" @click="addAspect">
            {{ lang.t("review.editor.addAspect") }}
          </button>
        </div>
      </div>
      </div>

      <div class="md-area">
        <div class="md-pane">
          <div class="pane-title">{{ lang.t("review.editor.content") }} <span class="req-mark">(<span class="req-text">{{ lang.t("common.required") }}</span><span class="req-star">*</span>)</span></div>
          <textarea
            v-model="form.content"
            rows="16"
            :placeholder="lang.t('review.editor.contentPlaceholder')"
          ></textarea>
        </div>
        <div class="md-pane">
          <div class="pane-title">{{ lang.t("review.editor.preview") }}</div>
          <div class="md-preview" v-html="previewHtml"></div>
        </div>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-else-if="draftSaved" class="draft-ok">{{ lang.t("review.editor.draftSaved") }}</p>

      <div class="actions">
        <button class="draft" type="button" :disabled="loading" @click="saveDraft">
          {{ lang.t("review.editor.saveDraft") }}
        </button>
        <button class="primary" type="submit" :disabled="loading">
          {{ loading ? lang.t("common.saving") : isEdit ? lang.t("review.editor.saveChange") : lang.t("review.editor.publish") }}
        </button>
      </div>
    </form>

    <div v-if="showLeaveDialog" class="leave-mask">
      <div class="leave-dialog">
        <p class="leave-msg">{{ lang.t("review.editor.leaveMsg") }}</p>
        <div class="leave-actions">
          <button type="button" class="leave-cancel" @click="cancelLeave">{{ lang.t("common.cancel") }}</button>
          <div class="leave-actions-right">
            <button type="button" class="leave-btn leave-discard" @click="discardAndLeave">{{ lang.t("review.editor.discard") }}</button>
            <button type="button" class="leave-btn leave-save" :disabled="loading" @click="saveDraftForLeave">
              {{ lang.t("review.editor.saveDraft") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  <div v-if="showOverwrite" class="leave-mask">
      <div class="leave-dialog">
        <p class="leave-msg">{{ lang.t("review.editor.overwriteConfirm") }}</p>
        <div class="leave-actions" style="justify-content: flex-end;">
          <div class="leave-actions-right">
            <button type="button" class="leave-btn" @click="cancelOverwrite">{{ lang.t("review.editor.cancel") }}</button>
            <button type="button" class="leave-btn leave-save" :disabled="loading" @click="confirmOverwrite">
              {{ lang.t("review.editor.confirmOverwrite") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-page {
  max-width: 860px;
  margin: 0 auto;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.row {
  display: flex;
  gap: 14px;
  align-items: stretch;
}

/* 基本信息块：包裹 标题/游戏/综合得分 + 简评，与分项评分一致的背景面板 */
.basic-block {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--surface-2);
}

.row label.grow {
  flex: 1;
}
.row .grow {
  flex: 1;
  min-width: 0;
}

/* 表单顶部：标题 + 游戏名 纵向排列的左侧列 */
.editor-title-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.titled-field input {
  width: 100%;
  box-sizing: border-box;
}

/* 游戏名联想输入框 */
.game-input-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}

/* 标题/简评的字段标题行：与分项评分标题同字号、不换行 */
.titled-field {
  display: block;
}
.titled-field .field-title {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 6px;
}

/* 必填/可选的小字标注（浅色） */
.req-mark,
.opt-mark {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-3);
  margin-left: 4px;
  white-space: nowrap;
}
.req-mark .req-star {
  color: var(--danger);
}

.inline-label .req-mark,
.inline-label .opt-mark {
  margin-left: 0;
}

.aspect-opt-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
.game-menu {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow);
  max-height: 260px;
  overflow-y: auto;
}
.game-menu li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.game-menu li:hover,
.game-menu li.active {
  background: var(--primary-soft);
}
.gm-zh {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}
.gm-en {
  color: var(--text-2);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--text-1);
}

input,
textarea,
select {
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text-1);
}

/* 隐藏所有数字输入框的上下调节按钮 */
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 综合得分区：标题与左侧「标题」同排，分数框上下对齐标题输入框至游戏输入框 */
.score-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 120px;
}
.score-box .score-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}
.score-box .display-score {
  flex: 1;
  min-width: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  background: var(--warn-bg);
  border: 2px solid var(--warn-border);
  border-radius: 10px;
  color: var(--text-1);
  font-size: 36px;
  font-weight: 800;
}
.score-box .display-score-input {
  display: block;
  text-align: center;
  padding: 0;
  font-size: 36px;
}

/* 分项评分区 */
.score-block {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-2);
}
.score-block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.equal-weight-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.equal-weight-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.sb-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.aspects-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.aspects-toggle input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--primary);
}

/* 权重滑条 */
.weight-wrap {
  user-select: none;
}
.slider-labels {
  display: flex;
  margin-bottom: 4px;
}
.sl-label {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  padding-right: 4px;
}
.sl-name {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.sl-weight {
  font-size: 11px;
  color: var(--text-2);
}
.slider-track {
  position: relative;
  display: flex;
  height: 26px;
  border-radius: 6px;
  overflow: visible;
  background: var(--surface-2);
  cursor: col-resize;
}
.seg {
  height: 100%;
}
.seg.segFirst {
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}
.seg.segLast {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}
.handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 34px;
  border-radius: 4px;
  border: 2px solid var(--surface);
  background: var(--text-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  cursor: col-resize;
  padding: 0;
}
.handle:hover {
  background: var(--text);
}
.weight-empty {
  color: var(--text-3);
  font-size: 13px;
  margin: 0;
}
.weight-hint {
  color: var(--text-3);
  font-size: 12px;
  margin: 12px 0;
  line-height: 1.6;
}

/* 分项列表 */
.aspect-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.aspect-item {
  position: relative;
  border: 1px solid var(--border);
  border-left: 5px solid var(--border-strong);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--surface);
}
.aspect-item-head {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.aspect-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-bottom: 8px;
}
.aspect-select {
  flex: 1;
  min-width: 0;
}
.score-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.score-field input {
  width: 64px;
}
.remove-btn {
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 6px;
  margin-bottom: 4px;
}
.remove-btn:hover {
  background: var(--danger-bg);
  border-radius: 6px;
}
.aspect-item textarea {
  resize: vertical;
}
.add-item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px dashed var(--primary);
  color: var(--primary);
  background: var(--surface);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.add-item-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.md-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.md-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.pane-title {
  padding: 8px 12px;
  font-size: 15px;
  font-weight: 600;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  color: var(--text-1);
}

textarea {
  border: none;
  outline: none;
  padding: 12px;
  resize: vertical;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
  background: var(--surface);
  color: var(--text-1);
}
.md-area textarea {
  border: none;
  min-height: 280px;
}

.md-preview {
  padding: 12px;
  min-height: 220px;
  overflow-y: auto;
}

.err {
  color: var(--danger);
  font-size: 14px;
}
.draft-ok {
  color: var(--success);
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.actions .draft {
  padding: 10px 22px;
  background: var(--surface);
  color: var(--text-1);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  cursor: pointer;
}
.actions .primary {
  padding: 10px 22px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 离开确认对话框 */
.leave-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.leave-dialog {
  width: min(440px, 90vw);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow);
}
.leave-msg {
  margin: 0 0 20px;
  color: var(--text-1);
  font-size: 15px;
  line-height: 1.6;
}
.leave-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.leave-actions-right {
  display: flex;
  gap: 10px;
}
.leave-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-1);
  cursor: pointer;
  font-size: 14px;
}
.leave-cancel {
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: 14px;
}
.leave-discard:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.leave-save {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.leave-save:hover {
  background: var(--primary-hover);
}
.leave-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 700px) {
  .aspect-item-head {
    flex-wrap: wrap;
  }
}
</style>

<style>
.md-preview {
  line-height: 1.7;
}
.md-preview h1,
.md-preview h3 {
  margin: 0.8em 0 0.4em;
}
.md-preview p {
  margin: 0.4em 0;
}
.md-preview code {
  background: var(--surface-2);
  color: var(--text-1);
  padding: 2px 5px;
  border-radius: 4px;
}
</style>