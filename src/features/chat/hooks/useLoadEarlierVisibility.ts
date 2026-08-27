import { useCallback, useEffect, useRef, useState, type TouchEventHandler, type WheelEventHandler } from 'react';

/**
 * “加载更早消息”只响应用户主动向历史方向滚动。首屏内容不足以产生滚动条时，
 * 也可通过向上滚轮/下拉触摸手势显式唤出，避免刷新后按钮贴在输入框上方。
 */
export const useLoadEarlierVisibility = (sessionId: string) => {
  const [visible, setVisible] = useState(false);
  const touchYRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setVisible(false);
    touchYRef.current = undefined;
  }, [sessionId]);

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>((event) => {
    if (event.deltaY < 0) setVisible(true);
  }, []);

  const onTouchStart = useCallback<TouchEventHandler<HTMLDivElement>>((event) => {
    touchYRef.current = event.touches[0]?.clientY;
  }, []);

  const onTouchMove = useCallback<TouchEventHandler<HTMLDivElement>>((event) => {
    const previousY = touchYRef.current;
    const currentY = event.touches[0]?.clientY;
    if (previousY !== undefined && currentY !== undefined && currentY > previousY) {
      setVisible(true);
    }
    touchYRef.current = currentY;
  }, []);

  return { onTouchMove, onTouchStart, onWheel, visible };
};
