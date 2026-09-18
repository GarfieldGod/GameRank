<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";
import { fetchUser, updateProfile } from "@/api/user";
import { uploadImage } from "@/api/review";
import { extractError } from "@/api/request";
import { markReviewsDirty } from "@/utils/dirtySignal";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

const targetUserId = () => Number(route.params.userId);

const form = ref({ username: "", nickname: "", avatar: "", bio: "" });
const error = ref("");
const saving = ref(false);
const uploading = ref(false);
const loading = ref(true);

const avatarInput = ref(null);

function avatarUrl(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const fill = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="${fg}" font-size="64" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>`
  );
}

async function onPickAvatar(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    form.value.avatar = await uploadImage(file);
  } catch (err) {
    error.value = extractError(err, lang.t("user.edit.avatarUploadFailed"));
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}

async function save() {
  error.value = "";
  const nick = form.value.nickname.trim();
  if (nick && (nick.length < 3 || nick.length > 20)) {
    return (error.value = lang.t("user.edit.nicknameInvalid"));
  }
  saving.value = true;
  try {
    await updateProfile({ nickname: form.value.nickname, avatar: form.value.avatar, bio: form.value.bio });
    await auth.refresh(); // 同步导航栏等处的登录用户信息
    markReviewsDirty();
    router.push(`/user/${targetUserId()}`);
  } catch (err) {
    error.value = extractError(err, lang.t("user.edit.saveFailed"));
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  // 权限校验：仅本人可编辑资料
  if (!auth.isLoggedIn || auth.user?.id !== targetUserId()) {
    router.replace(`/user/${targetUserId()}`);
    return;
  }
  try {
    const u = await fetchUser(targetUserId());
    form.value = { username: u.username, nickname: u.nickname || "", avatar: u.avatar || "", bio: u.bio || "" };
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="edit-page">
    <h1>{{ lang.t("user.edit.title") }}</h1>

    <form v-if="!loading" class="edit-form" @submit.prevent="save">
      <div class="avatar-row">
        <img class="avatar" :src="avatarUrl(form.avatar)" alt="avatar" />
        <button type="button" class="upload-btn" :disabled="uploading" @click="avatarInput.click()">
          {{ uploading ? lang.t("game.new.uploading") : lang.t("user.edit.avatar") }}
        </button>
        <input ref="avatarInput" type="file" accept="image/*" hidden @change="onPickAvatar" />
      </div>

      <label>{{ lang.t("user.edit.username") }}
        <input v-model="form.username" disabled />
      </label>

      <label>{{ lang.t("user.edit.nickname") }}
        <input v-model="form.nickname" maxlength="20" :placeholder="lang.t('user.edit.nicknamePlaceholder')" />
      </label>

      <label>{{ lang.t("user.edit.bio") }}
        <textarea v-model="form.bio" rows="4" maxlength="200" :placeholder="lang.t('user.edit.placeholder')"></textarea>
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? lang.t("common.saving") : lang.t("common.save") }}
        </button>
        <RouterLink class="cancel" :to="`/user/${targetUserId()}`">{{ lang.t("common.cancel") }}</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
.edit-page {
  max-width: 520px;
  margin: 0 auto;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border);
}

.upload-btn {
  padding: 8px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
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
  color: var(--text-1);
}

input,
textarea {
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text-1);
}

input:disabled {
  background: var(--surface-2);
  color: var(--text-3);
}

.err {
  color: var(--danger);
  font-size: 14px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.primary {
  padding: 10px 22px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.6;
}

.cancel {
  color: var(--text-2);
  text-decoration: none;
}
</style>