<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createGame, updateGame, fetchGame, fetchGameTags, sgdbSearchGames, sgdbAssets, sgdbDownload } from "@/api/game";
import { fetchProposal, updateProposal } from "@/api/proposal";
import { uploadImage } from "@/api/review";
import { extractError, isTimeout } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import { useLangStore } from "@/stores/lang";
import { useThemeStore } from "@/stores/theme";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lang = useLangStore();
const theme = useThemeStore();

// 编辑模式：路由带 :id（管理员编辑既有游戏）
const isEdit = computed(() => Boolean(route.params.id));
// 编辑申请模式：?editProposal=<id>（申请人编辑待审核申请）
const editProposalId = computed(() => (route.query.editProposal ? Number(route.query.editProposal) : null));
const isEditProposal = computed(() => Boolean(editProposalId.value));
const proposalKind = ref("");

const form = ref({
  nameZh: "",
  nameEn: "",
  developer: "",
  publisher: "",
  description: "",
  tags: [], // 从既有标签中多选
  coverImageUrl: "",
  logoImageUrl: "",
  heroImageUrl: "",
});
const error = ref("");
const saving = ref(false);
const uploading = ref(false);
const loadingGame = ref(false);
const notFound = ref(false);
const coverInput = ref(null);
// 缩略图经本地代理缓存渲染，规避浏览器直连 SteamGridDB CDN 被挡
const sgdbThumb = (u) => (u ? `/api/games/sgdb/proxy?url=${encodeURIComponent(u)}` : "");
// SteamGridDB 素材导入：搜索游戏 → 选择 → 展示三类素材（grids/logos/heroes）滑块
const PER = { grid: 5, logo: 3, hero: 1 }; // 每页展示张数；库封面列表 3 张，详情背景列表 1 张
function pageSize(key) {
  return PER[key] || 5;
}
const sgdbGames = ref([]);
const sgdbActive = ref(null); // 选中的 SGDB 游戏 { id, name }
const sgdbAssetsData = ref({ grids: [], logos: [], heroes: [] });
const sgdbSearching = ref(false);
const sgdbLoading = ref(false);
const sgdbError = ref("");
const sgdbRetryable = ref(false); // 最近一次查询超时，标题右侧显示重试按钮
const sliders = ref({ grid: { page: 0 }, logo: { page: 0 }, hero: { page: 0 } });
const chosen = ref({ grid: null, logo: null, hero: null }); // 已选用素材（用于高亮）

function sliderPage(key) {
  return sliders.value[key]?.page ?? 0;
}
// 后端返回的关键字是复数（grids/logos/heroes），以此把单数 key 映射到素材数组
const ASSET_KEY = { grid: "grids", logo: "logos", hero: "heroes" };
function dataKey(key) {
  return ASSET_KEY[key] || key;
}
function assetCount(key) {
  return sgdbAssetsData.value[dataKey(key)]?.length ?? 0;
}
function totalPages(key) {
  return Math.max(1, Math.ceil(assetCount(key) / pageSize(key)));
}
// 只渲染当前页（每页 pageSize 张，其余不挂载 <img>），避免一次性全部加载
function visibleItems(key) {
  const items = sgdbAssetsData.value[dataKey(key)] || [];
  const p = sliderPage(key);
  const per = pageSize(key);
  return items.slice(p * per, p * per + per);
}
function prevPage(key) {
  sliders.value[key].page = Math.max(0, sliderPage(key) - 1);
}
function nextPage(key) {
  sliders.value[key].page = Math.min(totalPages(key) - 1, sliderPage(key) + 1);
}

function cover(url) {
  if (url) return url;
  const dark = theme.theme === "dark";
  const fill = dark ? "#2a2f38" : "#e5e7eb";
  const fg = dark ? "#717a86" : "#9ca3af";
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="${fg}" font-size="18" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">?</text></svg>`
  );
}

// 编辑模式下加载现有数据
async function loadGame() {
  if (!isEdit.value) return;
  loadingGame.value = true;
  notFound.value = false;
  try {
    const data = await fetchGame(route.params.id, { pageSize: 1 });
    const g = data.game;
    form.value = {
      nameZh: g.nameZh || "",
      nameEn: g.nameEn || "",
      developer: g.developer || "",
      publisher: g.publisher || "",
      description: g.description || "",
      tags: Array.isArray(g.tags) ? g.tags.slice() : [],
      coverImageUrl: g.coverImageUrl || "",
      logoImageUrl: g.logoImageUrl || "",
      heroImageUrl: g.heroImageUrl || "",
    };
  } catch {
    notFound.value = true;
  } finally {
    loadingGame.value = false;
  }
}

// 打开本地文件选择（统一由设置面板内的“上传图片”触发）
function openFilePicker() {
  coverInput.value?.click();
}

// 本地上传：按当前面板入口写入不同字段；库封面模式则作为裁剪源
async function onPickCover(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    const url = await uploadImage(file);
    const meta = panelMeta.value;
    if (meta?.crop) {
      cropFrom.value = "rec";
      setCropSourceUrl(url);
    } else if (meta) {
      form.value[meta.target] = url;
    } else {
      form.value.coverImageUrl = url;
    }
  } catch (err) {
    error.value = extractError(err, lang.t("game.new.coverUploadFailed"));
  } finally {
    uploading.value = false;
    e.target.value = "";
  }
}

