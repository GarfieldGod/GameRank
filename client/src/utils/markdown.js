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

// 封面图展示，无封面时用占位图
export function coverUrl(url, fallback = "") {
  if (url) return url;
  return fallback || "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="28" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">暂无封面</text></svg>'
  );
}