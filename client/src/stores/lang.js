import { defineStore } from "pinia";
import messages from "@/i18n";

const KEY = "gs-lang";
const DEFAULT = "zh";

export const useLangStore = defineStore("lang", {
  state: () => ({
    lang: localStorage.getItem(KEY) || DEFAULT,
  }),

  getters: {
    // 翻译：t('key', { var: value })
    t(state) {
      return (key, vars) => {
        let s = messages[state.lang]?.[key] ?? messages[DEFAULT][key] ?? key;
        if (vars) {
          for (const [k, v] of Object.entries(vars)) {
            s = s.replaceAll(`{${k}}`, String(v));
          }
        }
        return s;
      };
    },
    // 游戏名按当前语言显示；英文无独立名时回退中文
    gname(state) {
      return (game) =>
        state.lang === "en"
          ? game?.nameEn || game?.nameZh || ""
          : game?.nameZh || game?.nameEn || "";
    },
    isEn: (state) => state.lang === "en",
  },

  actions: {
    setLang(lang) {
      this.lang = lang;
      localStorage.setItem(KEY, lang);
    },
    toggle() {
      this.setLang(this.lang === "zh" ? "en" : "zh");
    },
  },
});