// 从 SteamGridDB 按名称搜索游戏（优先英文名，匹配更精准）
// 打开设置面板时自动调用：匹配唯一或完全一致时直接选中该游戏展示推荐图，否则留给用户选择
async function onSgdbSearch() {
  const q = (form.value.nameEn || form.value.nameZh || "").trim();
  if (!q) {
    sgdbError.value = "";
    return;
  }
  sgdbSearching.value = true;
  sgdbError.value = "";
  sgdbRetryable.value = false;
  sgdbGames.value = [];
  sgdbActive.value = null;
  sgdbAssetsData.value = { grids: [], logos: [], heroes: [] };
  try {
    const { games } = await sgdbSearchGames(q);
    sgdbGames.value = games || [];
    if (isClearGame(sgdbGames.value, q)) {
      await chooseSgdbGame(sgdbGames.value[0]);
    }
  } catch (err) {
    sgdbRetryable.value = isTimeout(err);
    sgdbError.value = isTimeout(err) ? lang.t("common.netTimeout") : extractError(err, lang.t("game.new.sgdbFailed"));
  } finally {
    sgdbSearching.value = false;
  }
}

// 查询超时后点击标题右侧「重试」：隐藏重试按钮并重新发起查询
function retrySgdb() {
  sgdbRetryable.value = false;
  onSgdbSearch();
}

// 匹配结果是否足够明确（仅一款，或首款游戏名与输入完全一致）
function isClearGame(games, q) {
  if (!games.length) return false;
  if (games.length === 1) return true;
  const first = (games[0].name || "").trim().toLowerCase();
  return first === (q || "").trim().toLowerCase();
}

// 选中某款游戏：自动用其名称回填游戏英文名，再拉取三类素材（各至多 20 张）
async function chooseSgdbGame(g) {
  if (g?.name) form.value.nameEn = g.name;
  sgdbActive.value = g;
  sgdbError.value = "";
  sgdbLoading.value = true;
  sliders.value = { grid: { page: 0 }, logo: { page: 0 }, hero: { page: 0 } };
  chosen.value = { grid: null, logo: null, hero: null };
  try {
    sgdbAssetsData.value = await sgdbAssets(g.id);
  } catch (err) {
    sgdbRetryable.value = sgdbRetryable.value || isTimeout(err);
    sgdbError.value = isTimeout(err) ? lang.t("common.netTimeout") : extractError(err, lang.t("game.new.sgdbFailed"));
    sgdbAssetsData.value = { grids: [], logos: [], heroes: [] };
  } finally {
    sgdbLoading.value = false;
  }
}

// 正在把某张素材下载到本地的候选（用于给该按钮加禁用/加载态，不影响其余列表）
const picking = ref(null); // { key, url }

function clearSgdbField(key) {
  if (key === "grid") form.value.coverImageUrl = "";
  else if (key === "logo") form.value.logoImageUrl = "";
  else form.value.heroImageUrl = "";
  chosen.value[key] = null;
}

// —— 标签：从既有标签中多选（标签卡片 + 弹窗选择器）——
const allTags = ref([]); // [{ tag, count }]
const tagPickerOpen = ref(false);

async function openTagPicker() {
  if (!allTags.value.length) {
    try {
      allTags.value = await fetchGameTags();
    } catch {
      allTags.value = [];
    }
  }
  tagPickerOpen.value = true;
}

function toggleTag(t) {
  const cur = form.value.tags;
  form.value.tags = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
}

function removeTag(t) {
  form.value.tags = form.value.tags.filter((x) => x !== t);
}

// —— 背景随图片自适应：宽度始终=网页宽度，高度按图片比例，渐变位置随高度变化 ——
const heroBgHeight = ref(0);
// 卡片上移量：有背景图时上移至背景图顶（覆盖整张背景底层、两侧露图）；
// 空背景时上移至背景框上沿（520px 高度 + 间隙），卡片压住顶部、背景框向下延伸、仅两侧露出
const EMPTY_BG_PULL = "534px";
const formStyle = computed(() =>
  form.value.heroImageUrl ? { "--hero-pull": heroBgHeight.value + "px" } : { "--hero-pull": EMPTY_BG_PULL }
);
function onHeroLoad(e) {
  heroBgHeight.value = e.currentTarget.clientHeight || 320;
}

// —— 统一图片设置面板：详情封面 / 详情背景 / 库封面，按入口展示不同内容 ——
// cover=详情封面(grid) / background=详情背景(hero) / libCover=库封面(logo)
const PANEL = {
  cover:      { titleKey: "game.new.panel.cover",      assetKey: "grid",  target: "coverImageUrl", crop: false, stage: false },
  background: { titleKey: "game.new.panel.background", assetKey: "hero",  target: "heroImageUrl",  crop: false, stage: false },
  libCover:   { titleKey: "game.new.panel.libCover",   assetKey: "logo",  target: "logoImageUrl",  crop: true,  stage: true },
};
const panelMode = ref(null); // null | 'cover' | 'background' | 'libCover'
const panelMeta = computed(() => (panelMode.value ? PANEL[panelMode.value] : null));
const panelTitle = computed(() => (panelMeta.value ? lang.t(panelMeta.value.titleKey) : ""));
// 面板预览区图片：库封面显示裁剪源图，详情封面/背景直接实时显示对应字段
const panelPreviewUrl = computed(() => {
  if (!panelMeta.value) return "";
  return panelMeta.value.crop ? cropSrcUrl.value : (form.value[panelMeta.value.target] || "");
});

// 面板内展示哪些素材列表：详情封面→grid，详情背景→hero，库封面→三类全部
const PANEL_LISTS = {
  cover: ["grid"],
  background: ["hero"],
  libCover: ["grid", "logo", "hero"],
};
const panelAssetKeys = computed(() => (panelMode.value ? PANEL_LISTS[panelMode.value] || [] : []));
// 只展示查询到素材的类型列表；某类没有任何图片时隐藏对应的列表
const visibleAssetKeys = computed(() => panelAssetKeys.value.filter((k) => assetCount(k) > 0));

function openPanel(mode) {
  panelMode.value = mode;
  sgdbError.value = "";
  if (mode === "libCover") initCropFromSelected();
  onSgdbSearch(); // 已填名称则自动搜索并直接展示推荐图
}
function closePanel() {
  panelMode.value = null;
}

