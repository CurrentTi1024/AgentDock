import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '@/components/lobehub/AppShell';

const ChatPage = lazy(() => import('@/pages/ChatPage'));
const DetailPage = lazy(() => import('@/pages/DetailPage'));
const MarketPage = lazy(() => import('@/pages/MarketPage'));
const SkillCreatePage = lazy(() => import('@/pages/SkillCreatePage'));
const WorkspacePage = lazy(() => import('@/pages/WorkspacePage'));

export default function App() {
  return <AppShell><Suspense fallback={null}><Routes>
    <Route path="/" element={<Navigate replace to="/chat/session-inbox" />} />
    <Route path="/chat" element={<Navigate replace to="/chat/session-inbox" />} />
    <Route path="/chat/:id" element={<ChatPage />} />
    <Route path="/group/*" element={<WorkspacePage type="group" />} />
    <Route path="/tasks/*" element={<WorkspacePage type="tasks" />} />
    <Route path="/documents/*" element={<WorkspacePage type="documents" />} />
    <Route path="/memory/*" element={<WorkspacePage type="memory" />} />
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
  </Routes></Suspense></AppShell>;
}
