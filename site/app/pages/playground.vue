<script setup lang="ts">
useHead({
  title: 'Type Playground - Nuxt Endpoints',
  meta: [
    {
      name: 'description',
      content: 'Nuxt Endpoints type playground.',
    },
  ],
})
</script>

<template>
  <main class="ne-playground-page">
    <section class="section">
      <div class="unit">
        <h1 class="title">Type Playground</h1>
        <p class="text -lead">Edit endpoint contracts and client calls in the browser.</p>
      </div>

      <TypePlayground />
    </section>
  </main>
</template>

<style scoped>
.ne-playground-page {
  > .section {
    width: min(var(--page-max), calc(100% - var(--page-gutter)));
    padding: var(--space-700) 0 var(--space-800);
    margin: 0 auto;

    > .unit {
      max-width: 44rem;
      margin-bottom: var(--space-300);

      > .title {
        max-width: 16ch;
        font-size: var(--text-5xl);
      }

      > .text {
        &.-lead {
          margin-bottom: 0;
          color: var(--muted);
        }
      }
    }
  }

  @media (max-width: 620px) {
    > .section {
      width: min(var(--page-max), calc(100% - var(--page-gutter)));
    }
  }
}
</style>
