import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import SmartImg from "./components/SmartImg.vue";
import { useThemeStore } from "./stores/theme";
import "./assets/style.css";
import "./assets/skeleton.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
// 全局注册通用图片组件：R2 CDN 主源 + /uploads 回退
app.component("SmartImg", SmartImg);

// 初次加载：若已登录则应用账号里的主题偏好，否则用本地偏好
const theme = useThemeStore(pinia);
theme.syncFromUser();

app.mount("#app");