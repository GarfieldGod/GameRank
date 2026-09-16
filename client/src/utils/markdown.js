import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// 把 markdown 渲染为 HTML（供 v-html 使用）
export function renderMarkdown(src) {
  return md.render(src || "");
}

// 封面图展示，无封面时用占位图（颜色跟随当前主题）
export function coverUrl(url, fallback = "") {
  if (url) return url;
  if (fallback) return fallback;
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const rect = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="${rect}"/><text x="50%" y="50%" fill="${fg}" font-size="28" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">暂无封面</text></svg>`
  );
}

// 评测所关联游戏的名称（按查看者语言切换中英文；无关联时退回评测里的 gameName）
export function gameDisplayName(review, isEn) {
  const g = review?.game;
  if (isEn) return (g && g.nameEn) || review?.gameName || "";
  return (g && g.nameZh) || review?.gameName || "";
}

// 评测封面：优先使用所关联游戏的封面，其次评测自身封面
export function reviewCover(review) {
  return (review?.game && review.game.coverImageUrl) || review?.coverImageUrl || "";
}