<template>
  <div class="ne-app">
    <header class="header">
      <NuxtLink class="pv-nuxt-link -brand" to="/">
        <span class="nuxt-link-default">
          <span class="text -eyebrow">nuxt-endpoints</span>
          <strong class="strong">Playground</strong>
        </span>
      </NuxtLink>
      <nav class="nav" aria-label="Playground demos">
        <NuxtLink class="pv-nuxt-link" to="/endpoints">Typed endpoints</NuxtLink>
        <NuxtLink class="pv-nuxt-link" to="/sqlite-colada">SQLite + Pinia Colada</NuxtLink>
        <a class="link" href="/_endpoints/schema" target="_blank">OpenAPI JSON</a>
      </nav>
    </header>

    <main class="main">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.ne-app {
  min-height: 100vh;

  > .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pg-space-600);
    border-bottom: var(--pg-stroke) solid var(--pg-line);
    background: var(--pg-header-bg);
    padding: var(--pg-space-400) max(var(--pg-space-600), calc((100vw - var(--pg-shell-max)) / 2));

    > .pv-nuxt-link {
      border-radius: var(--pg-radius-md);
      color: var(--pg-muted);
      padding: var(--pg-space-225) var(--pg-space-275);
      font-size: var(--pg-text-sm);
      font-weight: 700;
      text-decoration: none;

      &:hover,
      &[aria-current='page'] {
        background: var(--pg-hover-bg);
        color: var(--pg-ink);
      }

      &.-brand {
        display: grid;
        padding: 0;
        color: var(--pg-ink);

        .nuxt-link-default {
          display: grid;

          > .text.-eyebrow {
            margin: 0 0 var(--pg-space-100);
            color: var(--pg-subtle);
            font-size: var(--pg-text-xs);
            font-weight: 800;
            letter-spacing: var(--pg-tracking-label);
            text-transform: uppercase;
          }

          > .strong {
            font-size: var(--pg-text-xl);
          }
        }

        &:hover {
          background: transparent;
        }
      }
    }

    > .nav {
      display: flex;
      align-items: center;
      gap: var(--pg-space-200);

      > .pv-nuxt-link,
      > .link {
        border-radius: var(--pg-radius-md);
        color: var(--pg-muted);
        padding: var(--pg-space-225) var(--pg-space-275);
        font-size: var(--pg-text-sm);
        font-weight: 700;
        text-decoration: none;

        &:hover,
        &[aria-current='page'] {
          background: var(--pg-hover-bg);
          color: var(--pg-ink);
        }
      }
    }
  }

  > .main {
    width: min(var(--pg-shell-max), calc(100vw - 32px));
    margin: 0 auto;
    padding: var(--pg-space-1000) 0;
  }
}

@media (max-width: 760px) {
  .ne-app {
    > .header {
      display: grid;

      > .nav {
        overflow-x: auto;

        > .pv-nuxt-link,
        > .link {
          white-space: nowrap;
        }
      }
    }
  }
}
</style>
