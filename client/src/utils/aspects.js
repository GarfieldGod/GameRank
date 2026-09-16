// 评测分项（aspect）定义与语言化标签、配色，编辑页与详情页共用
export const ASPECTS = [
  { key: "gameplay", zh: "玩法", en: "Gameplay" },
  { key: "story", zh: "剧情", en: "Story" },
  { key: "performance", zh: "演出", en: "Presentation" },
  { key: "characters", zh: "人设", en: "Characters" },
  { key: "art", zh: "美术", en: "Art & Visuals" },
  { key: "music", zh: "音乐", en: "Music & Sound" },
  { key: "design", zh: "设计", en: "Design" },
  { key: "tech", zh: "性能和稳定性", en: "Performance & Stability" },
  { key: "scale", zh: "游戏体量", en: "Game Size" },
  { key: "guidance", zh: "引导与用户体验", en: "Guidance & UX" },
  { key: "monetize", zh: "商业化模式", en: "Monetization" },
];

export const ASPECT_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#22c55e", "#a855f7",
];

export function aspectIndex(key) {
  return ASPECTS.findIndex((a) => a.key === key);
}

export function aspectColor(key) {
  const i = aspectIndex(key);
  return ASPECT_COLORS[i >= 0 ? i : 0];
}

export function aspectLabel(key, isEn) {
  const a = ASPECTS.find((x) => x.key === key);
  if (!a) return key;
  return isEn ? a.en : a.zh;
}