<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createGame, updateGame, fetchGame } from "@/api/game";
import { uploadImage } from "@/api/review";
import { extractError } from "@/api/request";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const router = useRouter();
const lang = useLangStore();

// 编辑模式：路由带 :id
const isEdit = computed(() => Boolean(route.params.id));

const form = ref({
  nameZh: "",
  nameEn: "",
  score: null,
  developer: "",
  publisher: "",
  description: "",
  tagsText: "",
  coverImageUrl: "",
});
const error = ref("");
const saving = ref(false);
const uploading = ref(false);
const loadingGame = ref(false);
const notFound = ref(false);
const coverInput = ref(null);

function cover(url) {
  if (url) return url;
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="18" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>'
  );
}

// 编辑模式下加载现有数据
async function loadGame() {
  if (!isEdit.value) return;
  loadingGame.value = true;
  notFound.value = false;
  try {
    const data = await fetchGame(route.params.id, { pageSize: 1 });
    const g = data.game;
    form.value = {
      nameZh: g.nameZh || "",
      nameEn: g.nameEn || "",
      score: g.score ?? "",
      developer: g.developer || "",
      publisher: g.publisher || "",
      description: g.description || "",
      tagsText: Array.isArray(g.tags) ? g.tags.join(", ") : "",
      coverImageUrl: g.coverImageUrl || "",
    };
  } catch {
    notFound.value = true;
  } finally {
    loadingGame.value = false;
  }
}

async function onPickCover(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    form.value.coverImageUrl = await uploadImage(file);
  } catch (err) {
    error.value = extractError(err, lang.t("game.new.coverUploadFailed"));
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}

async function save() {
  error.value = "";
  const nameZh = form.value.nameZh.trim();
  if (!nameZh) return (error.value = lang.t("game.new.nameRequired"));
  const score = form.value.score === "" || form.value.score === null ? null : Number(form.value.score);
  if (score !== null && (Number.isNaN(score) || score < 0 || score > 10)) {
    return (error.value = lang.t("game.new.scoreInvalid"));
  }

  const tags = form.value.tagsText
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const payload = {
    nameZh,
    nameEn: form.value.nameEn.trim() || undefined,
    score: score ?? undefined,
    developer: form.value.developer.trim() || undefined,
    publisher: form.value.publisher.trim() || undefined,
    description: form.value.description.trim(),
    tags,
    coverImageUrl: form.value.coverImageUrl || undefined,
  };

  saving.value = true;
  try {
    if (isEdit.value) {
      const updated = await updateGame(route.params.id, payload);
      router.push(`/game/${updated.id}`);
    } else {
      const game = await createGame(payload);
      router.push(`/game/${game.id}`);
    }
  } catch (err) {
    error.value = extractError(err, isEdit.value ? lang.t("game.editor.updateFailed") : lang.t("game.new.nameFailed"));
    saving.value = false;
  }
}

onMounted(loadGame);
</script>

<template>
  <div class="new-game">
    <h1>{{ isEdit ? lang.t("game.editor.editTitle") : lang.t("game.new.title") }}</h1>

    <p v-if="loadingGame" class="hint">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound" class="hint">{{ lang.t("game.detail.notFound") }}</p>

    <form v-else class="form" @submit.prevent="save">
      <div class="cover-row">
        <img class="cover" :src="cover(form.coverImageUrl)" alt="cover" />
        <button type="button" class="upload-btn" :disabled="uploading" @click="coverInput.click()">
          {{ uploading ? lang.t("game.new.uploading") : lang.t("game.new.cover") }}
        </button>
        <input ref="coverInput" type="file" accept="image/*" hidden @change="onPickCover" />
      </div>

      <label>{{ lang.t("game.new.nameZh") }} <span class="req">*</span>
        <input v-model="form.nameZh" :placeholder="lang.t('game.new.nameZhPlaceholder')" />
      </label>

      <label>{{ lang.t("game.new.nameEn") }}
        <input v-model="form.nameEn" :placeholder="lang.t('game.new.nameEnPlaceholder')" />
      </label>

      <label>{{ lang.t("game.new.score") }}
        <input v-model="form.score" type="number" min="0" max="10" step="0.1" placeholder="0-10" />
      </label>

      <div class="row">
        <label>{{ lang.t("game.new.developer") }}
          <input v-model="form.developer" placeholder="FromSoftware" />
        </label>
        <label>{{ lang.t("game.new.publisher") }}
          <input v-model="form.publisher" placeholder="Bandai Namco" />
        </label>
      </div>

      <label>{{ lang.t("game.new.tags") }}
        <input v-model="form.tagsText" :placeholder="lang.t('game.new.tags')" />
      </label>

      <label>{{ lang.t("game.new.desc") }}
        <textarea v-model="form.description" rows="5" :placeholder="lang.t('game.new.descPlaceholder')"></textarea>
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? lang.t("common.saving") : lang.t("common.save") }}
        </button>
        <RouterLink class="cancel" :to="isEdit ? `/game/${route.params.id}` : '/games'">
          {{ lang.t("common.cancel") }}
        </RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.new-game {
  max-width: 600px;
  margin: 0 auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.cover-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.cover {
  width: 180px;
  height: 112px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
}

.upload-btn {
  padding: 8px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.upload-btn:disabled {
  opacity: 0.6;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: #374151;
}

.row {
  display: flex;
  gap: 12px;
}

.row label {
  flex: 1;
}

.req {
  color: #dc2626;
}

input,
textarea {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.err {
  color: #dc2626;
  font-size: 14px;
  margin: 0;
}

.hint {
  color: #6b7280;
  text-align: center;
  padding: 30px 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.primary {
  padding: 10px 22px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.6;
}

.cancel {
  color: #6b7280;
  text-decoration: none;
}
</style>