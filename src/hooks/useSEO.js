/**
 * useSEO Hook
 *
 * Lightweight SEO management for React 19 (react-helmet doesn't support it yet)
 * Updates document title and meta tags dynamically
 */

import { useEffect } from 'react'

const DEFAULT_TITLE = 'ROAM — Stop scrolling. Start roaming.'
const DEFAULT_DESCRIPTION = 'Beat boredom with one tap. Swipe through curated local places, build spontaneous adventures, and get out there exploring.'

/**
 * Update or create a meta tag
 */
function setMetaTag(name, content, isProperty = false) {
  if (!content) return

  const attribute = isProperty ? 'property' : 'name'
  let meta = document.querySelector(`meta[${attribute}="${name}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute(attribute, name)
    document.head.appendChild(meta)
  }

  meta.setAttribute('content', content)
}

/**
 * useSEO - Update page SEO metadata
 *
 * @param {Object} options
 * @param {string} options.title - Page title (will be suffixed with " | ROAM")
 * @param {string} options.description - Page description
 * @param {string} options.image - OG image URL
 * @param {string} options.url - Canonical URL
 * @param {string} options.type - OG type (default: "website")
 */
export function useSEO({
  title,
  description,
  image,
  url,
  type = 'website'
} = {}) {
  useEffect(() => {
    // Only the image is restored from what was there before. Text tags reset
    // to the defaults: a directly loaded /place/:id arrives with the server's
    // "Costa | ROAM" title, and restoring that kept it on every later route.
    const getOriginalMeta = (name, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name'
      return document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content')
    }

    const originals = {
      ogImage: getOriginalMeta('og:image', true),
      twitterImage: getOriginalMeta('twitter:image')
    }

    // Set new values
    const fullTitle = title ? `${title} | ROAM` : DEFAULT_TITLE
    const fullDescription = description || DEFAULT_DESCRIPTION
    const fullUrl = url || window.location.href

    document.title = fullTitle

    setMetaTag('description', fullDescription)
    setMetaTag('og:title', fullTitle, true)
    setMetaTag('og:description', fullDescription, true)
    setMetaTag('og:type', type, true)
    setMetaTag('og:url', fullUrl, true)
    setMetaTag('twitter:title', fullTitle)
    setMetaTag('twitter:description', fullDescription)

    if (image) {
      setMetaTag('og:image', image, true)
      setMetaTag('twitter:image', image)
    }

    // Cleanup - back to the site defaults
    return () => {
      document.title = DEFAULT_TITLE
      setMetaTag('description', DEFAULT_DESCRIPTION)
      setMetaTag('og:title', DEFAULT_TITLE, true)
      setMetaTag('og:description', DEFAULT_DESCRIPTION, true)
      setMetaTag('og:type', 'website', true)
      setMetaTag('og:url', 'https://www.go-roam.uk/', true)
      setMetaTag('twitter:title', DEFAULT_TITLE)
      setMetaTag('twitter:description', DEFAULT_DESCRIPTION)

      // Only reset image if we set one
      if (image) {
        if (originals.ogImage) {
          setMetaTag('og:image', originals.ogImage, true)
          setMetaTag('twitter:image', originals.twitterImage)
        }
      }
    }
  }, [title, description, image, url, type])
}

export default useSEO
