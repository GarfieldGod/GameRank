<script setup>
// 通用图片组件：主源走 Cloudflare R2 CDN，加载失败自动回退本站 /uploads/（服务器兜底）。
// - 仅对 /uploads/ 开头的站内相对路径做 CDN 映射；外链 http(s)、data:、blob: 原样使用。
// - 默认走本站 CDN 域名（image-gamerank.garfieldgod.cn），可用 VITE_IMG_CDN_BASE 覆盖；
//   将 VITE_IMG_CDN_BASE 置为空字符串可完全关闭 CDN 映射，退化为直接请求 /uploads/（旧行为）。
// - 其余属性（class/alt/loading/referrerpolicy/@load 等）自动透传到根 <img>。
import { computed, ref, watch } from "vue";

const props = defineProps({
  src: { type: String, default: "" },
});
const emit = defineEmits(["load", "error"]);

// 默认绑定本站 R2 桶的自定义域名；可用 VITE_IMG_CDN_BASE 覆盖（置空则完全关闭 CDN 映射）
const CDN = (import.meta.env.VITE_IMG_CDN_BASE || "https://image-gamerank.garfieldgod.cn").replace(/\/+$/, "");
const rel = computed(() => String(props.src || ""));
const isSite = (v) => typeof v === "string" && v.startsWith("/uploads/");

// 主源：站内图拼 CDN 域名（CDN 末尾斜杠已在上面剥掉，此处补回 / 分隔；slice(9) 去掉 /uploads 前缀），其余原样
const primary = computed(() => (CDN && isSite(rel.value) ? CDN + "/" + rel.value.slice(9) : rel.value));
// 兜底：仅站内图需要回退到 /uploads/ 原路径
const fallback = computed(() => (CDN && isSite(rel.value) ? rel.value : ""));

let switched = false;
const displaySrc = ref(primary.value);
// 源变化（如切换游戏/头像）时重置回退标记并指回主源
watch(primary, (v) => {
  switched = false;
  displaySrc.value = v;
}, { immediate: true });

function onError(e) {
  if (switched || !fallback.value) {
    emit("error", e);
    return;
  }
  switched = true;
  e.target.src = fallback.value; // 触发回退加载，其 @load 会再 emit load
}
function onLoad(e) {
  emit("load", e);
}
</script>

<template>
  <img :src="displaySrc" @error="onError" @load="onLoad" />
</template>
