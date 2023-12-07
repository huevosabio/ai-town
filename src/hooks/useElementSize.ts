import { useCallback, useState, useRef, RefObject } from 'react'

import { useEventListener, useIsomorphicLayoutEffect } from 'usehooks-ts'

interface Size {
  width: number
  height: number
}

export const useElementSize = <T extends HTMLElement = HTMLDivElement>(): [
  (node: T | null) => void,
  Size
] => {
  const [ref, setRef] = useState<T | null>(null)
  const [size, setSize] = useState<Size>({
    width: 0,
    height: 0,
  });

  useIsomorphicLayoutEffect(() => {
    const updateSize = (element: Element | null) => {
      const { width, height } = element?.getBoundingClientRect() ?? {
        width: 0,
        height: 0,
      };
      setSize({ width, height });
    };

    updateSize(ref);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateSize(entry.target);
      }
    });

    ref && resizeObserver.observe(ref);
    return () => {
      ref && resizeObserver.unobserve(ref);
    };
  }, [ref]);

  return [setRef, size];
};
