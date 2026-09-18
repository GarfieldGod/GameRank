<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { extractError } from "@/api/request";

const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

const form = reactive({ username: "", nickname: "", password: "", confirm: "", bio: "" });
const errors = reactive({ username: "", nickname: "", password: "", confirm: "" });
const formError = ref("");
const loading = ref(false);

const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;

function validate() {
  errors.username = usernameRe.test(form.username.trim()) ? "" : lang.t("register.usernameInvalid");
  const nick = form.nickname.trim();
  errors.nickname = nick && (nick.length < 3 || nick.length > 20) ? lang.t("register.nicknameInvalid") : "";
  errors.password = form.password.length >= 6 ? "" : lang.t("register.passwordShort");
  errors.confirm = form.confirm === form.password ? "" : lang.t("register.mismatch");
  return !errors.username && !errors.nickname && !errors.password && !errors.confirm;
}

async function onSubmit() {
  formError.value = "";
  if (!validate()) return;

  loading.value = true;
  try {
    await auth.registerAndLogin({
      username: form.username.trim(),
      nickname: form.nickname.trim() || undefined,
      password: form.password,
      bio: form.bio.trim() || undefined,
    });
    router.push({ name: "home" });
  } catch (err) {
    formError.value = extractError(err, lang.t("register.submit") + " 失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-card" @submit.prevent="onSubmit">
      <h2>{{ lang.t("register.title") }}</h2>

      <label>{{ lang.t("register.username") }}
        <input v-model="form.username" type="text" :placeholder="lang.t('register.usernamePlaceholder')" @input="validate" />
      </label>
      <span v-if="errors.username" class="err">{{ errors.username }}</span>

      <label>{{ lang.t("register.password") }}
        <input v-model="form.password" type="password" :placeholder="lang.t('register.passwordPlaceholder')" @input="validate" />
      </label>
      <span v-if="errors.password" class="err">{{ errors.password }}</span>

      <label>{{ lang.t("register.confirmPassword") }}
        <input v-model="form.confirm" type="password" :placeholder="lang.t('register.confirmPlaceholder')" @input="validate" />
      </label>
      <span v-if="errors.confirm" class="err">{{ errors.confirm }}</span>

      <label>{{ lang.t("register.nickname") }}
        <input v-model="form.nickname" type="text" :placeholder="lang.t('register.nicknamePlaceholder', { user: form.username })" maxlength="20" @input="validate" />
      </label>
      <span v-if="errors.nickname" class="err">{{ errors.nickname }}</span>

      <label>{{ lang.t("register.bio") }}
        <input v-model="form.bio" type="text" :placeholder="lang.t('register.bioPlaceholder')" />
      </label>

      <p v-if="formError" class="form-error">{{ formError }}</p>

      <button type="submit" class="submit" :disabled="loading">
        {{ loading ? lang.t("loading") : lang.t("register.submit") }}
      </button>

      <p class="switch">
        {{ lang.t("register.hasAccount") }}
        <RouterLink to="/login">{{ lang.t("register.goLogin") }}</RouterLink>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  padding: 48px 16px;
}

.auth-card {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.auth-card h2 {
  margin-bottom: 12px;
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
  background: var(--surface);
  color: var(--text-1);
}

.err,
.form-error {
  color: var(--danger);
  font-size: 13px;
}

.submit {
  margin-top: 12px;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch {
  text-align: center;
  font-size: 14px;
  color: var(--text-2);
}

.switch a {
  color: var(--primary);
  text-decoration: none;
}
</style>