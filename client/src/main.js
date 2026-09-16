import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useThemeStore } from "./stores/theme";
import "./assets/style.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// 初次加载：若已登录则应用账号里的主题偏好，否则用本地偏好
const theme = useThemeStore(pinia);
theme.syncFromUser();

app.mount("#app");