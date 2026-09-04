<script setup lang="ts">
// Proof of concept for docs/progressive-enhancement.md.
//
// Nothing here is form plumbing. `useEndpointForm` takes the same request
// `$endpoint` would take and projects it into what a `<form>` needs - the
// element's attributes, one attribute set per declared field, and the issues
// from whichever path actually ran.
//
// With JavaScript, `enhance` takes over and no navigation happens. Without it,
// the browser posts to this page's own URL, the bridge middleware forwards the
// submission to `/api/users`, and either sends a 303 or renders this page again
// with the endpoint's issues in it - one request, no redirect, no cookie.
const form = useEndpointForm('/api/users', { method: 'post', body: { name: '' } })

const route = useRoute()
</script>

<template>
  <div class="ne-pe-page">
    <h1 class="title">Native form, no JavaScript</h1>

    <p v-if="route.query.created" class="text -success" data-testid="created">
      Created user {{ route.query.created }}
    </p>

    <p v-if="form.allIssues.value.length" class="text -error" data-testid="failed">
      Rejected with {{ form.status.value }}
    </p>

    <form v-bind="form.attrs" class="form" @submit="form.enhance">
      <label class="label">
        Name
        <input v-bind="form.fields.name" class="input" />
      </label>

      <label class="label">
        Age
        <input v-bind="form.fields.age" class="input" type="number" />
      </label>

      <ul v-if="form.allIssues.value.length" class="list" data-testid="issues">
        <li
          v-for="issue in form.allIssues.value"
          :key="`${issue.path}:${issue.message}`"
          class="item"
        >
          {{ issue.path }}: {{ issue.message }}
        </li>
      </ul>

      <button type="submit" class="button" :disabled="form.pending.value">Create</button>
    </form>
  </div>
</template>
