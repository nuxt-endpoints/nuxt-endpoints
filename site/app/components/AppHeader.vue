<script setup lang="ts">
import { docsNavSections } from '../utils/docs'

type Theme = 'light' | 'dark'

const storageKey = 'nuxt-endpoints-theme'
const theme = useState<Theme>('site-theme', () => 'light')

const route = useRoute()

// One control owns navigation on a phone. The docs sidebar joins it on docs
// routes instead of getting a second control of its own, so the drawer holds
// everything you can navigate to and nothing you can merely do.
const menuOpen = ref(false)
const inDocs = computed(() => route.path === '/docs' || route.path.startsWith('/docs/'))
const menuLabel = computed(() => (menuOpen.value ? 'Close menu' : 'Open menu'))

watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)

const themeIcon = computed(() => (theme.value === 'dark' ? 'lucide:sun' : 'lucide:moon'))
const themeToggleLabel = computed(() =>
  theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
)

onMounted(() => {
  const saved = localStorage.getItem(storageKey)
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  theme.value = saved === 'dark' || saved === 'light' ? saved : preferred
  applyTheme(theme.value)
})

watch(theme, (value) => {
  if (import.meta.client) {
    localStorage.setItem(storageKey, value)
    applyTheme(value)
  }
})

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

function applyTheme(value: Theme) {
  document.documentElement.dataset.theme = value
  document.documentElement.style.colorScheme = value
}
</script>

