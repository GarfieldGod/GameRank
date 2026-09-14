<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createReview, updateReview, fetchReview, uploadImage } from "@/api/review";
import { renderMarkdown } from "@/utils/markdown";
import { extractError } from "@/api/request";
import { useLangStore } from "@/stores/lang";

const route = useRoute();
const router = useRouter();
const lang = useLangStore();

const isEdit = computed(() => Boolean(route.params.id));

const form = reactive({
  gameName: "",
  title: "",
  content: "",
  rating: 5,
  tagsText: "",
  coverImageUrl: "",
});
const error = ref("");
const loading = ref(false);
const notFound = ref(false);
const uploading = ref(false);
const coverInput = ref(null);

const previewHtml = computed(() => renderMarkdown(form.content));

function parseTags() {
  return form.tagsText
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function submit() {
  error.value = "";
  if (!form.gameName.trim() || !form.title.trim() || !form.content.trim()) {
    error.value = lang.t("review.editor.required");
    return;
  }
  const rating = Number(form.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    error.value = lang.t("review.editor.ratingInvalid");
    return;
  }

  const payload = {
    gameName: form.gameName.trim(),
    title: form.title.trim(),
    content: form.content,
    rating,
    tags: parseTags(),
    coverImageUrl: form.coverImageUrl || undefined,
  };

  loading.value = true;
  try {
    if (isEdit.value) {
      await updateReview(route.params.id, payload);
    } else {
      await createReview(payload);
    }
    router.push("/reviews");
  } catch (err) {
    error.value = extractError(err, isEdit.value ? lang.t("review.editor.updateFailed") : lang.t("review.editor.publishFailed"));
  } finally {
    loading.value = false;
  }
}

async function onPickCover(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    form.coverImageUrl = await uploadImage(file);
  } catch (err) {
    error.value = extractError(err, lang.t("review.editor.coverUploadFailed"));
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}

onMounted(async () => {
  if (!isEdit.value) return;
  try {
    const r = await fetchReview(route.params.id);
    form.gameName = r.gameName;
    form.title = r.title;
    form.content = r.content;
    form.rating = r.rating;
    form.tagsText = r.tags.join(",");
    form.coverImageUrl = r.coverImageUrl || "";
  } catch {
    notFound.value = true;
  }
});
</script>

<template>
  <div class="editor-page">
    <h1>{{ isEdit ? lang.t("review.editor.editTitle") : lang.t("review.editor.newTitle") }}</h1>
    <p v-if="notFound">{{ lang.t("review.editor.newTitle") }}</p>

    <form v-else class="editor" @submit.prevent="submit">
      <div class="row">
        <label>{{ lang.t("review.editor.gameName") }}
          <input v-model="form.gameName" :placeholder="lang.t('review.editor.gameNamePlaceholder')" />
        </label>
        <label>{{ lang.t("review.editor.rating") }}
          <input v-model.number="form.rating" type="number" min="1" max="10" step="1" />
        </label>
      </div>

      <label>{{ lang.t("review.editor.title") }}
        <input v-model="form.title" :placeholder="lang.t('review.editor.titlePlaceholder')" />
      </label>

      <label>{{ lang.t("review.editor.tags") }}
        <input v-model="form.tagsText" :placeholder="lang.t('review.editor.tagsPlaceholder')" />
      </label>

      <div class="cover-block">
        <button type="button" class="upload-btn" :disabled="uploading" @click="coverInput.click()">
          {{ uploading ? lang.t("game.new.uploading") : form.coverImageUrl ? lang.t("review.editor.changeCover") : lang.t("review.editor.coverClick") }}
        </button>
        <input ref="coverInput" type="file" accept="image/*" hidden @change="onPickCover" />
        <img v-if="form.coverImageUrl" class="preview-img" :src="form.coverImageUrl" alt="cover" />
      </div>

      <div class="md-area">
        <div class="md-pane">
          <div class="pane-title">{{ lang.t("review.editor.content") }}</div>
          <textarea v-model="form.content" rows="16" placeholder="# 标题&#10;正文…"></textarea>
        </div>
        <div class="md-pane">
          <div class="pane-title">{{ lang.t("review.editor.preview") }}</div>
          <div class="md-preview" v-html="previewHtml"></div>
        </div>
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <button class="primary" type="submit" :disabled="loading">
          {{ loading ? lang.t("common.saving") : isEdit ? lang.t("review.editor.saveChange") : lang.t("review.editor.publish") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.editor-page {
  max-width: 760px;
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
}

.row label {
  flex: 1;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: #374151;
}

input {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.cover-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.upload-btn {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.upload-btn:disabled {
  opacity: 0.6;
}

.preview-img {
  max-width: 280px;
  max-height: 160px;
  border-radius: 8px;
  object-fit: cover;
}

.md-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.md-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.pane-title {
  padding: 8px 12px;
  font-size: 13px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  color: #6b7280;
}

textarea {
  flex: 1;
  border: none;
  outline: none;
  padding: 12px;
  resize: vertical;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
}

.md-preview {
  padding: 12px;
  min-height: 200px;
  overflow-y: auto;
}

.err {
  color: #dc2626;
  font-size: 14px;
}

.actions .primary {
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
</style>

<style>
.md-preview {
  line-height: 1.7;
}
.md-preview h1,
.md-preview h2,
.md-preview h3 {
  margin: 0.8em 0 0.4em;
}
.md-preview p {
  margin: 0.4em 0;
}
.md-preview code {
  background: #f3f4f6;
  padding: 2px 5px;
  border-radius: 4px;
}
</style>