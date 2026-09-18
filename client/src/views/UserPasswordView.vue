<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { changePassword } from "@/api/user";
import { extractError } from "@/api/request";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

const targetUsername = () => route.params.username;

const form = ref({ currentPassword: "", newPassword: "", confirm: "" });
const error = ref("");
const saving = ref(false);

async function save() {
  error.value = "";
  const p = form.value.newPassword;
  if (p.length < 6) {
    error.value = lang.t("user.password.newTooShort");
    return;
  }
  if (p !== form.value.confirm) {
    error.value = lang.t("user.password.confirmMismatch");
    return;
  }
  saving.value = true;
  try {
    await changePassword({ currentPassword: form.value.currentPassword, newPassword: p });
    window.alert(lang.t("user.password.success"));
    auth.logout(); // 修改密码后需重新登录
    router.replace({ name: "login", query: { redirect: `/user/${targetUsername()}` } });
  } catch (err) {
    error.value = extractError(err, lang.t("user.password.failed"));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  if (!auth.isLoggedIn || auth.user?.username !== targetUsername()) {
    router.replace(`/user/${targetUsername()}`);
  }
});
</script>

<template>
  <div class="password-page">
    <h1>{{ lang.t("user.password.title") }}</h1>

    <form class="password-form" @submit.prevent="save">
      <label>{{ lang.t("user.password.current") }}
        <input
          v-model="form.currentPassword"
          type="password"
          :placeholder="lang.t('user.password.currentPlaceholder')"
          autocomplete="current-password"
        />
      </label>

      <label>{{ lang.t("user.password.new") }}
        <input
          v-model="form.newPassword"
          type="password"
          :placeholder="lang.t('user.password.newPlaceholder')"
          autocomplete="new-password"
        />
      </label>

      <label>{{ lang.t("user.password.confirm") }}
        <input
          v-model="form.confirm"
          type="password"
          :placeholder="lang.t('user.password.confirm')"
          autocomplete="new-password"
        />
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <RouterLink class="cancel" :to="`/user/${targetUsername()}`">{{ lang.t("common.cancel") }}</RouterLink>
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? lang.t("common.saving") : lang.t("common.save") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.password-page {
  max-width: 440px;
  margin: 0 auto;
}
.password-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--text-1);
}
input {
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text-1);
}
.err {
  color: var(--danger);
  font-size: 14px;
}
.actions {
  margin-left: auto;
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