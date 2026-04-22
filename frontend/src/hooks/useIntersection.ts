import { useEffect, useRef, useState, type RefObject } from "react";

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

/**
 * Returns true once the element enters the viewport (with optional rootMargin
 * for early loading). Fires once and stays true — ideal for lazy-loading media.
 */
export function useLazyVisible(
  ref: RefObject<Element | null>,
  rootMargin = "300px 0px",
): boolean {
  const [visible, setVisible] = useState(false);
  const frozenRef = useRef(false);

  useEffect(() => {
    if (frozenRef.current) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !frozenRef.current) {
          frozenRef.current = true;
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return visible;
}
