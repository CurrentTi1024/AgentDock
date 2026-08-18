import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const ChatPage = lazy(() => import('@/features/chat/ChatPage'));
const DetailPage = lazy(() => import('@/features/market/DetailPage'));
const MarketPage = lazy(() => import('@/features/market/MarketPage'));
const SkillCreatePage = lazy(() => import('@/features/skill/CreateSkillPage'));
const WorkspacePage = lazy(() => import('@/features/workspace/WorkspacePage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/chat/session-inbox" />} />
        <Route path="/chat" element={<Navigate replace to="/chat/session-inbox" />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/group/*" element={<WorkspacePage type="group" />} />
        <Route path="/tasks/*" element={<WorkspacePage type="tasks" />} />
        <Route path="/documents/*" element={<WorkspacePage type="documents" />} />
        <Route path="/memory/*" element={<WorkspacePage type="memory" />} />
        <Route path="/channel/*" element={<WorkspacePage type="channel" />} />
        <Route path="/artifact/*" element={<WorkspacePage type="artifact" />} />
        <Route path="/page/*" element={<WorkspacePage type="page" />} />
        <Route path="/settings/*" element={<WorkspacePage type="settings" />} />
        <Route path="/market" element={<Navigate replace to="/market/agent" />} />
        <Route path="/market/agent" element={<MarketPage kind="agent" />} />
        <Route path="/market/agent/:id" element={<DetailPage kind="agent" />} />
        <Route path="/market/skill" element={<MarketPage kind="skill" />} />
        <Route path="/market/skill/create" element={<SkillCreatePage />} />
        <Route path="/market/skill/:id" element={<DetailPage kind="skill" />} />
        <Route path="/market/mcp" element={<MarketPage kind="mcp" />} />
        <Route path="/market/mcp/:id" element={<DetailPage kind="mcp" />} />

        {/* Compatibility redirects for the discarded temporary information architecture. */}
        <Route path="/agent/:id" element={<Navigate replace to="/chat/session-inbox" />} />
        <Route path="/community/agent/*" element={<Navigate replace to="/market/agent" />} />
        <Route path="/community/skill/*" element={<Navigate replace to="/market/skill" />} />
        <Route path="/community/mcp/*" element={<Navigate replace to="/market/mcp" />} />
        <Route path="*" element={<Navigate replace to="/chat/session-inbox" />} />
      </Routes>
    </Suspense>
  );
}