// 可选作库封面裁剪源的已选图片（grid=封面 / hero=背景 / logo=库封面）
const cropSources = computed(() =>
  [
    { key: "grid", label: lang.t("game.new.cover"), url: form.value.coverImageUrl },
    { key: "hero", label: lang.t("game.sgdb.hero"), url: form.value.heroImageUrl },
    { key: "logo", label: lang.t("game.sgdb.logo"), url: form.value.logoImageUrl },
  ].filter((s) => s.url)
);
function initCropFromSelected() {
  const order = ["logo", "grid", "hero"]; // 优先库封面，其次详情封面、背景
  const s = order.map((k) => cropSources.value.find((x) => x.key === k)).find(Boolean);
  if (s) {
    cropFrom.value = s.key;
    setCropSourceUrl(s.url);
  } else {
    cropFrom.value = "rec";
    setCropSourceUrl("");
  }
}

// —— 库封面裁剪：仅在 libCover 模式启用；其余入口的“裁剪框”仅作预览 ——
const CROP_RATIO = 7 / 16; // 高 / 宽：跟随预览卡上图（16:7，整卡16:10中上图占70%）
const STAGE = { w: 480, h: 380 }; // 固定舞台尺寸：坐标计算与渲染共用，保证裁剪框精确居中
const cropFrom = ref(""); // 本窗口源：grid | logo | hero（表单字段）| rec（推荐/上传的新图）
const cropSrcUrl = ref(""); // 正在被裁剪的图 URL
const cropImg = ref(null); // 已加载的裁剪源图（含 naturalWidth/Height）
const cropSaving = ref(false);
const cropBox = reactive({ x: 80, y: 50, w: 380, h: 166 }); // 裁剪窗（舞台坐标），比例固定 16:7
const cropDrag = ref(null);

function setCropSourceUrl(url) {
  if (!url) {
    cropImg.value = null;
    cropSrcUrl.value = "";
    return;
  }
  if (url === cropSrcUrl.value && cropImg.value) return; // 同一张图无需重载
  const img = new Image();
  img.onload = () => {
    cropImg.value = img;
    cropSrcUrl.value = url;
    const r = computeImgRect();
    const w = Math.min(r.w, STAGE.w * 0.85);
    cropBox.w = w;
    cropBox.h = w * CROP_RATIO;
    // 先钳制让框完全落在图片内（图片小于目标框时会把 w/h 按比例缩小），再以其为基准重新居中
    clampCrop();
    cropBox.x = r.x + (r.w - cropBox.w) / 2;
    cropBox.y = r.y + (r.h - cropBox.h) / 2;
  };
  img.src = url;
}

