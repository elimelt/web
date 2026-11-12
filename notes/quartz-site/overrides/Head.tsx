// Based on Quartz v5 Head.tsx at 74b3fc9efd0caafea3dbcd846ddf1f06855b6d2a.
// Quartz does not expose the document head as a configurable v5 component, so
// scripts/quartz.sh installs this tracked override. Reconcile it when QUARTZ_REF changes.
import { i18n } from "../i18n"
import { FullSlug, joinSegments, pathToRoot, simplifySlug } from "../util/path"
import {
  CSSResourceToStyleElement,
  JSResource,
  JSResourceToScriptElement,
} from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"

// Google Fonts' Latin subset for the normal IBM Plex Sans variable face used by
// body copy and headings. Keep this synchronized with the build-time font
// validation in scripts/patch_google_font_fetch.py.
const primaryFontPreload = "/static/fonts/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2"

// Every page fetches the full-text content index (several MB) from <head> for
// the explorer, search and graph. Fetch it at low priority so it does not
// compete with the stylesheets and fonts the first paint needs.
const contentIndexFetch = /^const fetchData = fetch\(("[^"]+")\)/
function deprioritizeContentIndex(resource: JSResource): JSResource {
  if (resource.contentType !== "inline" || !contentIndexFetch.test(resource.script)) {
    return resource
  }
  return {
    ...resource,
    script: resource.script.replace(contentIndexFetch, 'const fetchData = fetch($1, { priority: "low" })'),
  }
}

// Notes are articles; the home page, folder listings and tag pages are not.
function isArticle(slug: FullSlug | undefined): boolean {
  if (!slug || slug === "index" || slug === "404") return false
  return !slug.endsWith("/index") && !slug.startsWith("tags/")
}

export function canonicalUrl(baseUrl: string, slug: FullSlug): string {
  const path = simplifySlug(slug)
  return new URL(encodeURI(path), `https://${baseUrl}/`).toString()
}

export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
  }: QuartzComponentProps) => {
    const titleSuffix = cfg.pageTitleSuffix ?? ""
    const title =
      (fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title) + titleSuffix
    const description =
      fileData.frontmatter?.socialDescription ??
      fileData.frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/portfolio-icon-b2e02b34.png")
    const socialUrl = canonicalUrl(cfg.baseUrl ?? "example.com", fileData.slug ?? "404")

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some((e) => e.name === "CustomOgImages")
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png`

    const coreStylesheet = css[0]?.content
    const coreScript = js.find(
      (r) => r.loadTime === "beforeDOMReady" && r.contentType === "external",
    )

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {coreStylesheet && <link rel="preload" href={coreStylesheet} as="style" />}
        {coreScript && coreScript.contentType === "external" && (
          <link rel="preload" href={coreScript.src} as="script" />
        )}
        {!cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <link
            rel="preload"
            href={primaryFontPreload}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        )}
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        {/* KaTeX's stylesheet blocks rendering and comes from jsDelivr. cdnjs only
            serves Mermaid, which loads on demand, so it gets a DNS lookup only. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="dns-prefetch" href="https://cdnjs.cloudflare.com" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          content={cfg.theme.colors.lightMode.light}
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content={cfg.theme.colors.darkMode.light}
          media="(prefers-color-scheme: dark)"
        />

        <meta property="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:title" content={title} />
        <meta property="og:type" content={isArticle(fileData.slug) ? "article" : "website"} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta property="og:image:type" content="image/png" />
          </>
        )}

        {cfg.baseUrl && fileData.slug !== "404" && (
          <>
            <meta property="twitter:domain" content={cfg.baseUrl}></meta>
            <link rel="canonical" href={socialUrl} />
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
          </>
        )}

        <link rel="icon" type="image/png" href={iconPath} />
        <link rel="apple-touch-icon" href={iconPath} />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />

        {css.map((resource) => CSSResourceToStyleElement(resource, true))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(deprioritizeContentIndex(res), true))}
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
      </head>
    )
  }

  return Head
}) satisfies QuartzComponentConstructor
