<script setup>
import { onMounted, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";
import { fetchUserByUsername, updateProfile } from "@/api/user";
import { uploadImage } from "@/api/review";
import { extractError } from "@/api/request";
import { markReviewsDirty } from "@/utils/dirtySignal";
import ImageCropper from "@/components/ImageCropper.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

const targetUsername = () => route.params.username;

const form = ref({ username: "", nickname: "", avatar: "", bio: "" });
const error = ref("");
const saving = ref(false);
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

// —— 头像裁剪：复用通用 ImageCropper 组件 ——
const cropOpen = ref(false);
let pendingFile = null;

// 用户框选文件：交给裁剪面板；确认后再上传裁出的圆形头像
function onPickAvatar(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  pendingFile = file;
  cropOpen.value = true;
}

// 裁剪面板确认后拿到裁好的头像图，走常规上传
async function onCropBlob(blob) {
  try {
    const file = new File([blob], "avatar.png", { type: blob.type || "image/png" });
    form.value.avatar = await uploadImage(file);
  } catch (err) {
    error.value = extractError(err, lang.t("user.edit.avatarUploadFailed"));
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
    await auth.refresh(); // 同步登录态信息
    markReviewsDirty();
    // 整页导航到个人主页，强制导航栏、个人主页等所有页面重新加载最新资料，
    // 避免 SPA 局部跳转时各处仍用旧缓存（旧昵称 / 旧头像）。
    window.location.assign(`/user/${targetUsername()}`);
  } catch (err) {
    error.value = extractError(err, lang.t("user.edit.saveFailed"));
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  // 权限校验：仅本人可编辑资料
  if (!auth.isLoggedIn || auth.user?.username !== targetUsername()) {
    router.replace(`/user/${targetUsername()}`);
    return;
  }
  try {
    const u = await fetchUserByUsername(targetUsername());
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
      <div class="edit-all">
        <div class="info-row">
          <div class="avatar-row">
            <SmartImg class="avatar" :src="avatarUrl(form.avatar)" alt="avatar" />
            <button type="button" class="upload-btn" @click="avatarInput.click()">
              {{ lang.t("user.edit.avatar") }}
            </button>
            <input ref="avatarInput" type="file" accept="image/*" hidden @change="onPickAvatar" />
          </div>
          <div class="name-info-row">
            <label>{{ lang.t("user.edit.nickname") }}
              <input v-model="form.nickname" maxlength="20" :placeholder="lang.t('user.edit.nicknamePlaceholder')" />
            </label>
            <label>{{ lang.t("user.edit.username") }}
              <input v-model="form.username" disabled />
            </label>
          </div>
        </div>

        <div class="brief">
          <label>{{ lang.t("user.edit.bio") }}
            <textarea v-model="form.bio" rows="4" maxlength="200" :placeholder="lang.t('user.edit.placeholder')"></textarea>
          </label>
        </div>
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <RouterLink class="cancel" :to="`/user/${targetUsername()}`">{{ lang.t("common.cancel") }}</RouterLink>
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? lang.t("common.saving") : lang.t("common.save") }}
        </button>
      </div>
    </form>

    <!-- 头像裁剪：选择图片后弹出面板，裁剪成圆形头像（复用通用组件） -->
    <ImageCropper
      v-model:open="cropOpen"
      :src="pendingFile"
      shape="circle"
      :aspect-ratio="1"
      :output-size="256"
      :title="lang.t('user.edit.cropTitle')"
      :hint="lang.t('user.edit.cropHint')"
      :confirm-text="lang.t('user.edit.cropConfirm')"
      :cancel-text="lang.t('common.cancel')"
      @confirm="onCropBlob"
    />
  </div>
</template>

<style scoped>
.edit-page {
  max-width: 500px;
  margin: 0 auto;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin-top: 16px;
  background: var(--surface);
  padding: 18px;
  border-radius: 20px;
}

.edit-all {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-row {
  display: flex;
  flex-direction: row;
  gap: 28px;
}

.avatar-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-left: auto;
}

.name-info-row {
  min-width: 300px;
  margin-left: auto;
  flex-direction: column;
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
  margin-top: 3px;
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
  margin-left: auto;
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