// 源图按 contain 放入舞台后，其在舞台上的显示矩形（含 letterbox 偏移）
function computeImgRect() {
  const img = cropImg.value;
  if (!img) return { x: 0, y: 0, w: STAGE.w, h: STAGE.h };
  const s = Math.min(STAGE.w / img.naturalWidth, STAGE.h / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  return { x: (STAGE.w - w) / 2, y: (STAGE.h - h) / 2, w, h };
}

function clampCrop() {
  const r = computeImgRect();
  if (cropBox.w > r.w) { cropBox.w = Math.max(r.w, 1); cropBox.h = cropBox.w * CROP_RATIO; }
  if (cropBox.h > r.h) { cropBox.h = Math.max(r.h, 1); cropBox.w = cropBox.h / CROP_RATIO; }
  cropBox.x = Math.min(Math.max(cropBox.x, r.x), r.x + r.w - cropBox.w);
  cropBox.y = Math.min(Math.max(cropBox.y, r.y), r.y + r.h - cropBox.h);
}

const stageImgStyle = computed(() => {
  const r = computeImgRect();
  return { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" };
});

// 裁剪窗在源图上的可视矩形（源像素坐标）
function cropVisibleRect() {
  const r = computeImgRect();
  const img = cropImg.value;
  return {
    sx: ((cropBox.x - r.x) / r.w) * img.naturalWidth,
    sy: ((cropBox.y - r.y) / r.h) * img.naturalHeight,
    sw: (cropBox.w / r.w) * img.naturalWidth,
    sh: (cropBox.h / r.h) * img.naturalHeight,
  };
}

function startDrag(e, mode) {
  cropDrag.value = { mode, orig: { ...cropBox }, startX: e.clientX, startY: e.clientY };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  e.preventDefault();
}
function onWindowDown(e) { startDrag(e, "move"); }
function onResizeDown(e) { startDrag(e, "se"); }
function onDragMove(e) {
  const d = cropDrag.value;
  if (!d) return;
  if (d.mode === "move") {
    cropBox.x = d.orig.x + (e.clientX - d.startX);
    cropBox.y = d.orig.y + (e.clientY - d.startY);
  } else {
    const r = computeImgRect();
    let w = d.orig.w + (e.clientX - d.startX);
    w = Math.min(Math.max(w, 40), r.w);
    let h = w * CROP_RATIO;
    if (h > r.h) { h = r.h; w = h / CROP_RATIO; }
    cropBox.w = w;
    cropBox.h = h;
  }
  clampCrop();
}
function onDragEnd() {
  cropDrag.value = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
}

// 确认：库封面模式裁剪并上传，其余入口直接关闭（选择已在上一步落盘）
async function confirmPanel() {
  const meta = panelMeta.value;
  if (!meta) return;
  if (meta.crop) {
    const img = cropImg.value;
    if (!img || cropSaving.value) return;
    const { sx, sy, sw, sh } = cropVisibleRect();
    const out = document.createElement("canvas");
    out.width = 480; // 输出与裁剪框同比例 16:7
    out.height = 210;
    const ctx = out.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 480, 210);
    cropSaving.value = true;
    try {
      const blob = await new Promise((res) => out.toBlob(res, "image/png"));
      const file = new File([blob], "library-cover.png", { type: "image/png" });
      const url = await uploadImage(file); // 返回字符串 URL
      form.value.logoImageUrl = url;
      chosen.value.logo = null; // 库封面以裁剪结果为准，不再沿用原 logo 选中态
      error.value = "";
      closePanel();
    } catch (err) {
      error.value = extractError(err, lang.t("game.new.coverUploadFailed"));
    } finally {
      cropSaving.value = false;
    }
  } else {
    closePanel();
  }
}

// 面板内“推荐图片”缩略图：按当前入口下载后写入字段（库封面则作为裁剪源）
// key 参数为所属素材列表（grid/logo/hero），库封面面板会同时渲染三类列表
async function pickRecommended(img, key) {
  const meta = panelMeta.value;
  if (!meta) return;
  const k = key || meta.assetKey;
  picking.value = { key: k, url: img.url };
  sgdbError.value = "";
  try {
    const { url } = await sgdbDownload(img.url);
    if (meta.crop) {
      cropFrom.value = "rec";
      setCropSourceUrl(url);
    } else {
      form.value[meta.target] = url;
    }
    chosen.value[k] = img;
  } catch (err) {
    sgdbError.value = extractError(err, lang.t("game.new.sgdbFailed"));
  } finally {
    picking.value = null;
  }
}

// 编辑申请模式下按申请快照预填表单
async function loadProposal() {
  if (!isEditProposal.value) return;
  loadingGame.value = true;
  notFound.value = false;
  try {
    const p = await fetchProposal(editProposalId.value);
    proposalKind.value = p.kind;
    const d = p.data || {};
    form.value = {
      nameZh: d.nameZh || "",
      nameEn: d.nameEn || "",
      developer: d.developer || "",
      publisher: d.publisher || "",
      description: d.description || "",
      tags: Array.isArray(d.tags) ? d.tags.slice() : [],
      coverImageUrl: d.coverImageUrl || "",
      logoImageUrl: d.logoImageUrl || "",
      heroImageUrl: d.heroImageUrl || "",
    };
  } catch {
    notFound.value = true;
  } finally {
    loadingGame.value = false;
  }
}

async function save() {
  error.value = "";
  // 英文名为必填项，中文名可选
  const nameEn = form.value.nameEn.trim();
  if (!nameEn) return (error.value = lang.t("game.new.nameEnRequired"));

  const payload = {
    nameZh: form.value.nameZh.trim() || nameEn, // 中文名可选：未输入时以英文名作为中文名
    nameEn,
    developer: form.value.developer.trim() || undefined,
    publisher: form.value.publisher.trim() || undefined,
    description: form.value.description.trim(),
    tags: form.value.tags,
    coverImageUrl: form.value.coverImageUrl || undefined,
    logoImageUrl: form.value.logoImageUrl || undefined,
    heroImageUrl: form.value.heroImageUrl || undefined,
  };

  saving.value = true;
  try {
    if (isEdit.value) {
      const updated = await updateGame(route.params.id, payload);
      router.push(`/game/${updated.id}`);
    } else if (isEditProposal.value) {
      // 编辑待审核申请：更新申请快照（ADD 的同时更新待审游戏）
      await updateProposal(editProposalId.value, payload);
      router.replace({ path: `/user/${auth.user?.id}`, query: { tab: "submission" } });
    } else {
      // 新建游戏：管理员/站长直接通过，跳转详情页；普通用户进入待审，跳回游戏库并提示
      const created = await createGame(payload);
      router.replace(auth.isAdmin ? `/game/${created.id}` : { path: "/games", query: { added: 1 } });
    }
  } catch (err) {
    error.value = extractError(
      err,
      isEdit.value
        ? lang.t("game.editor.updateFailed")
        : isEditProposal.value
          ? lang.t("game.editor.editProposalFailed")
          : lang.t("game.new.nameFailed")
    );
    saving.value = false;
  }
}

// 重新申请被拒绝的新增游戏时，用查询参数预填表单
function prefillFromQuery() {
  if (isEdit.value || !route.query.reapply) return;
  const q = route.query;
  form.value = {
    nameZh: q.nameZh || "",
    nameEn: q.nameEn || "",
    developer: q.developer || "",
    publisher: q.publisher || "",
    description: q.description || "",
    tags: q.tags ? String(q.tags).split(/[,，]/).filter(Boolean) : [],
    coverImageUrl: q.coverImageUrl || "",
    logoImageUrl: q.logoImageUrl || "",
    heroImageUrl: q.heroImageUrl || "",
  };
}

onMounted(() => {
  prefillFromQuery();
  loadProposal();
  loadGame();
});
</script>

<template>
  <div class="new-game">
    <p v-if="loadingGame" class="hint">{{ lang.t("loading") }}</p>
    <p v-else-if="notFound" class="hint">{{ lang.t("game.detail.notFound") }}</p>

    <form v-else class="form" :style="formStyle" @submit.prevent="save">
      <!-- 顶部背景：有图时占满网页宽度、高度随图片自适应，点击可重开设置面板 -->
      <div v-if="form.heroImageUrl" class="hero-bg clickable" @click="openPanel('background')">
        <img class="hero-bg-img" :src="cover(form.heroImageUrl)" alt="" @load="onHeroLoad" />
        <span class="bg-hint">{{ lang.t("game.new.selectBackground") }}</span>
      </div>
      <!-- 无背景图时的占位背景条：作为底层被卡片压住，左右两侧各一个“选择背景图”提示 -->
      <div v-else class="hero-bg hero-bg--empty clickable" @click="openPanel('background')">
        <span class="bg-hint bg-hint--side bg-hint--left">{{ lang.t("game.new.selectBackground") }}</span>
        <span class="bg-hint bg-hint--side bg-hint--right">{{ lang.t("game.new.selectBackground") }}</span>
      </div>

        <div class="hero overlap">
          <!-- 封面域：6:9 容器，未上传时显示“选择封面”，点击即打开详情封面设置面板 -->
          <div class="cover-box" @click="openPanel('cover')">
            <img v-if="form.coverImageUrl" class="cover" :src="cover(form.coverImageUrl)" alt="grid" />
            <button v-else type="button" class="cover cover--empty">
              {{ lang.t("game.new.selectCover") }}
            </button>
            <button
              v-if="form.coverImageUrl"
              type="button"
              class="cross"
              :disabled="uploading"
              @click.stop="clearSgdbField('grid')"
              :title="lang.t('game.new.clearCover')"
            >×</button>
          </div>

        <div class="info">
          <div class="info-title">
            <label class="name-field">
              <span class="field-label">{{ lang.t("game.new.requiredName") }}<span class="req-star">*</span>)</span>
              <input class="name-en" v-model="form.nameEn" :placeholder="lang.t('game.new.nameEnPlaceholder')" />
            </label>
            <label class="name-field">
              <span class="field-label">{{ lang.t("game.new.optionalName") }}</span>
              <input class="name-zh" v-model="form.nameZh" :placeholder="lang.t('game.new.nameZhPlaceholder')" />
            </label>
          </div>

          <p class="intro-title">{{ lang.t("game.new.desc") }}</p>
          <textarea class="desc-input" v-model="form.description" rows="4" :placeholder="lang.t('game.new.descPlaceholder')"></textarea>

          <div class="info-footer">
            <div class="facts">
              <label class="fact">
                <span class="fact-label">{{ lang.t("game.new.developer") }}</span>
                <input class="fact-input" v-model="form.developer" :placeholder="lang.t('game.new.developerPh')" />
              </label>
              <label class="fact">
                <span class="fact-label">{{ lang.t("game.new.publisher") }}</span>
                <input class="fact-input" v-model="form.publisher" :placeholder="lang.t('game.new.publisherPh')" />
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- 标签卡片：只能从既有标签中多选，超长自动换行 -->
      <div class="tags-card">
        <span class="tags-label">{{ lang.t("game.new.tagsLabel") }}</span>
        <div class="tags-list">
          <button v-for="t in form.tags" :key="t" type="button" class="tag-chip" @click="removeTag(t)">
            {{ lang.tag(t) }}<span class="tag-x">×</span>
          </button>
          <button type="button" class="tag-add" :title="lang.t('game.new.tagPickTitle')" @click="openTagPicker">＋</button>
        </div>
      </div>

      <!-- 既有标签选择弹窗 -->
      <div v-if="tagPickerOpen" class="tag-overlay" @click.self="tagPickerOpen = false">
        <div class="tag-picker">
          <div class="tag-picker-head">
            <span class="tag-picker-title">{{ lang.t("game.new.tagPickTitle") }}</span>
            <button type="button" class="tag-pick-close" @click="tagPickerOpen = false">×</button>
          </div>
          <p v-if="!allTags.length" class="tag-picker-empty">{{ lang.t("game.new.tagEmpty") }}</p>
          <div v-else class="tag-picker-list">
            <button
              v-for="op in allTags"
              :key="op.tag"
              type="button"
              class="tag-option"
              :class="{ sel: form.tags.includes(op.tag) }"
              @click="toggleTag(op.tag)"
            >{{ lang.tag(op.tag) }}</button>
          </div>
        </div>
      </div>

      <!-- 库封面预览：复刻游戏库列表卡片（封面 + 底部名称/标签，无分数），点击打开设置面板 -->
      <section class="cover-picker">
        <div class="cp-head">
          <h2>{{ lang.t("game.new.libCoverPreviewTitle") }}</h2>
        </div>
        <button type="button" class="libcover-preview" @click="openPanel('libCover')">
          <span class="libcover-cover">
            <img :src="cover(form.logoImageUrl)" alt="libcover" />
          </span>
          <span class="libcover-body">
            <span class="libcover-gname">{{ lang.gname(form) }}</span>
            <span class="libcover-tags">
              <span v-for="t in form.tags" :key="t" class="libcover-tag">{{ lang.tag(t) }}</span>
            </span>
          </span>
          <span class="libcover-tip">{{ lang.t("game.new.libCoverEditHint") }}</span>
        </button>
      </section>

      <p v-if="error" class="err">{{ error }}</p>

      <!-- 统一图片设置面板：按入口（详情封面 / 详情背景 / 库封面）展示不同内容 -->
      <div v-if="panelMode" class="panel-overlay" @click.self="closePanel">
        <div class="panel-modal">
          <div class="panel-head">
            <span class="panel-title">{{ panelTitle }}</span>
            <button type="button" class="tag-pick-close" @click="closePanel">×</button>
          </div>

          <!-- 库封面：可拖拽裁剪舞台；详情封面/背景：按对应比例只作预览 -->
          <div
            v-if="panelMeta && panelMeta.stage"
            class="crop-stage"
            :style="{ width: STAGE.w + 'px', height: STAGE.h + 'px' }"
          >
            <img v-if="cropImg" class="crop-stage-img" :src="cropSrcUrl" :style="stageImgStyle" alt="" />
            <div
              v-if="cropImg"
              class="crop-window"
              :style="{ left: cropBox.x + 'px', top: cropBox.y + 'px', width: cropBox.w + 'px', height: cropBox.h + 'px' }"
              @pointerdown="onWindowDown"
            >
              <span class="crop-handle se" @pointerdown.stop="onResizeDown"></span>
            </div>
          </div>
          <div v-else-if="panelMeta" class="panel-preview" :class="'ratio-' + panelMeta.assetKey">
            <img v-if="panelPreviewUrl" :src="cover(panelPreviewUrl)" alt="" />
            <span v-else class="panel-preview-empty">{{ lang.t("game.new.panelEmpty") }}</span>
          </div>

          <!-- 推荐图片列表：按当前入口展示对应的素材列表 -->
          <div class="panel-recommend">
            <div class="rec-head">
              <span class="rec-title">{{ lang.t("game.new.panelRecommend") }}</span>
              <button v-if="sgdbRetryable && !sgdbSearching" type="button" class="rec-retry" @click="retrySgdb">{{ lang.t("common.retry") }}</button>
              <span v-if="sgdbSearching || sgdbLoading" class="rec-loading"><span class="spin"></span></span>
              <span v-else-if="sgdbActive" class="rec-game" :title="sgdbActive.name">{{ sgdbActive.name }}</span>
            </div>

            <p v-if="sgdbError" class="err sgdb-err">{{ sgdbError }}</p>

            <div v-if="sgdbGames.length && !sgdbActive" class="sgdb-game-list">
              <span class="sgdb-pick-label">{{ lang.t("game.new.sgdbChooseGame") }}</span>
              <button
                v-for="g in sgdbGames"
                :key="g.id"
                type="button"
                class="sgdb-game"
                :disabled="sgdbSearching"
                @click="chooseSgdbGame(g)"
              >{{ g.name }}</button>
            </div>

            <p v-if="sgdbLoading" class="sgdb-hint">{{ lang.t("game.new.sgdbLoading") }}</p>

            <template v-if="panelMeta && sgdbActive && !sgdbLoading">
              <div v-for="k in visibleAssetKeys" :key="k" class="sgdb-type">
                <div class="sgdb-slider" :class="'slider-' + k">
                  <button type="button" class="sgdb-nav" :disabled="sliderPage(k) <= 0" @click="prevPage(k)">‹</button>
                  <div class="sgdb-track">
                    <button
                      v-for="img in visibleItems(k)"
                      :key="img.url"
                      type="button"
                      class="sgdb-cand"
                      :class="{
                        on: chosen[k] && chosen[k].url === img.url,
                        pick: picking && picking.key === k && picking.url === img.url,
                      }"
                      :disabled="picking && picking.key === k"
                      :title="lang.t('game.new.sgdbUse')"
                      @click="pickRecommended(img, k)"
                    >
                      <img class="sgdb-thumb" :class="'t-' + k" :src="sgdbThumb(img.thumb)" :alt="k" loading="lazy" />
                      <span
                        v-if="picking && picking.key === k && picking.url === img.url"
                        class="pick-mask loading"
                      ><span class="spin"></span></span>
                      <span
                        v-else-if="chosen[k] && chosen[k].url === img.url"
                        class="pick-mask ok"
                      >✓</span>
                    </button>
                  </div>
                  <button type="button" class="sgdb-nav" :disabled="sliderPage(k) >= totalPages(k) - 1" @click="nextPage(k)">›</button>
                </div>
              </div>
            </template>

            <p v-if="panelMeta && !sgdbSearching && !sgdbLoading && !sgdbError && !sgdbActive" class="sgdb-hint">
              {{ lang.t("game.new.sgdbHint") }}
            </p>
          </div>

          <div class="panel-foot">
            <button type="button" class="panel-upload" :disabled="uploading" @click="openFilePicker">
              {{ uploading ? lang.t("game.new.uploading") : lang.t("game.new.panelUpload") }}
            </button>
            <span class="foot-spacer"></span>
            <button type="button" class="panel-cancel" @click="closePanel">{{ lang.t("common.cancel") }}</button>
            <button
              type="button"
              class="primary"
              :disabled="panelMeta?.crop ? (cropSaving || !cropImg) : uploading"
              @click="confirmPanel"
            >
              {{ panelMeta?.crop && cropSaving ? lang.t("common.saving") : lang.t("common.confirm") }}
            </button>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? lang.t("common.saving") : lang.t("common.save") }}
        </button>
        <RouterLink
          class="cancel"
          :to="
            isEdit
              ? `/game/${route.params.id}`
              : isEditProposal
                ? { path: `/user/${auth.user?.id}`, query: { tab: 'submission' } }
                : '/games'
          "
        >
          {{ lang.t("common.cancel") }}
        </RouterLink>
      </div>

      <input ref="coverInput" type="file" accept="image/*" hidden @change="onPickCover" />
    </form>
  </div>
