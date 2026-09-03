<script setup lang="ts">
import type { BundledLanguage } from 'shiki'

const props = defineProps<{
  code: string
  lang: BundledLanguage
  title?: string
}>()

const highlighted = useState(`code:${props.lang}:${hashSnippet(props.code)}`, () => '')

async function highlightCode() {
  if (highlighted.value !== '') return

  const { codeToHtml } = await import('shiki')

  highlighted.value = await codeToHtml(props.code, {
    lang: props.lang,
    themes: {
      light: 'github-light-default',
      dark: 'github-dark-default',
    },
    // Without this, Shiki writes the first theme as a plain inline `color:` and
    // only the second as a variable. The inline value then outranks the
    // stylesheet rule that swaps themes, so dark mode kept the light token
    // colours on a dark background. `false` emits both as variables and no
    // inline colour, which is what the `.shiki span` rules in base.css expect.
    defaultColor: false,
  })
}

if (import.meta.server) {
  await highlightCode()
} else {
  onMounted(highlightCode)
}

function hashSnippet(input: string) {
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0
  }

  return Math.abs(hash).toString(36)
}
</script>

<template>
  <figure class="ne-code-block">
    <figcaption v-if="title" class="figcaption">{{ title }}</figcaption>
    <!-- Shiki escapes source text before producing this trusted highlighted markup. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="highlighted" class="unit -highlighted" v-html="highlighted" />
    <pre v-else class="pre -fallback"><code>{{ code }}</code></pre>
  </figure>
</template>

<style scoped>
.ne-code-block {
  min-width: 0;
  overflow: hidden;
  border: var(--stroke-default) solid var(--code-border);
  border-radius: var(--radius-md);
  background: var(--code-bg);
  color: var(--code-ink);
  box-shadow: var(--panel-shadow);

  > .figcaption {
    margin: 0;
    padding: var(--space-150) var(--space-200);
    border-bottom: var(--stroke-default) solid var(--code-glass-line);
    color: var(--code-muted);
    font-size: var(--text-xs);
    font-weight: 720;
  }

  > .pre.-fallback {
    background: var(--code-bg);
  }
}
</style>
