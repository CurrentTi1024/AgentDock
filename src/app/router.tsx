import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const ChatPage = lazy(() => import('@/features/chat/ChatPage'));
const HomePage = lazy(() => import('@/features/chat/HomePage'));
const DetailPage = lazy(() => import('@/features/market/DetailPage'));
const GroupChatPage = lazy(() => import('@/features/group/GroupChatPage'));
const GroupHomePage = lazy(() => import('@/features/group/GroupHomePage'));
const MarketPage = lazy(() => import('@/features/market/MarketPage'));
const SkillCreatePage = lazy(() => import('@/features/skill/CreateSkillPage'));
const TasksPage = lazy(() => import('@/features/tasks/TasksPage'));
const MemoryLayout = lazy(() => import('@/features/memory/MemoryLayout'));
const MemoryHomePage = lazy(() => import('@/features/memory/MemoryHomePage'));
const MemoryListPage = lazy(() => import('@/features/memory/MemoryListPage'));
const DocumentsPage = lazy(() => import('@/features/documents/DocumentsPage'));
const DocumentDetailPage = lazy(() =>
  import('@/features/documents/DocumentsPage').then((module) => ({ default: module.DocumentDetailPage })),
);
const ChannelPage = lazy(() => import('@/features/channel/ChannelPage'));
const ArtifactPage = lazy(() => import('@/features/artifact/ArtifactPage'));
const PagesPage = lazy(() => import('@/features/page/PagesPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/chat" />} />
        <Route path="/chat" element={<HomePage />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/group" element={<GroupHomePage />} />
        <Route path="/group/:id" element={<GroupChatPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/memory" element={<MemoryLayout />}>
          <Route index element={<MemoryHomePage />} />
          <Route path="identities" element={<MemoryListPage />} />
          <Route path="contexts" element={<MemoryListPage />} />
          <Route path="preferences" element={<MemoryListPage />} />
          <Route path="experiences" element={<MemoryListPage />} />
          <Route path="activities" element={<MemoryListPage />} />
          <Route path="*" element={<MemoryListPage />} />
        </Route>
        <Route path="/channel" element={<ChannelPage />} />
        <Route path="/artifact" element={<ArtifactPage />} />
        <Route path="/page" element={<PagesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
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
        <Route path="*" element={<Navigate replace to="/chat" />} />
      </Routes>
    </Suspense>
  );
}
