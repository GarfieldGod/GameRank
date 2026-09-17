// 返回信号：用于区分「通过返回按钮回到列表页」（恢复滚动位置）
// 与「通过导航栏/普通跳转进入列表页」（应置顶）。
// 返回按钮的 onBack 在执行 router.go 前写入，列表页 onActivated 消费后复位。
import { reactive } from "vue";

export const backSignal = reactive({ fromBack: false });

export function markFromBack() {
  backSignal.fromBack = true;
}

export function consumeFromBack() {
  const v = backSignal.fromBack;
  backSignal.fromBack = false;
  return v;
}