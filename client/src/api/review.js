import request from "./request";
import { compressImage } from "@/utils/imageCompress";

// 获取评测列表：{ page, pageSize, keyword, tag, authorId }
export function fetchReviews(params) {
  return request.get("/reviews", { params }).then((r) => r.data);
}

// 获取单篇评测详情
export function fetchReview(id) {
  return request.get(`/reviews/${id}`).then((r) => r.data);
}

// 创建评测
export function createReview(payload) {
  return request.post("/reviews", payload).then((r) => r.data);
}

// 更新评测
export function updateReview(id, payload) {
  return request.put(`/reviews/${id}`, payload).then((r) => r.data);
}

// 删除评测；reason 为删除原因（管理员软删除他人评测时记录）
export function deleteReview(id, reason) {
  return request.delete(`/reviews/${id}`, { data: { reason } });
}

// 上传图片 → { url }
// 所有前端上传的汇聚点：默认先经 compressImage「等比限宽 + 转 WebP」再上传，
// 任何场景都可传 { opts: { maxEdge, quality, skipIfSmall, type } } 覆盖默认参数。
export async function uploadImage(file, { opts } = {}) {
  const compressed = await compressImage(file, opts);
  const form = new FormData();
  form.append("file", compressed);
  const r = await request.post("/uploads", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data.url;
}

// 点赞/不认可：{ kind: 'like'|'dislike' } → { likeCount, dislikeCount, myReaction }
export function reactToReview(id, kind) {
  return request.post(`/reviews/${id}/reaction`, { kind }).then((r) => r.data);
}
