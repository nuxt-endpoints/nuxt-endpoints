<script setup lang="ts">
import { docsNav } from '../utils/docs'

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
      <p class="text -caps">Documentation</p>
      <nav class="nav">
        <NuxtLink v-for="item in docsNav" :key="item.to" class="pv-nuxt-link" :to="item.to">
          {{ item.label }}
        </NuxtLink>
      </nav>
    </aside>

    <main class="main">
      <article v-if="page" class="article">
        <header class="header">
          <p class="text -eyebrow">Documentation</p>
          <h1 class="title">{{ page.title }}</h1>
          <p v-if="page.description" class="text -lead">
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

    > .text.-caps {
      margin: 0 0 var(--space-150);
      color: var(--muted);
      font-size: var(--text-xs);
      font-weight: 780;
      text-transform: uppercase;
    }

    > .nav {
      display: grid;
      gap: var(--space-050);

      > .pv-nuxt-link {
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

  > .main {
    min-width: 0;

    > .article {
      > .header {
        padding: var(--space-200) 0 var(--space-400);

        > .text.-eyebrow {
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

        > .text.-lead {
          margin-bottom: 0;
          color: var(--muted);
        }
      }

      > .value {
        max-width: 780px;
      }
    }
  }

  @media (max-width: 960px) {
    grid-template-columns: 1fr;

    > .aside {
      position: static;
      padding-right: 0;

      > .nav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    > .main > .article > .header > .title {
      font-size: var(--text-4xl);
    }
  }

  @media (max-width: 620px) {
    width: min(var(--page-max), calc(100% - var(--page-gutter)));

    > .aside > .nav {
      grid-template-columns: 1fr;
    }

    > .main > .article > .header > .title {
      font-size: var(--text-3xl);
    }
  }
}

/* Markdown rendered by ContentRenderer is non-owned DOM. These :deep() rules
   stay un-nested: Vue's scoped compiler mis-emits :deep() inside nested rules
   (`& [data-v] …`), so they must live at the top level of the style block. */
.ne-docs-page > .main > .article > .pv-content-renderer :deep(h2) {
  margin: var(--space-500) 0 var(--space-150);
  padding-top: var(--space-400);
  border-top: var(--stroke-default) solid var(--line);
  font-size: var(--text-2xl);
  line-height: 1.22;
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(h2:first-child) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(h3) {
  margin: var(--space-350) 0 var(--space-100);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(p),
.ne-docs-page > .main > .article > .pv-content-renderer :deep(ul),
.ne-docs-page > .main > .article > .pv-content-renderer :deep(ol) {
  margin: var(--space-150) 0 0;
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(ul),
.ne-docs-page > .main > .article > .pv-content-renderer :deep(ol) {
  padding-left: var(--space-250);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(li + li) {
  margin-top: var(--space-100);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(p),
.ne-docs-page > .main > .article > .pv-content-renderer :deep(li) {
  color: var(--muted);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(a) {
  color: var(--accent-strong);
  font-weight: 720;
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(strong) {
  color: var(--ink);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(hr) {
  margin: var(--space-400) 0;
  border: 0;
  border-top: var(--stroke-default) solid var(--line);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(blockquote) {
  margin: var(--space-200) 0 0;
  border-left: var(--stroke-accent) solid var(--accent);
  background: var(--surface);
  padding: var(--space-150) var(--space-200);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(blockquote p) {
  margin: 0;
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(pre) {
  margin-top: var(--space-200);
  border: var(--stroke-default) solid var(--code-border);
  border-radius: var(--radius-md);
  background: var(--code-bg);
  box-shadow: var(--panel-shadow);
}

.ne-docs-page > .main > .article > .pv-content-renderer :deep(pre code) {
  color: var(--code-ink);
}
</style>
