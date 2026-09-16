import request from "./request";

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

// 删除评测
export function deleteReview(id) {
  return request.delete(`/reviews/${id}`);
}

// 上传图片 → { url }
export async function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);
  const r = await request.post("/uploads", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data.url;
}

// 点赞/不认可：{ kind: 'like'|'dislike' } → { likeCount, dislikeCount, myReaction }
export function reactToReview(id, kind) {
  return request.post(`/reviews/${id}/reaction`, { kind }).then((r) => r.data);
}