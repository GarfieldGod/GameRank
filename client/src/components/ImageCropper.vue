<script setup>
import { nextTick, ref, watch } from "vue";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";

// 通用图片裁剪面板：选图后弹出，可拖动/缩放的裁剪框（shape=circle 时为圆形），
// 确认后返回裁剪结果 Blob；上传由调用方处理，本组件只负责裁剪本身。
const props = defineProps({
  open: { type: Boolean, default: false },
  // 待裁剪图片：Blob / File（组件自行生成并回收 objectURL），或现成 objectURL 字符串
  src: { type: [Blob, String], default: null },
  // 裁剪框形状：circle（圆形头像） | square（矩形封面等）
  shape: { type: String, default: "circle" },
  aspectRatio: { type: Number, default: 1 },
  outputSize: { type: Number, default: 256 }, // 输出边长（正方形）
  // 默认 WebP：头像等场景比 PNG 小 60-90%；调用方可显式传 image/png 保留原行为
  outputType: { type: String, default: "image/webp" },
  title: { type: String, default: "" },
  hint: { type: String, default: "" },
  confirmText: { type: String, default: "OK" },
  cancelText: { type: String, default: "Cancel" },
});

const emit = defineEmits(["update:open", "confirm", "cancel"]);

const cropImg = ref(null);
let cropper = null;
let objectUrl = "";

const displaySrc = () => (props.src instanceof Blob ? objectUrl : props.src);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      if (props.src instanceof Blob && !objectUrl) objectUrl = URL.createObjectURL(props.src);
      await nextTick();
      if (cropImg.value) {
        cropImg.value.src = displaySrc();
        if (cropper) cropper.destroy();
        // viewMode:1 限制裁剪框不超出图片；圆形由 CSS .cropper-view-box{border-radius:50%} 呈现；
        // 滚轮 + 拖拽边角即可调整裁剪框大小与位置。
        cropper = new Cropper(cropImg.value, {
          viewMode: 1,
          dragMode: "move",
          aspectRatio: props.aspectRatio,
          autoCropArea: 0.8,
          background: false,
          movable: true,
          rotatable: false,
          scalable: false,
          zoomable: true,
          zoomOnTouch: true,
          zoomOnWheel: true,
          checkOrientation: true,
        });
      }
    } else {
      teardown();
    }
  }
);

// src 变化且面板已打开时，重载预览图
watch(
  () => props.src,
  async (src) => {
    if (!props.open || !src) return;
    if (src instanceof Blob && !objectUrl) objectUrl = URL.createObjectURL(src);
    await nextTick();
    if (cropImg.value) cropImg.value.src = displaySrc();
  }
);

function teardown() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  }
}

function close() {
  emit("update:open", false);
}
function cancel() {
  emit("cancel");
  close();
}
async function confirm() {
  if (!cropper) return;
  try {
    const canvas = cropper.getCroppedCanvas({ width: props.outputSize, height: props.outputSize });
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), props.outputType)
    );
    emit("confirm", blob);
    close();
  } catch {
    cancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="crop-mask" @click.self="cancel">
      <div class="crop-panel" :class="shape">
        <h3 v-if="title" class="crop-title">{{ title }}</h3>
        <div class="crop-box">
          <img ref="cropImg" class="crop-image" alt="crop" />
        </div>
        <p v-if="hint" class="crop-hint">{{ hint }}</p>
        <div class="crop-actions">
          <button type="button" class="text-btn" @click="cancel">{{ cancelText }}</button>
          <button type="button" class="primary" @click="confirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.crop-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.crop-panel {
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 20px 16px;
  width: min(92vw, 480px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.crop-title {
  margin: 0;
  font-size: 18px;
}
.crop-box {
  position: relative;
  width: 100%;
  height: 320px;
  background: #111;
  border-radius: 10px;
  overflow: hidden;
}
.crop-image {
  display: block;
  max-width: 100%;
}
/* 圆形裁剪框：裁剪框圆角 50% 呈现圆形；face 透明以保留圆形预览 */
.crop-panel.circle :deep(.cropper-view-box) {
  border-radius: 50%;
}
.crop-panel.circle :deep(.cropper-face) {
  background-color: transparent;
}
.crop-hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-3);
}
.crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.text-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 6px;
  cursor: pointer;
}
.primary {
  padding: 8px 22px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
</style>