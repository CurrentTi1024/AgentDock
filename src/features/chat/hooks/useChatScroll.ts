// 单聊/群聊共用：消息区自动滚动到底部（进入会话/新消息/发送/运行结束贴底跟随，
// 用户主动上滑查看历史时停止跟随、不被拉回）。
import { useCallback, useEffect, useRef } from 'react';

import type { RunStatus } from '@/api/runtime/types';

interface UseChatScrollOptions {
  /** 新消息/展示单元变化（displayUnits 等），贴底时自动滚到最新。 */
  contentVersion: unknown;
  historyLength: number;
  runStatus?: RunStatus;
  answer?: string;
  /** 输入区高度变化（留白跟随）。 */
  composerHeight: number;
}

export const useChatScroll = ({
  contentVersion,
  historyLength,
  runStatus,
  answer,
  composerHeight,
}: UseChatScrollOptions) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 贴底跟随：用户主动上滑查看历史时停止自动滚动，重新回到底部附近或发送消息时恢复。
  const stickToBottomRef = useRef(true);
  const prevRunStatusRef = useRef<RunStatus | undefined>(undefined);
  // 终态标记：run-persisted 历史刷新完成后据此再滚一次（确保在 DOM 重建之后）。
  const terminalRunRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener('scroll', handleScroll, { passive: true });
    return () => node.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 禁止浏览器滚动恢复：进入会话一律从最新一条开始（顶部恢复会干扰贴底判断）。
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  // 历史/异步内容（A2UI、图片等）渲染完成后高度变化：贴底状态继续跟随，避免停在半空。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom('auto');
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // 进入会话 / 新消息 / 运行状态变化 / 输入区高度变化：贴底时自动定位到最新一条。
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom('auto');
  }, [contentVersion, historyLength, runStatus, answer, composerHeight, scrollToBottom]);

  // 运行结束（live → 历史重渲染）：强制恢复贴底，避免 DOM 重建把滚动重置回顶部。
  useEffect(() => {
    const previous = prevRunStatusRef.current;
    prevRunStatusRef.current = runStatus;
    if (
      previous &&
      (previous === 'running' || previous === 'paused') &&
      runStatus &&
      ['success', 'error', 'cancelled'].includes(runStatus)
    ) {
      terminalRunRef.current = true;
      stickToBottomRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottom('auto'));
      });
    }
    if (runStatus === 'running' || runStatus === 'paused') terminalRunRef.current = false;
  }, [runStatus, scrollToBottom]);

  /** 发送消息时强制贴底并滚到底部。 */
  const stickToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    terminalRunRef.current = false;
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
    });
  }, []);

  /** 终态 run 已落库完成（供 run-persisted 刷新后补一次滚动）。 */
  const isTerminalRun = useCallback(() => terminalRunRef.current, []);

  return { isTerminalRun, scrollRef, scrollToBottom, stickToBottom };
};
