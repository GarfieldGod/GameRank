<script setup>
import { ref } from "vue";
import { exportGames, importGames, exportReviews, importReviews } from "@/api/admin";
import { useLangStore } from "@/stores/lang";
import { extractError } from "@/api/request";

const lang = useLangStore();

// 导入任务的文件选择与状态
const gameFile = ref(null);
const reviewFile = ref(null);
const gameInput = ref(null);
const reviewInput = ref(null);
const busy = ref("");
const msg = ref("");

function pick(e, kind) {
  const f = e.target.files?.[0];
  if (kind === "game") gameFile.value = f;
  else reviewFile.value = f;
}

async function doExport(type) {
  msg.value = "";
  try {
    if (type === "game") {
      await exportGames();
      msg.value = lang.t("admin.exportedGame");
    } else {
      await exportReviews();
      msg.value = lang.t("admin.exportedReview");
    }
  } catch (err) {
    msg.value = lang.t("admin.failed") + "：" + extractError(err, lang.t("admin.failed"));
  }
}

async function doImport(type) {
  const file = type === "game" ? gameFile.value : reviewFile.value;
  if (!file) {
    msg.value = lang.t("admin.pickFile");
    return;
  }
  busy.value = type;
  msg.value = "";
  try {
    const result =
      type === "game" ? await importGames(file) : await importReviews(file);
    msg.value = type === "game"
      ? lang.t("admin.importedGame", result)
      : lang.t("admin.importedReview", result);
    gameFile.value = null;
    reviewFile.value = null;
    if (type === "game" && gameInput.value) gameInput.value.value = "";
    if (type === "review" && reviewInput.value) reviewInput.value.value = "";
  } catch (err) {
    msg.value = lang.t("admin.invalidJson") + "：" + extractError(err, lang.t("admin.invalidJson"));
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div class="admin-page">
    <h1>{{ lang.t("admin.title") }}</h1>
    <p class="muted">{{ lang.t("admin.subtitle") }}</p>

    <div class="cards">
      <!-- 游戏数据 -->
      <section class="card">
        <h2>{{ lang.t("admin.gameData") }}</h2>
        <button class="export-btn" @click="doExport('game')">{{ lang.t("admin.exportGame") }}</button>
        <div class="import-row">
          <label class="pick-btn">
            {{ lang.t("admin.chooseFile") }}
            <input ref="gameInput" type="file" accept="application/json,.json" hidden @change="pick($event, 'game')" />
          </label>
          <span class="file-name">{{ gameFile?.name || "" }}</span>
        </div>
        <button class="import-btn" :disabled="busy === 'game'" @click="doImport('game')">
          {{ lang.t("admin.importGame") }}
        </button>
      </section>

      <!-- 游戏评测 -->
      <section class="card">
        <h2>{{ lang.t("admin.reviewData") }}</h2>
        <button class="export-btn" @click="doExport('review')">{{ lang.t("admin.exportReview") }}</button>
        <div class="import-row">
          <label class="pick-btn">
            {{ lang.t("admin.chooseFile") }}
            <input ref="reviewInput" type="file" accept="application/json,.json" hidden @change="pick($event, 'review')" />
          </label>
          <span class="file-name">{{ reviewFile?.name || "" }}</span>
        </div>
        <button class="import-btn" :disabled="busy === 'review'" @click="doImport('review')">
          {{ lang.t("admin.importReview") }}
        </button>
      </section>
    </div>

    <p v-if="msg" class="result-msg">{{ msg }}</p>
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
  color: #6b7280;
  margin: 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 18px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card h2 {
  margin: 0;
  font-size: 17px;
}

.export-btn {
  padding: 10px;
  border: 1px solid #2563eb;
  border-radius: 8px;
  background: #fff;
  color: #2563eb;
  font-size: 14px;
  cursor: pointer;
}

.export-btn:hover {
  background: #eff6ff;
}

.import-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pick-btn {
  padding: 8px 14px;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  color: #374151;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.pick-btn:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.file-name {
  font-size: 13px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-btn {
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #059669;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.import-btn:hover {
  background: #047857;
}

.import-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.result-msg {
  color: #374151;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
}
</style>