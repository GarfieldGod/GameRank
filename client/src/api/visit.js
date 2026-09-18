import request from "./request";

// 页面加载时上报一次访客（记录/统计职责在后端，前端静默忽略任何失败）
export function reportVisit() {
  return request.post("/visits").catch(() => {});
}