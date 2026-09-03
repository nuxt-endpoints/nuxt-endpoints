<script setup lang="ts">
import { docsNavSections } from '../utils/docs'

const route = useRoute()
const path = computed(() => route.path.replace(/\/$/, '') || '/')

const { data: page } = await useAsyncData(`docs:${path.value}`, () => {
  return queryCollection('docs').path(path.value).first()
})

if (!page.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Documentation page not found',
  })
}

useSeoMeta({
  title: () => `${page.value?.title || 'Docs'} - Nuxt Endpoints`,
  description: () => page.value?.description,
})
</script>

<template>
  <div class="ne-docs-page">
    <aside class="aside" aria-label="Documentation navigation">
      <section v-for="section in docsNavSections" :key="section.label" class="section">
        <p class="p -caps">{{ section.label }}</p>
        <nav class="nav">
          <NuxtLink v-for="item in section.items" :key="item.to" class="link" :to="item.to">
            {{ item.label }}
          </NuxtLink>
        </nav>
      </section>
    </aside>

    <main class="main">
      <article v-if="page" class="article">
        <header class="header">
          <p class="p -eyebrow">Documentation</p>
          <h1 class="title">{{ page.title }}</h1>
          <p v-if="page.description" class="p -lead">
            {{ page.description }}
          </p>
        </header>

        <ContentRenderer class="pv-content-renderer" :value="page" />
      </article>
    </main>
  </div>
</template>

<style scoped>
.ne-docs-page {
  display: grid;
  grid-template-columns: 245px minmax(0, 1fr);
  gap: var(--space-500);
  width: min(var(--page-max), calc(100% - var(--page-gutter)));
  padding: var(--space-400) 0 var(--space-1000);

  > .aside {
    position: sticky;
    top: 5.25rem;
    align-self: start;
    padding-right: var(--space-200);

    > .section {
      &:not(:first-child) {
        margin-top: var(--space-300);
      }

      > .p.-caps {
        margin: 0 0 var(--space-150);
        color: var(--muted);
        font-size: var(--text-xs);
        font-weight: 780;
        text-transform: uppercase;
      }

      > .nav {
        display: grid;
        gap: var(--space-050);

        > .link {
          border-radius: var(--radius-md);
          color: var(--muted);
          padding: var(--space-100) var(--space-125);
          font-size: var(--text-md);
          font-weight: 650;

          &:hover {
            color: var(--ink);
          }

          &[aria-current='page'] {
            background: var(--surface-soft);
            color: var(--accent-strong);
          }
        }
      }
    }
  }

  > .main {
    min-width: 0;

    > .article {
      > .header {
        padding: var(--space-200) 0 var(--space-400);

        > .p.-eyebrow {
          margin: 0 0 var(--space-150);
          color: var(--accent-strong);
          font-size: var(--text-xs);
          font-weight: 780;
          text-transform: uppercase;
        }

        > .title {
          max-width: 15ch;
          font-size: var(--text-5xl);
        }

        > .p.-lead {
          margin-bottom: 0;
          color: var(--muted);
        }
      }
    }
  }

  @media (max-width: 960px) {
    grid-template-columns: 1fr;

    /* The header's menu owns navigation at this width and already carries these
       sections, so a second copy of them here would be the same list twice. */
    > .aside {
      display: none;
    }

    > .main {
      > .article {
        > .header {
          > .title {
            font-size: var(--text-4xl);
          }
        }
      }
    }
  }

  @media (max-width: 620px) {
    width: min(var(--page-max), calc(100% - var(--page-gutter)));

    > .main {
      > .article {
        > .header {
          > .title {
            font-size: var(--text-3xl);
          }
        }
      }
    }
  }
}
</style>