<template>
  <header class="ne-app-header">
    <div class="unit">
      <NuxtLink class="pv-nuxt-link -brand" to="/" aria-label="Nuxt Endpoints home">
        <span class="nuxt-link-default">
          <span class="media">
            <svg viewBox="0 0 512 512" aria-hidden="true">
              <defs>
                <linearGradient id="ne-brand-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#00dc82" />
                  <stop offset="1" stop-color="#36e4da" />
                </linearGradient>
              </defs>
              <polygon points="180,132 400,132 372,196 152,196" fill="url(#ne-brand-grad)" />
              <polygon points="166,224 320,224 292,288 138,288" fill="url(#ne-brand-grad)" />
              <polygon points="152,316 372,316 344,380 124,380" fill="url(#ne-brand-grad)" />
            </svg>
          </span>
          <span class="value">Nuxt Endpoints</span>
          <small class="note">beta</small>
        </span>
      </NuxtLink>

      <nav class="nav" aria-label="Primary navigation">
        <NuxtLink class="pv-nuxt-link" to="/docs">Docs</NuxtLink>
        <NuxtLink class="pv-nuxt-link" to="/playground">Type Playground</NuxtLink>
      </nav>

      <div class="actions">
        <button
          class="button"
          type="button"
          :aria-label="themeToggleLabel"
          :title="themeToggleLabel"
          @click="toggleTheme"
        >
          <Icon :name="themeIcon" size="1.1rem" aria-hidden="true" />
        </button>
        <a
          class="link"
          href="https://github.com/nuxt-endpoints/nuxt-endpoints"
          aria-label="GitHub repository"
          title="GitHub repository"
        >
          <Icon name="lucide:github" size="1.15rem" aria-hidden="true" />
        </a>
        <button
          class="button -menu"
          type="button"
          aria-controls="site-menu"
          :aria-expanded="menuOpen"
          :aria-label="menuLabel"
          :title="menuLabel"
          @click="menuOpen = !menuOpen"
        >
          <Icon :name="menuOpen ? 'lucide:x' : 'lucide:menu'" size="1.15rem" aria-hidden="true" />
        </button>
      </div>

      <div id="site-menu" class="menu" :data-open="menuOpen">
        <nav class="links" aria-label="Site navigation">
          <NuxtLink class="pv-nuxt-link" to="/docs">Docs</NuxtLink>
          <NuxtLink class="pv-nuxt-link" to="/playground">Type Playground</NuxtLink>
        </nav>

        <section
          v-for="section in inDocs ? docsNavSections : []"
          :key="section.label"
          class="group"
        >
          <p class="text -caps">{{ section.label }}</p>
          <nav class="links" :aria-label="section.label">
            <NuxtLink
              v-for="item in section.items"
              :key="item.to"
              class="pv-nuxt-link"
              :to="item.to"
            >
              {{ item.label }}
            </NuxtLink>
          </nav>
        </section>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ne-app-header {
  border-bottom: var(--stroke-default) solid var(--header-border);
  background: var(--header-bg);
  backdrop-filter: blur(14px);

  > .unit {
    display: flex;
    width: min(var(--page-max), calc(100% - var(--page-gutter)));
    min-height: 4rem;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-200);
    margin: 0 auto;

    > .pv-nuxt-link.-brand {
      font-weight: 760;

      .nuxt-link-default {
        display: flex;
        align-items: center;
        gap: var(--space-125);

        > .media {
          display: grid;
          width: 2rem;
          height: 2rem;
          place-items: center;
          border-radius: var(--radius-md);
          /* The logomark keeps the icon's midnight tile in both themes. */
          background: #020420;

          > svg {
            display: block;
            width: 100%;
            height: 100%;
          }
        }

        > .value {
          /* Matches the logomark: midnight ink on light, the icon's green
             gradient on dark. */
          background: linear-gradient(
            100deg,
            var(--brand-wordmark-start),
            var(--brand-wordmark-end)
          );
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
        }

        > .note {
          border-radius: var(--radius-pill);
          background: var(--inline-code-bg);
          color: var(--accent-strong);
          font-size: var(--text-2xs);
          font-weight: 780;
          letter-spacing: var(--tracking-brand);
          padding: var(--space-025) var(--space-100);
          text-transform: uppercase;
        }
      }
    }

    > .nav {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--space-200);
      margin-left: auto;
      color: var(--muted);
      font-size: var(--text-md);
      font-weight: 650;

      > .pv-nuxt-link {
        flex: 0 0 auto;

        &:hover {
          color: var(--ink);
        }
      }
    }

    > .actions {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--space-100);
      color: var(--muted);
      font-size: var(--text-md);
      font-weight: 650;

      > .button,
      > .link {
        display: inline-flex;
        width: 2.45rem;
        min-height: 2.45rem;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: var(--stroke-default) solid var(--line);
        border-radius: var(--radius-md);
        background: var(--button-bg);
        color: var(--muted);
        font-weight: 720;

        &:hover {
          color: var(--ink);
        }

        &:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: var(--focus-offset);
        }
      }

      > .button {
        cursor: pointer;
        font: inherit;
      }

      /* Navigation collapses; the theme and repository controls do not, because
         they are one-tap actions rather than places to go. */
      > .button.-menu {
        display: none;
      }
    }

    > .menu {
      display: none;
    }
  }

  /* Two rows once the single row stops fitting: the brand and the controls stay
     together on the first, the links move to the second. The controls are the
     theme toggle and the repository link, so they follow the brand rather than
     the links — losing them was worse than losing a row. */
  @media (max-width: 960px) {
    > .unit {
      flex-wrap: wrap;
      align-items: center;
      /* `gap` is also the row gap once this wraps, and it would stack on top of
         the drawer's own spacing. The one-row min-height stops applying too, or
         row one keeps its full height above the drawer. */
      row-gap: 0;
      min-height: 0;
      padding: var(--space-100) 0;

      > .nav {
        display: none;
      }

      > .actions {
        margin-left: auto;

        > .button.-menu {
          display: inline-flex;
        }
      }

      > .menu[data-open='true'] {
        display: grid;
        gap: var(--space-250);
        width: 100%;
        margin-top: var(--space-100);
        border-top: var(--stroke-default) solid var(--header-border);
        padding: var(--space-200) 0 var(--space-100);

        > .group > .text.-caps {
          margin: 0 0 var(--space-100);
          color: var(--muted);
          font-size: var(--text-xs);
          font-weight: 780;
          text-transform: uppercase;
        }

        .links {
          display: grid;
          gap: var(--space-025);
          grid-template-columns: repeat(2, minmax(0, 1fr));

          > .pv-nuxt-link {
            border-radius: var(--radius-md);
            color: var(--muted);
            padding: var(--space-100) var(--space-125);
            font-size: var(--text-md);
            font-weight: 650;

            &[aria-current='page'] {
              background: var(--surface-soft);
              color: var(--accent-strong);
            }
          }
        }
      }
    }
  }

  /* At phone widths the beta badge gives way: the name and the controls both
     have to survive, and one column of links beats two cramped ones. */
  @media (max-width: 480px) {
    > .unit {
      > .pv-nuxt-link.-brand .nuxt-link-default > .note {
        display: none;
      }

      > .menu[data-open='true'] .links {
        grid-template-columns: 1fr;
      }
    }
  }
}
</style>
