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

  // 只在“回到底部附近”时重新贴底；绝不因“距底远”取消贴底——
  // live→历史切换的 scrollTop 钳制事件会误判，导致完成后停在半空。
  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) {
      stickToBottomRef.current = true;
    }
  }, []);

  // 用户主动上滚查看历史时才取消贴底（wheel/touch），程序化滚动不影响。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stickToBottomRef.current = false;
      else if (event.deltaY > 0) stickToBottomRef.current = true;
    };
    const onTouchStart = () => {
      stickToBottomRef.current = false;
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
    };
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

  // 历史/异步内容（A2UI、图片、折叠块等）渲染完成后高度变化：贴底状态继续跟随，避免停在半空。
  // 注意：ResizeObserver 只报盒尺寸变化，滚动容器/消息列的盒高度固定，内容增高不触发；
  // 因此用 MutationObserver 监听消息列子节点插入（A2UI 组件、折叠行等晚挂载），
  // 仅按“贴底跟随”门控（不能依赖终态标记：stickToBottom 会复位它），50ms 防抖避免流式高频开销。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom('auto');
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const content = node.firstElementChild;
    if (!content) return;
    let timer: number | undefined;
    const observer = new MutationObserver(() => {
      if (!stickToBottomRef.current || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        requestAnimationFrame(() => scrollToBottom('auto'));
      }, 50);
    });
    observer.observe(content, { characterData: true, childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
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
  /** 当前是否处于“贴底跟随”状态（用户上滚查看历史时为 false）。 */
  const isStickToBottom = useCallback(() => stickToBottomRef.current, []);

  return { isStickToBottom, isTerminalRun, scrollRef, scrollToBottom, stickToBottom };
};
