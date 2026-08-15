import { docsNav } from './app/utils/docs'

export default defineNuxtConfig({
  compatibilityDate: '2024-08-24',
  devtools: { enabled: false },
  modules: ['@nuxt/content', '@nuxt/icon'],
  css: ['~/assets/css/base.css'],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      title: 'Nuxt Endpoints',
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        {
          name: 'description',
          content:
            'Runtime-validated contracts, status-typed clients, and OpenAPI for Nuxt server routes.',
        },
        { property: 'og:title', content: 'Nuxt Endpoints' },
        {
          property: 'og:description',
          content:
            'Runtime-validated contracts, status-typed clients, and OpenAPI for Nuxt server routes.',
        },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/favicon.svg' },
      ],
      script: [
        {
          innerHTML:
            "try{const key='nuxt-endpoints-theme';const saved=localStorage.getItem(key);const theme=saved||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch{}",
        },
      ],
    },
  },
  icon: {
    mode: 'svg',
    serverBundle: {
      collections: ['lucide'],
    },
  },
  nitro: {
    prerender: {
      // Derived from the sidebar definition so navigation, prerendered pages,
      // and content files cannot drift apart silently.
      routes: ['/', ...docsNav.map((item) => item.to)],
    },
  },
  mdc: {
    highlight: {
      theme: {
        light: 'github-light-default',
        dark: 'github-dark-default',
      },
    },
  },
  vite: {
    optimizeDeps: {
      include: ['shiki'],
    },
  },
})
