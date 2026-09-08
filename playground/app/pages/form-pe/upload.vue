<script setup lang="ts">
// Proof of concept for docs/progressive-enhancement.md: a `multipart/form-data`
// body, with a real file, going through the same projection as a urlencoded one.
//
// The file input's `type`, `accept` and `required` are not written here - they
// come from `z.file().max(4096).mime('text/plain')` on the endpoint, the same
// declaration the server enforces.
const form = useEndpointForm('/api/pe/upload', {
  method: 'post',
  mediaType: 'multipart/form-data',
  body: new FormData(),
})

const route = useRoute()
</script>

<template>
  <div class="ne-pe-page">
    <h1 class="title">Native file upload, no JavaScript</h1>

    <p v-if="route.query.stored" class="text -success" data-testid="stored">
      Stored {{ route.query.stored }} ({{ route.query.size }} bytes) for
      {{ route.query.session }}
    </p>

    <p v-if="form.allIssues.value.length" class="text -error" data-testid="failed">
      Rejected with {{ form.status.value }}
    </p>

    <ul v-if="form.allIssues.value.length" class="list" data-testid="issues">
      <li
        v-for="issue in form.allIssues.value"
        :key="`${issue.path}:${issue.message}`"
        class="item"
      >
        {{ issue.path }}: {{ issue.message }}
      </li>
    </ul>

    <form v-bind="form.attrs" class="form" @submit="form.enhance">
      <label class="label">
        Name
        <input v-bind="form.fields.name" class="input" />
      </label>

      <label class="label">
        Attachment
        <input v-bind="form.fields.attachment" class="input" />
      </label>

      <button type="submit" class="button" :disabled="form.pending.value">Upload</button>
    </form>
  </div>
</template>
