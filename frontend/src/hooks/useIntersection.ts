import { useEffect, type RefObject } from "react";

export function useIntersection(
  ref: RefObject<Element | null>,
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(callback, options);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, callback, options]);
}
