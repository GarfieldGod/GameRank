import request from "./request";

// 管理端待审申请列表
export function fetchPendingProposals() {
  return request.get("/proposals").then((r) => r.data);
}

// 我的（本人）申请列表
export function fetchMyProposals() {
  return request.get("/proposals/mine").then((r) => r.data);
}

// 单个申请（本人或站长/管理员）
export function fetchProposal(id) {
  return request.get(`/proposals/${id}`).then((r) => r.data);
}

// 编辑待审核申请（仅本人，PENDING 状态）
export function updateProposal(id, payload) {
  return request.put(`/proposals/${id}`, payload).then((r) => r.data);
}

// 审批通过
export function approveProposal(id) {
  return request.post(`/proposals/${id}/approve`).then((r) => r.data);
}

// 审批拒绝
export function rejectProposal(id, reason) {
  return request.post(`/proposals/${id}/reject`, { reason }).then((r) => r.data);
}