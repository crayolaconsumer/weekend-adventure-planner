// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// Runs the real service-worker registration script from index.html against
// a fake browser, so the first-visit reload regression can't come back.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('controllerchange'))

function boot({ controlled }) {
  const listeners = {}
  const reload = vi.fn()
  const navigator = {
    serviceWorker: {
      controller: controlled ? {} : null,
      register: () => new Promise(() => {}),
      addEventListener: (type, fn) => { listeners[type] = fn },
    },
  }
  const window = { addEventListener: () => {}, location: { reload }, dispatchEvent: () => {} }
  new Function('window', 'navigator', 'location', 'console', script)(window, navigator, { hostname: 'www.go-roam.uk', reload }, console)
  return { fireControllerChange: () => listeners.controllerchange(), reload }
}

describe('index.html service worker registration', () => {
  it('does not reload a first visit when the new worker claims the page', () => {
    const page = boot({ controlled: false })
    page.fireControllerChange()
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('still reloads once when an updated worker takes over', () => {
    const page = boot({ controlled: true })
    page.fireControllerChange()
    page.fireControllerChange()
    expect(page.reload).toHaveBeenCalledTimes(1)
  })
})
