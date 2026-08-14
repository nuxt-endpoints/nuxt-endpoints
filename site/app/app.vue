<template>
  <div class="ne-app">
    <AppHeader />
    <NuxtPage />
  </div>
</template>

<style scoped>
.ne-app {
  min-height: 100vh;

  > .ne-app-header {
    position: sticky;
    top: 0;
    z-index: 20;
  }
}
</style>
