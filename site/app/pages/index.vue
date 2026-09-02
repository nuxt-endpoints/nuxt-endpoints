<script setup lang="ts">
import { docsNav } from '../utils/docs'
import { contractSteps } from '../utils/snippets'

useHead({
  title: 'Nuxt Endpoints',
  meta: [
    {
      name: 'description',
      content:
        'Define Nuxt endpoint contracts once and reuse them for runtime validation, typed clients, Pinia Colada, status-aware typed results, and OpenAPI.',
    },
  ],
})

// Card descriptions come from each page's content frontmatter so the landing
// page cannot drift from what the docs pages say about themselves.
const { data: docsDescriptions } = await useAsyncData('docs-topic-descriptions', async () => {
  const pages = await queryCollection('docs').select('path', 'description').all()
  return Object.fromEntries(pages.map((page) => [page.path, page.description]))
})
const starterLinks = computed(() =>
  docsNav
    .filter((item) => item.to !== '/docs')
    .map((item) => ({ ...item, description: docsDescriptions.value?.[item.to] ?? '' })),
)
const activeStepIndex = ref(0)
const activeStep = computed(() => contractSteps[activeStepIndex.value] ?? contractSteps[0])

const queryPitch = {
  key: 'query',
  title: 'Your contract,',
  titleAccent: 'now query-ready.',
  lead: 'The same $endpoint request object plugs directly into Pinia Colada. Colada owns server-state behavior while Nuxt Endpoints keeps request identity, HTTP idempotency, and status-aware response types aligned with the server contract.',
  points: [
    {
      icon: 'lucide:list-checks',
      text: 'GET and HEAD expose query options; unsafe methods expose mutation options',
    },
    {
      icon: 'lucide:repeat',
      text: 'Ordinary Pinia Colada options keep invalidation, optimistic updates, and Devtools standard',
    },
    {
      icon: 'lucide:globe',
      text: 'Use the official Nuxt modules for automatic SSR prefetching, serialization, and hydration',
    },
    {
      icon: 'lucide:cookie',
      text: 'useEndpoint and query options carry incoming cookies to internal routes during SSR',
    },
  ],
  cta: { label: 'Use Pinia Colada', to: '/docs/pinia-colada' },
  blocks: [
    {
      title: 'nuxt.config.ts — official SSR setup',
      lang: 'ts',
      code: `export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@pinia/colada-nuxt', 'nuxt-endpoints'],
})`,
    },
    {
      title: 'pages/users/[id].vue',
      lang: 'ts',
      code: `import { useQuery } from '@pinia/colada'

const route = useRoute()
const request = $endpoint.getUser({ params: { id: String(route.params.id) } })
const user = useQuery(request.queryOptions())

if (user.data.value?.status === 200) {
  user.data.value.body.name // User
}`,
    },
  ],
} as const

