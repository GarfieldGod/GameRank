// 数据变更信号：各写操作（编辑/发布/点赞/审核等）成功后写标记，
// 被 KeepAlive 缓存的页面 onActivated 时消费：
// 有标记则重新拉取数据，否则仅恢复滚动位置，兼顾一致性与请求开销。
// games 只能被游戏库消费；gameDetail 记录需刷新详情的游戏 id（存 id，匹配当前游戏才刷新）；
// 二者分开，避免单一布尔被详情页抢先消费导致游戏库拿不到标记。
import { reactive } from "vue";

export const dirtySignal = reactive({ games: false, reviews: false, gameDetail: null });

export function markGamesDirty() {
  dirtySignal.games = true;
}
export function markReviewsDirty() {
  dirtySignal.reviews = true;
}
// 标记某个游戏详情需要刷新（编辑/新建保存后回到详情时显示最新内容）
export function markGameDetailDirty(id) {
  dirtySignal.gameDetail = id;
}

export function consumeGamesDirty() {
  const v = dirtySignal.games;
  dirtySignal.games = false;
  return v;
}
// 消费并返回需要刷新的详情游戏 id（无则为 null）
export function consumeGameDetailDirty() {
  const id = dirtySignal.gameDetail;
  dirtySignal.gameDetail = null;
  return id;
}
export function consumeReviewsDirty() {
  const v = dirtySignal.reviews;
  dirtySignal.reviews = false;
  return v;
}