import { useRef, useEffect } from 'react';

export function usePullToRefresh(onRefresh: () => Promise<void>, containerRef?: React.RefObject<HTMLElement | null>) {
  const startY = useRef(0);
  const pulling = useRef(false);

  useEffect(() => {
    const el = containerRef?.current || document.documentElement;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
        pulling.current = true;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!pulling.current) return;
      pulling.current = false;
      const dy = e.changedTouches[0].clientY - startY.current;
      if (dy > 80) {
        onRefresh();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh, containerRef]);
}
