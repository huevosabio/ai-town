import { RefObject, useState, useRef} from 'react'

import { useEventListener, useIsomorphicLayoutEffect } from 'usehooks-ts'

interface Size {
  width: number
  height: number
}

export function useElementSize<T extends HTMLElement = HTMLDivElement>(): [RefObject<T>, Size,] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({
    width: 0,
    height: 0,
  })

  useIsomorphicLayoutEffect(() => {
    setSize({
      width: ref.current?.offsetWidth || 0,
      height: ref.current?.offsetHeight || 0,
    })

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setSize({
          width: entry.contentRect.width || 0,
          height: entry.contentRect.height || 0,
        })
      }
    })

    ref.current && resizeObserver.observe(ref.current)
    return () => {
      ref.current && resizeObserver.unobserve(ref.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current])

  return [ref, size]
};