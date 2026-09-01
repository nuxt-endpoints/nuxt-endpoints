<template>
  <div class="ne-index-page">
    <header class="header">
      <p class="text -eyebrow">nuxt-endpoints playground</p>
      <h1 class="title">Choose a focused demo</h1>
      <p class="text -lede">
        Each page exercises one integration in isolation against the same live Nuxt server,
        including a gradual-adoption example that intentionally stays on plain $fetch.
      </p>
    </header>

    <section class="section -topics" aria-label="Available demos">
      <NuxtLink class="pv-nuxt-link -topic" to="/endpoints">
        <span class="nuxt-link-default">
          <span class="unit">
            <span class="text -eyebrow">Core client</span>
            <strong class="strong">Typed endpoints</strong>
            <span class="text">
              Try params, query, body validation, Valibot, and gradual adoption with plain $fetch.
            </span>
          </span>
          <span class="value">Open demo →</span>
        </span>
      </NuxtLink>

      <NuxtLink class="pv-nuxt-link -topic" to="/sqlite-vue-query">
        <span class="nuxt-link-default">
          <span class="unit">
            <span class="text -eyebrow">Integration</span>
            <strong class="strong">SQLite + Vue Query</strong>
            <span class="text">
              Exercise SSR hydration, request-object query options, invalidation, and idempotent
              replay against a real SQLite database.
            </span>
          </span>
          <span class="value">Open demo →</span>
        </span>
      </NuxtLink>

      <a class="link -topic" href="/_endpoints/schema" target="_blank">
        <span class="unit">
          <span class="text -eyebrow">Generated contract</span>
          <strong class="strong">OpenAPI JSON</strong>
          <span class="text">
            Inspect the schema generated from these same endpoint definitions, including the
            required Idempotency-Key header.
          </span>
        </span>
        <span class="value">Open schema ↗</span>
      </a>
    </section>
  </div>
</template>

<style scoped>
.ne-index-page {
  > .header {
    margin-bottom: var(--pg-space-600);

    > .text.-eyebrow {
      margin: 0 0 var(--pg-space-100);
      color: var(--pg-subtle);
      font-size: var(--pg-text-xs);
      font-weight: 800;
      letter-spacing: var(--pg-tracking-label);
      text-transform: uppercase;
    }

    > .title {
      margin: 0;
      font-size: var(--pg-text-title);
      line-height: 1.15;
    }

    > .text.-lede {
      max-width: 760px;
      margin: var(--pg-space-250) 0 0;
      color: var(--pg-muted);
      line-height: 1.65;
    }
  }

  > .section.-topics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--pg-space-400);

    > .pv-nuxt-link,
    > .link.-topic {
      min-height: 190px;
      border: var(--pg-stroke) solid var(--pg-line);
      border-radius: var(--pg-radius-lg);
      background: var(--pg-surface);
      color: var(--pg-ink);
      padding: var(--pg-space-500);
      text-decoration: none;
      transition:
        border-color 140ms ease,
        transform 140ms ease;

      &:hover {
        border-color: var(--pg-subtle);
        transform: translateY(-2px);
      }
    }

    > .pv-nuxt-link.-topic {
      .nuxt-link-default {
        display: grid;
        min-height: 100%;

        > .unit {
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
            margin: 0;
            font-size: var(--pg-text-md);
          }

          > .text:not(.-eyebrow) {
            margin: var(--pg-space-250) 0 var(--pg-space-600);
            color: var(--pg-muted);
            line-height: 1.6;
          }
        }

        > .value {
          align-self: end;
          font-weight: 800;
        }
      }
    }

    > .link.-topic {
      display: grid;

      > .unit {
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
          margin: 0;
          font-size: var(--pg-text-md);
        }

        > .text:not(.-eyebrow) {
          margin: var(--pg-space-250) 0 var(--pg-space-600);
          color: var(--pg-muted);
          line-height: 1.6;
        }
      }

      > .value {
        align-self: end;
        font-weight: 800;
      }
    }
  }
}

@media (max-width: 760px) {
  .ne-index-page {
    > .header > .title {
      font-size: var(--pg-text-mobile-title);
    }

    > .section.-topics {
      grid-template-columns: 1fr;
    }
  }
}
</style>