</template>

<style scoped>
/* 该页背景图采用 100vw 全宽铺满（含竖直滚动条宽度），会横向撑出一点点；
   在 body 上裁掉横向溢出，即可消除背景选择后出现的横向滚动条 */
:global(body) {
  overflow-x: hidden;
}

.new-game {
  max-width: 960px;
  margin: 0 auto;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: -24px; /* 抵消外层 .page 顶部 24px 内边距，让背景顶部紧贴导航栏底部 */
}

/* 顶部 Hero 背景条：与详情页一致 —— 始终占满网页宽度，高度随图片比例自适应。
   有背景图时可点击重新打开“设置详情背景”面板 */
.hero-bg {
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  width: 100vw;
  height: auto; /* 高度由图片撑开，可能更高或更矮 */
  line-height: 0;
  pointer-events: none;
  z-index: 0;
}

.hero-bg.clickable {
  pointer-events: auto;
  cursor: pointer;
}

.bg-hint {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 7px 16px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: 2;
  white-space: nowrap;
}

.hero-bg.clickable:hover .bg-hint {
  opacity: 1;
}

.hero-bg-img {
  display: block;
  width: 100%; /* 宽度始终等于网页宽度 */
  height: auto; /* 高度按图片自身比例 */
}

.hero-bg::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0; /* 紧贴图片底部的实际位置，随高度自适应 */
  height: 110px;
  background: linear-gradient(to bottom, transparent, var(--surface));
}