const pitches = [
  {
    key: 'contract',
    title: 'One contract,',
    titleAccent: 'everything typed.',
    lead: 'Define the HTTP contract once, next to the handler, in the schema library you already use. Runtime validation, the generated client, and OpenAPI all derive from that single definition — no codegen step to run.',
    points: [
      {
        icon: 'lucide:shield-check',
        text: 'params, query, headers, and body are validated before your handler runs',
      },
      {
        icon: 'lucide:sparkles',
        text: '$endpoint and useEndpoint are fully inferred — auto-imported, routes stay ordinary server/api files',
      },
      {
        icon: 'lucide:package',
        text: 'Standard Schema based: Zod v4, Valibot, and Effect Schema',
      },
    ],
    cta: { label: 'Define your first endpoint', to: '/docs/getting-started' },
    blocks: [
      {
        title: 'server/api/users/[id].get.ts',
        lang: 'ts',
        code: `import { z } from 'zod'

export const endpoint = defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: User,
    404: z.object({ message: z.string() }),
  },
})`,
      },
      {
        title: 'app code — nothing to import',
        lang: 'ts',
        code: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

if (result.status === 200) result.body.name // User`,
      },
    ],
  },
  {
    key: 'incremental',
    title: 'Incremental',
    titleAccent: 'by design.',
    lead: 'No big-bang migration. Only routes that export an endpoint join the contract — and inside a route, the contract can start loose and tighten when you are ready.',
    points: [
      {
        icon: 'lucide:toggle-right',
        text: 'Opt-in per route: everything else stays a plain Nitro route',
      },
      {
        icon: 'lucide:wand-2',
        text: 'No response schema yet? Client types are inferred from your handler return value',
      },
      {
        icon: 'lucide:undo-2',
        text: 'Declare responses to lock the handler in — or delete the export to roll back',
      },
    ],
    cta: { label: 'Read the adoption guide', to: '/docs/incremental-adoption' },
    blocks: [
      {
        title: 'step 1 — ship it without a schema',
        lang: 'ts',
        code: `export default defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  handler: (event) => {
    return findUser(event.validated.params.id)
    // client types are inferred from this return value
  },
})`,
      },
      {
        title: 'step 2 — tighten the contract',
        lang: 'ts',
        code: `export const endpoint = defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  responses: { 200: User, 404: NotFound },
})

// now the handler return is checked against the schemas,
// and client types come from the contract instead`,
      },
    ],
  },
  {
    key: 'errors',
    title: 'Errors are',
    titleAccent: 'typed too.',
    lead: 'Declared non-2xx responses stop being unknown. Branch on the status code and the body type follows.',
    points: [
      {
        icon: 'lucide:list-checks',
        text: 'responses: { 200: User, 404: NotFound } — TypeScript checks handler returns',
      },
      {
        icon: 'lucide:split',
        text: 'Awaiting the request narrows the response body by status',
      },
      {
        icon: 'lucide:file-json',
        text: '.raw() returns the native Web Response for streaming or low-level access',
      },
    ],
    cta: { label: 'Responses', to: '/docs/responses' },
    blocks: [
      {
        title: 'status-typed result',
        lang: 'ts',
        code: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

if (result.status === 200) {
  result.body.name // User
}

if (result.status === 404) {
  result.body.message // typed from the 404 schema
}`,
      },
    ],
  },
  queryPitch,
  {
    key: 'openapi',
    title: 'OpenAPI that',
    titleAccent: "can't go stale.",
    lead: 'The OpenAPI 3.1 document is generated from the same contracts that run your validation, so there is no spec to keep in sync. Endpoints stay plain HTTP routes.',
    points: [
      {
        icon: 'lucide:file-json',
        text: 'Served at /_endpoints/schema — always matching the code',
      },
      {
        icon: 'lucide:wrench',
        text: 'document / extend hatches add auth schemes and extra detail',
      },
      {
        icon: 'lucide:globe',
        text: 'Plain REST: callable from curl, mobile apps, and any other service',
      },
    ],
    cta: { label: 'Explore the OpenAPI output', to: '/docs/openapi' },
    blocks: [
      {
        title: 'GET /_endpoints/schema',
        lang: 'json',
        code: `{
  "openapi": "3.1.0",
  "paths": {
    "/api/users/{id}": {
      "get": {
        "operationId": "getUser",
        "parameters": [
          { "name": "id", "in": "path", "required": true }
        ],
        "responses": {
          "200": { "description": "OK" },
          "404": { "description": "Not found" }
        }
      }
    }
  }
}`,
      },
    ],
  },
] as const

const stackItems = [
  {
    label: 'Nuxt',
    icon: 'simple-icons:nuxt',
    tone: 'nuxt',
  },
  {
    label: 'Zod',
    icon: 'simple-icons:zod',
    tone: 'zod',
  },
  {
    label: 'Valibot',
    logo: '/logos/valibot-mark.svg',
    tone: 'valibot',
  },
  {
    label: 'Effect',
    icon: 'simple-icons:effect',
    tone: 'effect',
  },
  {
    label: 'Pinia Colada',
    icon: 'simple-icons:pinia',
    tone: 'query',
  },
  {
    label: 'OpenAPI',
    icon: 'simple-icons:openapiinitiative',
    tone: 'openapi',
  },
] as const
</script>

<template>
  <main class="ne-index-page">
    <div class="media" aria-hidden="true">
      <span class="value -grid"></span>
    </div>

    <section class="section -hero">
      <div class="unit -copy">
        <h1 class="title">
          <span class="value">Define once.</span><br />
          <span class="value">Validate at runtime.</span><br />
          <span class="value">Type-safe end-to-end.</span>
        </h1>
        <div class="seg -stack" aria-label="Nuxt Endpoints stack">
          <span class="value">Tech stack</span>
          <ul class="list">
            <li v-for="item in stackItems" :key="item.label" class="item" :data-tone="item.tone">
              <img v-if="'logo' in item" class="image" :src="item.logo" alt="" aria-hidden="true" />
              <Icon v-else-if="'icon' in item" :name="item.icon" size="1rem" aria-hidden="true" />
              <span>{{ item.label }}</span>
            </li>
          </ul>
        </div>

        <p class="text -readiness">
          <Icon name="lucide:shield-check" size="0.95rem" aria-hidden="true" />
          <span>
            Supports Nuxt 4.5+ —
            <NuxtLink to="/docs/getting-started#compatibility">see compatibility</NuxtLink>
          </span>
        </p>

        <div class="seg -step">
          <Transition name="hero-step-fade" mode="out-in">
            <div :key="activeStepIndex" class="fr">
              <h2 class="title">{{ activeStep.title }}</h2>
              <p class="text">
                <template v-for="part in activeStep.description" :key="part.text">
                  <span class="value" :data-tone="part.tone || undefined">{{ part.text }}</span>
                </template>
              </p>
            </div>
          </Transition>
        </div>
      </div>

      <div class="unit -walkthrough">
        <EndpointWalkthrough v-model="activeStepIndex" />
      </div>
    </section>

    <section
      v-for="(pitch, index) in pitches"
      :key="pitch.key"
      class="section -pitch"
      :data-fade="index === 0"
      :data-flip="index % 2 === 1"
    >
      <div class="unit -demo">
        <CodeBlock
          v-for="block in pitch.blocks"
          :key="block.title"
          :code="block.code"
          :lang="block.lang"
          :title="block.title"
        />
      </div>

      <div class="unit -copy">
        <p v-if="pitch.key === 'query'" class="text -eyebrow">
          <Icon name="simple-icons:pinia" size="1rem" aria-hidden="true" />
          Pinia Colada integration
        </p>
        <h2 class="title">
          {{ pitch.title }} <span class="value">{{ pitch.titleAccent }}</span>
        </h2>
        <p class="text">{{ pitch.lead }}</p>
        <ul class="list">
          <li v-for="point in pitch.points" :key="point.icon" class="item">
            <span class="media"><Icon :name="point.icon" size="1.05rem" aria-hidden="true" /></span>
            <span class="value">{{ point.text }}</span>
          </li>
        </ul>
        <NuxtLink class="pv-nuxt-link" :to="pitch.cta.to">
          {{ pitch.cta.label }}
          <Icon name="lucide:arrow-right" size="1rem" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>

    <section class="section -topics">
      <header class="header">
        <h2 class="title">Explore by topic.</h2>
      </header>

      <div class="unit">
        <article v-for="item in starterLinks" :key="item.to" class="article">
          <div class="seg">
            <h3 class="title">{{ item.label }}</h3>
            <p class="text">{{ item.description }}</p>
          </div>
          <NuxtLink class="pv-nuxt-link" :to="item.to">Open guide</NuxtLink>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ne-index-page {
  overflow: hidden;
  isolation: isolate;

  > .media {
    position: absolute;
    inset: -1rem 0 auto;
    z-index: 0;
    height: 62rem;
    overflow: hidden;
    pointer-events: none;

    > .value {
      position: absolute;
      pointer-events: none;

      &.-grid {
        inset: 10rem 0 0;
        background:
          linear-gradient(var(--hero-wash-grid) 1px, transparent 1px),
          linear-gradient(90deg, var(--hero-wash-grid) 1px, transparent 1px);
        background-size:
          38px 38px,
          38px 38px;
        mask-image: linear-gradient(
          to bottom,
          transparent 0%,
          var(--hero-mask-soft) 14%,
          var(--hero-mask-strong) 32%,
          var(--hero-mask-mid) 70%,
          transparent 100%
        );
        opacity: 0.92;
        transform-origin: center bottom;
        animation: hero-grid-drift 22s linear infinite;
      }

      &.-primary,
      &.-secondary {
        inset: 7.25rem -36vw -20rem;
        filter: blur(20px);
        transform-origin: center 72%;
        will-change: opacity, transform;
      }
    }
  }

  > .section {
    width: min(var(--page-max), calc(100% - var(--page-gutter)));
    margin: 0 auto;

    &.-hero {
      --hero-walkthrough-height: 36.5rem;
      --hero-code-width: 38rem;
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 40rem) minmax(0, var(--hero-code-width));
      justify-content: center;
      column-gap: clamp(var(--space-100), 1.2vw, var(--space-300));
      row-gap: var(--space-500);
      align-items: start;
      isolation: isolate;
      padding: var(--space-1000) 0 var(--space-700);

      > .unit {
        position: relative;
        z-index: 1;

        &.-copy {
          display: flex;
          min-height: var(--hero-walkthrough-height);
          flex-direction: column;
          justify-content: flex-start;
          min-width: 0;
          max-width: 40rem;

          > .title {
            max-width: none;
            background: linear-gradient(
              100deg,
              var(--hero-title-start) 0%,
              var(--hero-title-end) 100%
            );
            background-clip: text;
            color: transparent;
            font-size: clamp(var(--text-5xl), 4.15vw, var(--text-hero));
            -webkit-background-clip: text;

            > .value {
              white-space: nowrap;
            }
          }

          > .seg {
            &.-stack {
              display: flex;
              align-items: center;
              flex-wrap: wrap;
              gap: var(--space-150);
              margin-bottom: var(--space-350);

              > .value {
                color: var(--muted);
                font-size: var(--text-xs);
                font-weight: 780;
                text-transform: uppercase;
              }

              > .list {
                display: flex;
                flex-wrap: wrap;
                gap: var(--space-100);
                margin: 0;
                padding: 0;
                list-style: none;

                > .item {
                  --stack-color: var(--accent);
                  display: inline-flex;
                  min-height: 1.7rem;
                  align-items: center;
                  gap: var(--space-075);
                  color: var(--muted);
                  font-size: var(--text-sm);
                  font-weight: 720;
                  padding: 0;

                  &[data-tone='nuxt'] {
                    --stack-color: var(--stack-nuxt);
                  }

                  &[data-tone='zod'] {
                    --stack-color: var(--stack-zod);
                  }

                  &[data-tone='valibot'] {
                    --stack-color: var(--stack-valibot);
                  }

                  &[data-tone='effect'] {
                    --stack-color: var(--stack-effect);
                  }

                  &[data-tone='query'] {
                    --stack-color: var(--stack-query);
                  }

                  &[data-tone='openapi'] {
                    --stack-color: var(--stack-openapi);
                  }

                  > .image {
                    width: 1.12rem;
                    height: 1.12rem;
                    flex: 0 0 auto;
                    object-fit: contain;
                    filter: drop-shadow(0 0.04rem 0.05rem var(--hero-image-shadow));
                  }
                }
              }
            }

            &.-step {
              --local-callout-tail-outer-block: 0.7rem;
              --local-callout-tail-outer-inline: 1.12rem;
              --local-callout-tail-inner-block: 0.58rem;
              --local-callout-tail-inner-inline: 0.94rem;
              --local-callout-tail-mobile-outer: 1.18rem;
              --local-callout-tail-mobile-inner: 0.96rem;
              --hero-step-surface:
                linear-gradient(145deg, var(--hero-step-glass), transparent 42%),
                radial-gradient(circle at 12% 0, var(--hero-step-glow), transparent 38%),
                var(--hero-step-bg);
              position: relative;
              display: grid;
              max-width: 38rem;
              min-height: 7.2rem;
              align-content: start;
              gap: var(--space-100);
              margin-top: var(--space-075);
              border: var(--stroke-default) solid var(--hero-step-border);
              border-radius: var(--radius-md);
              background: var(--hero-step-surface);
              backdrop-filter: blur(18px) saturate(1.16);
              box-shadow: var(--hero-step-shadow);
              padding: var(--space-200) var(--space-250) var(--space-200);
              -webkit-backdrop-filter: blur(18px) saturate(1.16);

              &::before {
                position: absolute;
                z-index: 2;
                top: 3.35rem;
                right: 0;
                border-style: solid;
                border-width: var(--local-callout-tail-outer-block) 0
                  var(--local-callout-tail-outer-block) var(--local-callout-tail-outer-inline);
                border-color: transparent transparent transparent var(--hero-step-border);
                content: '';
                pointer-events: none;
                transform: skewY(-18deg);
                transform-origin: left center;
                translate: 100% -50%;
              }

              &::after {
                position: absolute;
                z-index: 2;
                top: 3.35rem;
                right: 0;
                border-style: solid;
                border-width: var(--local-callout-tail-inner-block) 0
                  var(--local-callout-tail-inner-block) var(--local-callout-tail-inner-inline);
                border-color: transparent transparent transparent var(--hero-step-bg);
                content: '';
                pointer-events: none;
                transform: skewY(-18deg);
                transform-origin: left center;
                translate: calc(100% - 1.6px) -50%;
              }

              > .fr {
                position: relative;
                z-index: 3;
                display: grid;
                gap: var(--space-100);

                > .title {
                  margin-bottom: 0;
                  color: var(--hero-step-ink);
                  font-size: clamp(var(--text-xl), 1.35vw, var(--text-2xl));
                  line-height: 1.18;
                }

                > .text {
                  margin-bottom: 0;
                  color: var(--hero-step-body);
                  font-size: clamp(var(--text-md), 1vw, var(--text-lg));
                  line-height: 1.58;

                  > .value[data-tone] {
                    color: var(--hero-step-emphasis);
                    font-weight: 780;
                  }
                }
              }
            }
          }

          > .text.-readiness {
            display: inline-flex;
            align-self: flex-start;
            align-items: center;
            gap: var(--space-075);
            margin: calc(-1 * var(--space-150)) 0 var(--space-350);
            color: var(--muted);
            font-size: var(--text-xs);
            font-weight: 680;
          }
        }

        &.-walkthrough {
          width: min(100%, var(--hero-code-width));
          min-height: var(--hero-walkthrough-height);
          min-width: 0;
          align-self: start;
          justify-self: center;
          padding-top: var(--space-050);
        }
      }
    }

    &.-pitch {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: clamp(var(--space-300), 4vw, var(--space-800));
      align-items: center;
      padding: var(--space-600) 0;

      &::before {
        position: absolute;
        inset: 0 calc((100vw - 100%) / -2);
        z-index: 0;
        background: var(--bg);
        content: '';
        pointer-events: none;
      }

      &[data-fade='true']::before {
        inset: -8rem calc((100vw - 100%) / -2) 0;
        background: linear-gradient(
          to bottom,
          transparent 0,
          color-mix(in srgb, var(--bg) 28%, transparent) 4rem,
          color-mix(in srgb, var(--bg) 82%, transparent) 8rem,
          var(--bg) 13rem,
          var(--bg) 100%
        );
      }

      > .unit {
        position: relative;
        z-index: 1;
        min-width: 0;
      }

      > .unit.-demo {
        display: grid;
        gap: var(--space-200);
      }

      &[data-flip='true'] > .unit.-demo {
        order: 2;
      }

      > .unit.-copy {
        > .text.-eyebrow {
          display: inline-flex;
          width: fit-content;
          align-items: center;
          gap: var(--space-100);
          margin: 0 0 var(--space-150);
          color: var(--accent-strong);
          font-size: var(--text-xs);
          font-weight: 800;
          letter-spacing: var(--tracking-label);
          text-transform: uppercase;
        }

        > .title {
          margin-bottom: var(--space-200);
          font-size: clamp(var(--text-3xl), 2.6vw, var(--text-4xl));
          line-height: 1.12;

          > .value {
            color: var(--accent);
          }
        }

        > .text {
          margin-bottom: var(--space-300);
          color: var(--muted);
          font-size: var(--text-lg);
        }

        > .list {
          display: grid;
          gap: var(--space-150);
          margin: 0 0 var(--space-300);
          padding: 0;
          list-style: none;

          > .item {
            display: flex;
            align-items: flex-start;
            gap: var(--space-125);
            font-weight: 650;

            > .media {
              display: grid;
              width: 1.7rem;
              height: 1.7rem;
              flex: 0 0 auto;
              place-items: center;
              border-radius: var(--radius-sm);
              background: var(--inline-code-bg);
              color: var(--accent-strong);
            }

            > .value {
              padding-top: var(--space-025);
            }
          }
        }

        > .pv-nuxt-link {
          display: inline-flex;
          min-height: 2.6rem;
          align-items: center;
          gap: var(--space-100);
          border: var(--stroke-default) solid var(--line);
          border-radius: var(--radius-md);
          background: var(--button-bg);
          font-weight: 720;
          padding: 0 var(--space-200);

          &:hover {
            border-color: var(--button-hover-border);
            color: var(--accent-strong);
          }
        }
      }
    }

    &.-topics {
      position: relative;
      z-index: 2;
      padding: var(--space-700) 0 var(--space-800);

      &::before {
        position: absolute;
        inset: 0 calc((100vw - 100%) / -2);
        z-index: 0;
        background: var(--bg);
        content: '';
        pointer-events: none;
      }

      > .header {
        position: relative;
        z-index: 1;
        max-width: 44rem;
        margin-bottom: var(--space-300);
      }

      > .unit {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--space-200);

        > .article {
          display: flex;
          min-height: 11rem;
          flex-direction: column;
          justify-content: space-between;
          gap: var(--space-200);
          border: var(--stroke-default) solid var(--line);
          border-radius: var(--radius-md);
          background: var(--surface);
          padding: var(--space-200);

          > .seg > .text {
            margin-bottom: 0;
            color: var(--muted);
          }

          > .pv-nuxt-link {
            color: var(--accent-strong);
            font-weight: 760;
          }
        }
      }
    }
  }

  @media (max-width: 1080px) {
    > .section {
      &.-hero {
        grid-template-columns: minmax(0, 44rem);
        justify-content: start;
        gap: 0;

        > .unit {
          &.-copy {
            min-height: auto;

            > .seg.-step {
              max-width: min(100%, var(--hero-code-width));
              margin-bottom: var(--space-200);

              &::before {
                top: auto;
                right: auto;
                bottom: 0;
                left: 2.55rem;
                border-width: var(--local-callout-tail-mobile-outer)
                  var(--local-callout-tail-mobile-outer) 0 0;
                border-color: var(--hero-step-border) transparent transparent;
                transform: skew(-24deg);
                transform-origin: top;
                translate: -50% 100%;
              }

              &::after {
                top: auto;
                right: auto;
                bottom: 0;
                left: 2.55rem;
                border-width: var(--local-callout-tail-mobile-inner)
                  var(--local-callout-tail-mobile-inner) 0 0;
                border-color: var(--hero-step-bg) transparent transparent;
                transform: skew(-24deg);
                transform-origin: top;
                translate: calc(-50% - 1px) calc(100% - 1px);
              }
            }
          }

          &.-walkthrough {
            width: min(100%, var(--hero-code-width));
            min-height: auto;
            justify-self: start;
          }
        }
      }
    }
  }

  @media (max-width: 960px) {
    > .section {
      &.-hero {
        grid-template-columns: 1fr;
        gap: 0;
        padding-top: var(--space-700);

        > .unit {
          &.-copy {
            min-height: auto;
            justify-content: flex-start;
          }

          &.-walkthrough {
            width: min(100%, var(--hero-code-width));
            justify-self: start;
          }
        }
      }

      &.-topics > .unit {
        grid-template-columns: 1fr;
      }

      &.-pitch {
        grid-template-columns: 1fr;
        align-items: start;

        > .unit.-demo {
          order: 2;
        }
      }
    }
  }

  @media (max-width: 620px) {
    > .section {
      &.-hero > .unit.-copy {
        > .title {
          font-size: clamp(var(--text-hero-mobile-min), 9vw, var(--text-hero-mobile-max));
        }

        > .seg {
          &.-stack {
            align-items: flex-start;

            > .value {
              width: 100%;
            }

            > .list {
              gap: var(--space-075);

              > .item {
                min-height: 1.7rem;
                font-size: var(--text-sm);
                padding: 0;
              }
            }
          }

          &.-step {
            min-height: 7.8rem;
            padding: var(--space-200) var(--space-200) var(--space-200);

            &::before {
              left: 1.55rem;
            }

            &::after {
              left: 1.55rem;
            }
          }
        }
      }
    }
  }
}

/* Iconify-rendered icons are non-owned DOM. These :deep() rules stay un-nested:
   Vue's scoped compiler mis-emits :deep() inside nested rules. */
.ne-index-page > .section.-hero > .unit.-copy > .seg.-stack > .list > .item :deep(svg) {
  flex: 0 0 auto;
  color: var(--stack-color);
}

@media (prefers-reduced-motion: reduce) {
  .ne-index-page > .media > .value {
    animation: none;
  }
}
</style>
