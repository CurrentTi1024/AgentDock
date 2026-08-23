// Chat 运行时传输：仅 proxy（生产走官方 CopilotKit v2 → /api/copilotkit Runtime）。
// direct（自研 SSE 直连上游 /ag-ui）已移除；mock 为离线 UI 测试路径（serviceMode=mock，不经此配置）。
export const runtimeConfig = {
  copilotRuntimeUrl: '/api/copilotkit',
};