/* 信息卡片：仿详情页（封面左、信息右，制作/发行底部对齐） */
.hero {
  position: relative;
  z-index: 1;
  margin-top: 0;
  display: flex;
  align-items: stretch;
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  flex-wrap: wrap;
}

.hero.overlap {
  /* 信息卡随背景上移：有图时上移至背景顶（覆盖底层），无图时上移占位带上沿线，压住占位带下方 */
  margin-top: calc((var(--hero-pull, 90px)) * -1);
}

/* 无背景图时的背景框：保持完整高度作为底层，卡片在其上叠放，左右各一个“选择背景图”提示 */
.hero-bg--empty {
  height: 520px;
  border: 1px dashed var(--border-strong);
  background: var(--surface-2);
  pointer-events: auto;
  cursor: pointer;
}
.hero-bg--empty:hover {
  border-color: var(--primary);
}
.hero-bg--empty::after {
  display: none;
}
/* 左右两侧的提示：水平定位于“页面边缘 ↔ 卡片边缘”的中点，垂直居中 */
.bg-hint--side {
  top: 50%;
  opacity: 1;
}
.bg-hint--left {
  left: max(12px, calc((100vw - 960px) / 4));
  transform: translate(-50%, -50%);
}
.bg-hint--right {
  right: max(12px, calc((100vw - 960px) / 4));
  left: auto;
  transform: translate(50%, -50%);
}

