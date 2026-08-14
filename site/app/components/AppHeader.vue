<script setup lang="ts">
type Theme = 'light' | 'dark'

const storageKey = 'nuxt-endpoints-theme'
const theme = useState<Theme>('site-theme', () => 'light')

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
          <span class="media">NE</span>
          <span class="value">Nuxt Endpoints</span>
          <small class="note">alpha</small>
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
          background: var(--brand-bg);
          color: var(--brand-ink);
          font-size: var(--text-xs);
          letter-spacing: 0;
        }

        > .value {
          color: var(--brand-bg);
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
    }
  }

  @media (max-width: 960px) {
    > .unit {
      flex-wrap: wrap;
      align-items: flex-start;
      padding: var(--space-150) 0;

      > .nav {
        order: 3;
        width: 100%;
        margin-left: 0;
        overflow-x: auto;
        padding-bottom: var(--space-025);
      }
    }
  }

  @media (max-width: 620px) {
    > .unit > .actions {
      display: none;
    }
  }
}
</style>
