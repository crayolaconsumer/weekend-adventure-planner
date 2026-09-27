import { useEffect, useState } from 'react'

// True once the element behind `ref` comes within `margin` of the viewport,
// and stays true. `ready` says the element is rendered, so the observer
// attaches when it appears. Without IntersectionObserver it is true at once.
export function useNearViewport(ref, ready = true, margin = '200px') {
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (near || !ready || !el) return
    if (typeof IntersectionObserver === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no observer to wait on
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setNear(true)
    }, { rootMargin: margin })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, near, ready, margin])

  return near
}