/* 封面域：6:9 容器，左上封面图 + 右上红叉 */
.cover-box {
  position: relative;
  flex: 0 0 auto;
  width: 240px;
  max-width: 100%;
  aspect-ratio: 6 / 9;
  cursor: pointer;
}

.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 10px;
  display: block;
  background: var(--surface-2);
}

.cover--empty {
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  background: var(--surface-2);
}

.cover-box:hover .cover--empty {
  border-color: var(--primary);
  color: var(--primary);
}

/* 封面/背景右上角的红叉（取消已选图片） */
.cross {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  line-height: 24px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--danger);
  cursor: pointer;
  z-index: 2;
}

.cross:hover {
  background: rgba(0, 0, 0, 0.75);
}

.cross:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-title {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.name-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}

.req-star {
  color: var(--danger);
  font-weight: 700;
}

.name-en,
.name-zh {
  width: 100%;
  box-sizing: border-box;
  font-size: 15px;
}

.intro-title {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}

.desc-input {
  min-height: 88px;
  resize: vertical;
  line-height: 1.7;
}

.info-footer {
  margin-top: auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.facts {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.fact {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 15px;
  flex-direction: row;
}

.fact-label {
  color: var(--text-2);
  white-space: nowrap;
  font-size: 15px;
}

.fact-input {
  flex: 1 1 0;
  min-width: 140px;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 15px;
}

/* 标签卡片：与其余卡片同宽，上下各留 5px */
.tags-card {
  position: relative;
  z-index: 1;
  width: 100%;
  box-sizing: border-box;
  margin: 5px 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tags-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  align-self: flex-start; /* 左上角 */
}

.tags-list {
  display: flex;
  flex-wrap: wrap; /* 超出自动换行 */
  gap: 8px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
}

.tag-chip:hover .tag-x {
  font-weight: 700;
}

.tag-x {
  font-size: 13px;
  line-height: 1;
}

/* 虚线框加号：标签列表最后一个元素 */
.tag-add {
  width: 30px;
  height: 30px;
  line-height: 26px;
  text-align: center;
  font-size: 18px;
  padding: 0;
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}

.tag-add:hover {
  border-color: var(--primary);
  color: var(--primary);
}

/* 既有标签选择弹窗 */
.tag-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.tag-picker {
  width: min(480px, 90vw);
  max-height: 70vh;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tag-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tag-picker-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.tag-pick-close {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.tag-picker-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-option {
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
}

.tag-option:hover:not(.sel) {
  border-color: var(--primary);
  color: var(--primary);
}

.tag-option.sel {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}

.tag-picker-empty {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}

/* 选择封面卡片：代替详情页的评测区 */
.cover-picker {
  position: relative;
  z-index: 1;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cp-head h2 {
  margin: 0;
  font-size: 18px;
}

/* SteamGridDB 素材导入 */
.sgdb-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sgdb-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* “推荐图片”标题行右侧：加载中显示转圈图标，加载完显示游戏名 */
.rec-game {
  font-size: 13px;
  color: var(--primary);
  max-width: 62%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rec-loading {
  display: inline-flex;
  align-items: center;
}
.rec-loading .spin {
  width: 15px;
  height: 15px;
  border-width: 2px;
  border-color: var(--text-3);
  border-top-color: transparent;
}
/* 查询超时后标题右侧的重试按钮 */
.rec-retry {
  padding: 1px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
}
.rec-retry:hover {
  border-color: var(--primary);
}

.sgdb-err {
  font-size: 13px;
}

.sgdb-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.sgdb-game-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.sgdb-pick-label {
  font-size: 13px;
  color: var(--text-2);
}

.sgdb-game {
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
}

.sgdb-game:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.sgdb-slider {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sgdb-nav {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}

.sgdb-nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sgdb-track {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  /* 多图平铺时会用 flex-grow 铺满整行，此处无作用；仅当项数少、被限宽后
     留有剩余空间时，让整组居中（例如只剩一个元素时居中于列表中间）。 */
  justify-content: center;
}

.sgdb-cand {
  position: relative;
  flex: 1 1 0; /* 每页 5 张平分整条轨道宽度，铺满右侧 */
  min-width: 0;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface-2);
  cursor: pointer;
  line-height: 0;
}

.sgdb-cand:hover:not(:disabled) {
  border-color: var(--primary);
}

.sgdb-cand.on {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

/* 限宽：单张/少张图时不让 grid/logo 因 flex 撑满整行，各按自身宽高比给合适的宽度上限；
   多图平铺（grid 5 / logo 3）时每一项都比上限窄，不受影响。
   hero 一页只显示 1 个，需要铺满整行，故不设 max-width（见下方 .slider-hero 无限制）。 */
.slider-grid .sgdb-cand { max-width: 180px; }
.slider-logo .sgdb-cand { max-width: 260px; }

.sgdb-thumb {
  width: 100%;
  max-height: 240px; /* 高度上限：网格/列表项在只有一张或少张图时不会被撑得过高 */
  object-fit: cover; /* 图片自适应填满预览框，不被拉伸变形 */
  display: block;
}

/* 详情库列表封面：库封面（Logo）与详情背景（Hero）完整展示，不被裁切
   （详情页封面 Grid 保持 cover 裁切填充） */
.sgdb-thumb.t-grid {
  aspect-ratio: 6 / 9;
}

.sgdb-thumb.t-logo {
  aspect-ratio: 7 / 4;
  object-fit: contain;
  background: var(--surface-2);
}

.sgdb-thumb.t-hero {
  aspect-ratio: 3 / 1; /* 高为宽的 1/3；单张铺满列表宽度，故按此比例等比展示 */
  max-height: none; /* hero 一页唯一一张，不受 240 上限约束 */
  object-fit: contain;
  background: var(--surface-2);
}

.sgdb-upload {
  padding: 3px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.sgdb-upload:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.sgdb-upload:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sgdb-cand.pick {
  opacity: 0.6;
}

/* 下载中/已选中的角标覆盖层 */
.pick-mask {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  font-size: 13px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
}

.pick-mask.ok {
  background: var(--primary);
  color: #fff;
}

/* 下载中：整图居中显示加载图标（保留 .sgdb-cand.pick 的变暗效果） */
.pick-mask.loading {
  position: absolute;
  inset: 0;
  right: auto;
  bottom: auto;
  width: auto;
  height: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-radius: 0;
}

.spin {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-top-color: transparent;
  border-radius: 50%;
  animation: gspin 0.8s linear infinite;
}

@keyframes gspin {
  to {
    transform: rotate(360deg);
  }
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--text-1);
}

.row {
  display: flex;
  gap: 12px;
}

.row label {
  flex: 1;
}

.req {
  color: var(--danger);
}

input,
textarea {
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
  margin: 0;
}

.hint {
  color: var(--text-2);
  text-align: center;
  padding: 30px 0;
}

.edit-prop-hint {
  padding: 0 0 8px;
  text-align: left;
  font-size: 13px;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end; /* 保存/取消按钮靠右 */
  gap: 12px;
  margin-top: 5px;
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

/* —— 库封面预览：复刻游戏库卡片布局（整卡 16:10，上 60% 封面、下 40% 名称/标签，无分数），水平居中 —— */
.libcover-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 360px; /* 240px × 1.5 */
  aspect-ratio: 16 / 10; /* 与游戏库卡片同比例 16:10 */
  margin: 0 auto; /* 水平居中 */
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  line-height: 1.5;
}
.libcover-cover {
  flex: 7 1 0; /* 上 70% 封面 */
  min-height: 0;
  overflow: hidden;
  line-height: 0;
}
.libcover-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: var(--surface-2);
  transition: opacity 0.2s;
}
.libcover-preview:hover .libcover-cover img {
  opacity: 0.82;
}
.libcover-body {
  flex: 3 1 0; /* 下 30% 信息区 */
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  overflow: hidden;
}
.libcover-gname {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.libcover-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  overflow: hidden;
  min-height: 0;
}
.libcover-tag {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 8px;
  color: var(--text-2);
}
.libcover-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.libcover-preview:hover .libcover-tip {
  opacity: 1;
}

/* —— 统一图片设置面板 —— */
.panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
}

.panel-modal {
  width: min(620px, 94vw);
  max-height: 92vh;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

/* 详情封面/背景的预览框：按各自比例展示当前选中图，仅预览不可裁剪 */
.panel-preview {
  align-self: center;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  line-height: 0;
}
.panel-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.panel-preview.ratio-grid {
  width: auto;
  height: min(52vh, 340px);
  aspect-ratio: 6 / 9;
}
.panel-preview.ratio-hero {
  width: 100%;
  max-width: 520px;
  aspect-ratio: 16 / 9;
}
.panel-preview-empty {
  color: var(--text-3);
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
  padding: 20px 12px;
}

/* 推荐图片列表 */
.panel-recommend {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rec-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}

/* 单个素材列表 */
.sgdb-type {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.panel-upload {
  padding: 9px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
}
.panel-upload:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.panel-upload:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.foot-spacer {
  flex: 1;
}
.panel-cancel {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  padding: 9px 12px;
}
.panel-cancel:hover {
  color: var(--text-1);
}

.crop-stage {
  position: relative;
  align-self: center; /* 舞台在面板中水平居中，裁剪框随之居中 */
  flex-shrink: 0; /* 面板内容超 92vh 时不要被 flex 压扁——所有裁剪/图片坐标都基于 STAGE 380 高，压扁会导致整体下偏、底部裁切 */
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.crop-stage-img {
  position: absolute;
  max-width: none;
  display: block;
}

.crop-window {
  position: absolute;
  border: 1.5px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  background: rgba(255, 255, 255, 0.18);
  cursor: move;
  box-sizing: border-box;
}

.crop-handle.se {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 14px;
  height: 14px;
  background: var(--primary);
  border: 2px solid #fff;
  border-radius: 50%;
  cursor: nwse-resize;
}
</style>