<template>
  <div class="ne-sqlite-vue-query-page">
    <header class="header">
      <p class="text -eyebrow">SQLite + Vue Query</p>
      <h1 class="title">Persistent queries and idempotent mutations</h1>
      <p class="text -lede">
        The list is server-rendered through <code class="code">useQuery</code>. Adding a row uses
        <code class="code">useMutation</code>, then invalidates the generated
        <code class="code">listSqliteUsers</code> key. The database file lives under
        <code class="code">playground/.data</code> for this local demo only.
      </p>
    </header>

    <section class="section -query">
      <header class="header">
        <div class="unit">
          <h2 class="title">SQLite users</h2>
          <p class="text -explanation">
            Create a row, then replay the exact POST to verify that the stored 201 response is
            returned without rerunning the handler.
          </p>
        </div>
        <div class="actions">
          <span class="status" role="status" :data-kind="sqliteUsersStatus">
            {{ sqliteUsersFetching ? 'fetching' : sqliteUsersStatus }}
          </span>
          <button type="button" class="button -secondary" @click="refetchSqliteUsers">
            Refetch
          </button>
        </div>
      </header>

      <form class="form" @submit.prevent="addSqliteUser">
        <label class="label">
          New SQLite user
          <input
            v-model="sqliteUserName"
            class="input"
            autocomplete="off"
            maxlength="80"
            placeholder="Margaret Hamilton"
            :disabled="sqliteUserCreating"
          />
        </label>
        <button
          class="button"
          type="submit"
          :disabled="sqliteUserCreating || !sqliteUserName.trim()"
        >
          {{ sqliteUserCreating ? 'Sending…' : 'Add with a new idempotency key' }}
        </button>
      </form>

      <div v-if="lastSqliteRequest" class="unit -idempotency">
        <div class="seg">
          <span class="text -key">Last Idempotency-Key</span>
          <code class="code">{{ lastSqliteRequest.key }}</code>
          <small class="note">
            First response: user #{{ lastSqliteRequest.firstId }}
            <template v-if="lastSqliteRequest.replayId">
              · replay response: user #{{ lastSqliteRequest.replayId }}
            </template>
          </small>
        </div>
        <button
          type="button"
          class="button -secondary"
          :disabled="sqliteUserCreating"
          @click="replaySqliteUser"
        >
          Replay the same POST
        </button>
      </div>

      <p v-if="lastSqliteRequest?.replayId" class="text -success">
        The completed response was replayed with the same user ID. This successful replay did not
        rerun the handler.
      </p>

      <p v-if="sqliteUsersError || sqliteUserCreateError" class="text -error">
        {{ sqliteUsersError || sqliteUserCreateError }}
      </p>
      <ul v-else class="list" aria-label="SQLite users">
        <li v-for="user in sqliteUsers?.items" :key="user.id" class="item">
          <strong class="strong">{{ user.name }}</strong>
          <span class="value -meta">#{{ user.id }} · {{ formatTimestamp(user.createdAt) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, onServerPrefetch, ref } from 'vue'
import { endpointMutationOptions, endpointQueryOptions } from '#endpoints/query'

const queryClient = useQueryClient()
const sqliteUserName = ref('Margaret Hamilton')
const lastSqliteRequest = ref<{
  key: string
  name: string
  firstId: number
  replayId?: number
}>()
const sqliteUsersQuery = useQuery(endpointQueryOptions.listSqliteUsers())
const sqliteUsers = sqliteUsersQuery.data
const sqliteUsersStatus = sqliteUsersQuery.status
const sqliteUsersFetching = sqliteUsersQuery.isFetching
const sqliteUsersError = computed(() => errorMessage(sqliteUsersQuery.error.value))

const sqliteUserMutation = useMutation({
  ...endpointMutationOptions.createSqliteUser(),
  onSuccess: async () => {
    await queryClient.invalidateQueries({
      queryKey: endpointQueryOptions.listSqliteUsers.key(),
    })
  },
})
const sqliteUserCreating = sqliteUserMutation.isPending
const sqliteUserCreateError = computed(() => errorMessage(sqliteUserMutation.error.value))

onServerPrefetch(() => sqliteUsersQuery.suspense())

function addSqliteUser() {
  const name = sqliteUserName.value.trim()
  if (!name) return

  const key = globalThis.crypto.randomUUID()
  sqliteUserMutation.mutate(
    {
      body: { name },
      idempotencyKey: key,
    },
    {
      onSuccess: (created) => {
        sqliteUserName.value = ''
        lastSqliteRequest.value = {
          key,
          name,
          firstId: created.id,
        }
      },
    },
  )
}

function replaySqliteUser() {
  const previous = lastSqliteRequest.value
  if (!previous) return

  sqliteUserMutation.mutate(
    {
      body: { name: previous.name },
      idempotencyKey: previous.key,
    },
    {
      onSuccess: (replayed) => {
        previous.replayId = replayed.id
      },
    },
  )
}

function refetchSqliteUsers() {
  return sqliteUsersQuery.refetch()
}

function formatTimestamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC')
}

function normalizeError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    return (error as { data?: unknown }).data
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return error
}

