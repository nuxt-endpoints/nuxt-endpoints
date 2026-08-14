<script setup lang="ts">
import type { BundledLanguage } from 'shiki'

const props = defineProps<{
  code: string
  lang: BundledLanguage
  title?: string
}>()

const highlighted = useState(`code:${props.lang}:${hashSnippet(props.code)}`, () => '')

if (import.meta.server && highlighted.value === '') {
  const { codeToHtml } = await import('shiki')

  highlighted.value = await codeToHtml(props.code, {
    lang: props.lang,
    themes: {
      light: 'github-light-default',
      dark: 'github-dark-default',
    },
  })
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
    <div class="shiki-block" v-html="highlighted" />
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
}
</style>
