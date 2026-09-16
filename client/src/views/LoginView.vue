<script setup>
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { extractError } from "@/api/request";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();

const form = reactive({ username: "", password: "" });
const errors = reactive({ username: "", password: "" });
const formError = ref("");
const loading = ref(false);

function validate() {
  errors.username = form.username.trim() ? "" : lang.t("login.required");
  errors.password = form.password ? "" : lang.t("login.required");
  return !errors.username && !errors.password;
}

async function onSubmit() {
  formError.value = "";
  if (!validate()) return;

  loading.value = true;
  try {
    await auth.login({ username: form.username.trim(), password: form.password });
    // 优先跳回登录前的目标页，否则回首页
    router.push(route.query.redirect || { name: "home" });
  } catch (err) {
    formError.value = extractError(err, "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-card" @submit.prevent="onSubmit">
      <h2>{{ lang.t("login.title") }}</h2>

      <label>{{ lang.t("login.username") }}
        <input v-model="form.username" type="text" :placeholder="lang.t('login.username')" @input="validate" />
      </label>
      <span v-if="errors.username" class="err">{{ errors.username }}</span>

      <label>{{ lang.t("login.password") }}
        <input v-model="form.password" type="password" :placeholder="lang.t('login.password')" @input="validate" />
      </label>
      <span v-if="errors.password" class="err">{{ errors.password }}</span>

      <p v-if="formError" class="form-error">{{ formError }}</p>

      <button type="submit" class="submit" :disabled="loading">
        {{ loading ? lang.t("loading") : lang.t("login.submit") }}
      </button>

      <p class="switch">
        {{ lang.t("login.noAccount") }}
        <RouterLink to="/register">{{ lang.t("login.goRegister") }}</RouterLink>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  padding: 64px 16px;
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
  margin-top: 8px;
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