function errorMessage(error: unknown) {
  if (!error) return ''
  const normalized = normalizeError(error)
  if (typeof normalized === 'object' && normalized !== null && 'message' in normalized) {
    return String(normalized.message)
  }
  return String(normalized)
}
</script>

<style scoped>
.ne-sqlite-vue-query-page {
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

      > .code {
        border-radius: var(--pg-radius-xs);
        background: var(--pg-hover-bg);
        padding: var(--pg-space-100) var(--pg-space-150);
      }
    }
  }

  > .section.-query {
    border: var(--pg-stroke) solid var(--pg-line);
    border-radius: var(--pg-radius-lg);
    background: var(--pg-surface);
    padding: var(--pg-space-500);

    > .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--pg-space-600);

      > .unit {
        > .title {
          margin: 0;
          font-size: var(--pg-text-md);
        }

        > .text.-explanation {
          max-width: 720px;
          margin: var(--pg-space-250) 0 0;
          color: var(--pg-muted);
          font-size: var(--pg-text-sm);
          line-height: 1.55;
        }
      }

      > .actions {
        display: flex;
        align-items: center;
        gap: var(--pg-space-250);

        > .status {
          border-radius: var(--pg-radius-pill);
          background: var(--pg-hover-bg);
          color: var(--pg-muted);
          padding: var(--pg-space-100) var(--pg-space-225);
          font-size: var(--pg-text-xs);
          font-weight: 800;

          &[data-kind='success'] {
            background: var(--pg-success-bg);
            color: var(--pg-success-ink);
          }

          &[data-kind='error'] {
            background: var(--pg-error-bg);
            color: var(--pg-error-ink);
          }
        }
      }
    }

    > .form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 240px;
      align-items: end;
      gap: var(--pg-space-300);
      margin-top: var(--pg-space-450);

      > .label {
        display: grid;
        gap: var(--pg-space-150);
        margin: 0;
        color: var(--pg-muted);
        font-size: var(--pg-text-sm);
        font-weight: 700;

        > .input {
          width: 100%;
          border: var(--pg-stroke) solid var(--pg-line-strong);
          border-radius: var(--pg-radius-md);
          padding: var(--pg-space-250) var(--pg-space-300);
          color: var(--pg-ink);
          font: inherit;
        }
      }
    }

    > .header > .actions > .button,
    > .form > .button,
    > .unit.-idempotency > .button {
      min-height: 42px;
      border: var(--pg-stroke) solid var(--pg-action-bg);
      border-radius: var(--pg-radius-md);
      background: var(--pg-action-bg);
      color: var(--pg-action-ink);
      cursor: pointer;
      padding: var(--pg-space-200) var(--pg-space-300);
      font: inherit;
      font-weight: 700;

      &.-secondary {
        min-height: auto;
        border-color: var(--pg-line-strong);
        background: var(--pg-surface);
        color: var(--pg-ink);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
    }

    > .unit.-idempotency {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pg-space-400);
      margin-top: var(--pg-space-350);
      border: var(--pg-stroke) dashed var(--pg-line-dashed);
      border-radius: var(--pg-radius-md);
      background: var(--pg-bg);
      padding: var(--pg-space-300);

      > .seg {
        display: grid;
        gap: var(--pg-space-150);
        min-width: 0;

        > .text.-key {
          color: var(--pg-subtle);
          font-size: var(--pg-text-xs);
          font-weight: 800;
          text-transform: uppercase;
        }

        > .code {
          overflow: hidden;
          border-radius: var(--pg-radius-xs);
          background: var(--pg-hover-bg);
          color: var(--pg-muted);
          padding: var(--pg-space-100) var(--pg-space-150);
          text-overflow: ellipsis;
        }

        > .note {
          color: var(--pg-muted);
        }
      }
    }

    > .text.-success,
    > .text.-error {
      border-radius: var(--pg-radius-md);
      padding: var(--pg-space-250) var(--pg-space-300);
    }

    > .text.-success {
      margin: var(--pg-space-250) 0 0;
      background: var(--pg-success-bg);
      color: var(--pg-success-ink);
      font-size: var(--pg-text-note);
      font-weight: 700;
    }

    > .text.-error {
      margin: var(--pg-space-450) 0 0;
      background: var(--pg-error-bg);
      color: var(--pg-error-ink);
    }

    > .list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--pg-space-200);
      margin: var(--pg-space-450) 0 0;
      padding: 0;
      list-style: none;

      > .item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pg-space-300);
        border: var(--pg-stroke) solid var(--pg-line-soft);
        border-radius: var(--pg-radius-md);
        padding: var(--pg-space-275) var(--pg-space-300);

        > .value.-meta {
          color: var(--pg-subtle);
          font-size: var(--pg-text-xs);
          text-align: right;
        }
      }
    }
  }
}

@media (max-width: 760px) {
  .ne-sqlite-vue-query-page {
    > .header > .title {
      font-size: var(--pg-text-mobile-title);
    }

    > .section.-query {
      > .header,
      > .form,
      > .list {
        display: grid;
        grid-template-columns: 1fr;
      }

      > .header > .actions {
        justify-content: space-between;
      }

      > .unit.-idempotency {
        align-items: stretch;
        flex-direction: column;
      }
    }
  }
}
</style>
