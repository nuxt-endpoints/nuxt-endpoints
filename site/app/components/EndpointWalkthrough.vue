<script setup lang="ts">
import { ShikiMagicMovePrecompiled } from '@shikijs/magic-move/vue'
import '@shikijs/magic-move/style.css'
import { magicTokens } from '../utils/magic-tokens.generated'
import { contractSteps, magicCodeBlocks } from '../utils/snippets'

type MagicCodeBlock = (typeof magicCodeBlocks)[number]

const props = defineProps<{
  modelValue?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const activeStepIndex = computed({
  get: () => props.modelValue ?? 0,
  set: (value) => emit('update:modelValue', value),
})
const activeStep = computed(() => contractSteps[activeStepIndex.value] ?? contractSteps[0])
const highlightsVisible = ref(true)
const isMagicMoving = ref(false)
const isIndicatorPaused = ref(false)
let stepTimer: ReturnType<typeof setTimeout> | undefined
let highlightRevealTimer: ReturnType<typeof setTimeout> | undefined
let autoplayTimer: ReturnType<typeof setTimeout> | undefined
let autoplayStartedAt: number | undefined

const magicTiming = {
  autoplayDelayMs: 5200,
  durationMs: 1900,
  delayMoveRatio: 0.04,
  delayEnterRatio: 0.06,
  delayLeaveRatio: 0,
  delayContainerRatio: 0.08,
  highlightFadeMs: 320,
  highlightRevealLeadMs: 0,
} as const

let autoplayRemainingMs = magicTiming.autoplayDelayMs

const magicStyle = {
  '--local-magic-highlight-fade-ms': `${magicTiming.highlightFadeMs}ms`,
  '--local-magic-indicator-transition-ms': `${magicTiming.durationMs}ms`,
  '--local-magic-step-progress-ms': `${magicTiming.autoplayDelayMs}ms`,
} as Record<string, string>

const magicSettleMs = Math.ceil(
  magicTiming.durationMs *
    (1 +
      Math.max(
        magicTiming.delayMoveRatio,
        magicTiming.delayEnterRatio,
        magicTiming.delayContainerRatio,
      )) +
    -magicTiming.highlightRevealLeadMs,
)

const magicOptions = {
  duration: magicTiming.durationMs,
  delayMove: magicTiming.delayMoveRatio,
  delayEnter: magicTiming.delayEnterRatio,
  delayLeave: magicTiming.delayLeaveRatio,
  delayContainer: magicTiming.delayContainerRatio,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  stagger: 0,
  enhanceMatching: true,
  containerStyle: false,
  animateContainer: true,
}

const isAutoplayPaused = computed(() => isIndicatorPaused.value)

function clearTransitionTimers() {
  clearTimeout(stepTimer)
  clearTimeout(highlightRevealTimer)
}

function clearAutoplayTimer() {
  clearTimeout(autoplayTimer)
  autoplayTimer = undefined
}

function pauseAutoplayTimer() {
  if (autoplayTimer && autoplayStartedAt !== undefined) {
    const elapsedMs = Date.now() - autoplayStartedAt
    autoplayRemainingMs = Math.max(300, autoplayRemainingMs - elapsedMs)
  }
  clearAutoplayTimer()
  autoplayStartedAt = undefined
}

function resetAutoplayProgress() {
  pauseAutoplayTimer()
  autoplayRemainingMs = magicTiming.autoplayDelayMs
}

function startAutoplayTimer() {
  clearAutoplayTimer()

  if (isAutoplayPaused.value || isMagicMoving.value) {
    return
  }

  autoplayStartedAt = Date.now()
  autoplayTimer = setTimeout(() => {
    resetAutoplayProgress()
    goToStep((activeStepIndex.value + 1) % contractSteps.length)
  }, autoplayRemainingMs)
}

function goToStep(index: number) {
  if (index === activeStepIndex.value) {
    return
  }

  const shouldFadeOutHighlights = highlightsVisible.value

  clearTransitionTimers()
  clearAutoplayTimer()
  isMagicMoving.value = false
  highlightsVisible.value = false

  const startMagicMove = () => {
    isMagicMoving.value = true
    activeStepIndex.value = index
    highlightRevealTimer = setTimeout(revealHighlights, magicSettleMs)
  }

  if (shouldFadeOutHighlights) {
    stepTimer = setTimeout(startMagicMove, magicTiming.highlightFadeMs)
  } else {
    startMagicMove()
  }
}

function selectStep(index: number) {
  if (index === activeStepIndex.value) {
    return
  }

  goToStep(index)
}

function revealHighlights() {
  clearTimeout(highlightRevealTimer)
  isMagicMoving.value = false
  if (import.meta.server) {
    highlightsVisible.value = true
    return
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      highlightsVisible.value = true
    })
  })
}

onBeforeUnmount(() => {
  clearTransitionTimers()
  clearAutoplayTimer()
})

if (import.meta.client) {
  watch(activeStepIndex, resetAutoplayProgress)
  watch(
    [isAutoplayPaused, isMagicMoving],
    () => {
      if (isAutoplayPaused.value || isMagicMoving.value) {
        pauseAutoplayTimer()
      } else {
        startAutoplayTimer()
      }
    },
    { immediate: true },
  )
}

function pauseOnIndicatorEnter(event: PointerEvent) {
  if (event.pointerType !== 'touch') {
    isIndicatorPaused.value = true
  }
}

function resumeOnIndicatorLeave(event: PointerEvent) {
  if (event.pointerType !== 'touch') {
    isIndicatorPaused.value = false
  }
}

function getStepButtonLabel(step: (typeof contractSteps)[number], index: number) {
  const state =
    activeStepIndex.value === index ? (isAutoplayPaused.value ? 'paused' : 'active') : 'inactive'

  return `Show ${step.shortTitle} step (${state})`
}

function isCodeBlockVisibleAtStep(block: MagicCodeBlock, stepIndex: number) {
  return block.visibleFromStep === undefined || stepIndex >= block.visibleFromStep
}

function isCodeBlockHidden(block: MagicCodeBlock) {
  return !isCodeBlockVisibleAtStep(block, activeStepIndex.value)
}

function getCodeRows(block: MagicCodeBlock) {
  const code = activeStep.value[block.codeKey]
  const lineCount = code === '' ? 1 : code.split('\n').length

  return Array.from({ length: lineCount }, (_, index) => index + 1)
}

function isHighlightedLine(block: MagicCodeBlock, line: number) {
  return highlightsVisible.value && activeStep.value.highlightLines[block.codeKey].includes(line)
}
</script>

<template>
  <div
    class="ne-endpoint-walkthrough"
    :data-paused="isAutoplayPaused ? 'true' : undefined"
    :style="magicStyle"
  >
    <div
      class="actions"
      :data-progress-paused="isAutoplayPaused || isMagicMoving ? 'true' : undefined"
      aria-label="Endpoint contract build steps"
    >
      <button
        v-for="(step, index) in contractSteps"
        :key="step.shortTitle"
        class="button"
        type="button"
        :aria-label="getStepButtonLabel(step, index)"
        :aria-pressed="activeStepIndex === index"
        @pointerenter="pauseOnIndicatorEnter"
        @pointerleave="resumeOnIndicatorLeave"
        @click="selectStep(index)"
      >
        <span class="value" aria-hidden="true" />
      </button>
    </div>

    <div class="unit">
      <article
        v-for="block in magicCodeBlocks"
        :key="block.codeKey"
        class="article"
        :aria-hidden="isCodeBlockHidden(block)"
      >
        <div class="seg -bar">
          <span class="value -side">{{ block.side }}</span>
          <span class="value -path">{{ block.title }}</span>
        </div>
        <div class="seg -scroll">
          <div class="fr -highlights" aria-hidden="true">
            <span
              v-for="line in getCodeRows(block)"
              :key="line"
              class="g"
              :data-active="isHighlightedLine(block, line) ? 'true' : undefined"
            />
          </div>
          <template v-if="magicTokens">
            <div class="fr -light">
              <ShikiMagicMovePrecompiled
                :steps="magicTokens[block.codeKey].light"
                :step="activeStepIndex"
                :options="magicOptions"
              />
            </div>
            <div class="fr -dark">
              <ShikiMagicMovePrecompiled
                :steps="magicTokens[block.codeKey].dark"
                :step="activeStepIndex"
                :options="magicOptions"
              />
            </div>
          </template>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.ne-endpoint-walkthrough {
  display: grid;
  align-content: start;
  gap: var(--space-200);

  > .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-075);

    > .button {
      display: inline-flex;
      height: 1.4rem;
      align-items: center;
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      padding: 0;

      > .value {
        display: block;
        position: relative;
        overflow: hidden;
        width: 1.1rem;
        height: 0.32rem;
        border-radius: var(--radius-pill);
        background: var(--line);
        opacity: 0.78;
        transition:
          background-color 0.28s ease,
          height 0.38s cubic-bezier(0.22, 1, 0.36, 1),
          opacity 0.28s ease,
          width var(--local-magic-indicator-transition-ms, 1900ms) cubic-bezier(0.22, 1, 0.36, 1);
      }

      &:hover > .value {
        background: var(--button-hover-border);
        opacity: 1;
      }

      &:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: var(--focus-offset-lg);
      }

      &[aria-pressed='true'] > .value {
        width: 3.6rem;
        height: 0.55rem;
        background: var(--indicator-active-bg);
        opacity: 1;

        &::before {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          animation: magic-step-progress var(--local-magic-step-progress-ms, 5200ms) linear forwards;
          background: var(--accent);
          content: '';
          transform: scaleX(0);
          transform-origin: left center;
        }

        &::after {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          animation: magic-step-stripes 0.9s linear infinite;
          background-image: repeating-linear-gradient(
            135deg,
            var(--ew-stripe) 0 0.22rem,
            transparent 0.22rem 0.48rem
          );
          background-size: 0.7rem 0.7rem;
          content: '';
          opacity: 0.42;
          pointer-events: none;
        }
      }
    }

    &[data-progress-paused='true'] > .button[aria-pressed='true'] > .value::before,
    &[data-progress-paused='true'] > .button[aria-pressed='true'] > .value::after {
      animation-play-state: paused;
    }
  }

  &[data-paused='true'] > .actions > .button[aria-pressed='true'] > .value {
    height: 0.32rem;
  }

  > .unit {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-200);

    > .article {
      min-width: 0;
      overflow: hidden;
      position: relative;
      border: var(--stroke-default) solid
        color-mix(in srgb, var(--hero-code-glass-border) 88%, transparent);
      border-radius: var(--radius-md);
      background:
        linear-gradient(
          145deg,
          color-mix(in srgb, var(--hero-code-glass-sheen) 82%, transparent),
          transparent 38%
        ),
        radial-gradient(
          circle at 12% -6%,
          color-mix(in srgb, var(--hero-gradient-start) 14%, transparent) 0,
          transparent 38%
        ),
        radial-gradient(
          circle at 100% 18%,
          color-mix(in srgb, var(--hero-gradient-cyan) 13%, transparent) 0,
          transparent 36%
        ),
        color-mix(in srgb, var(--hero-code-glass-bg) 82%, transparent);
      color: var(--code-ink);
      backdrop-filter: blur(28px) saturate(1.34);
      box-shadow: var(--ew-panel-shadow);
      opacity: 1;
      transition:
        opacity 0.28s ease,
        visibility 0s linear 0s;
      visibility: visible;
      -webkit-backdrop-filter: blur(28px) saturate(1.34);

      &::before {
        position: absolute;
        inset: 0;
        z-index: 0;
        background: linear-gradient(
          115deg,
          transparent 0 40%,
          var(--ew-panel-flare) 50%,
          transparent 60% 100%
        );
        content: '';
        opacity: var(--ew-panel-sheen-opacity);
        pointer-events: none;
      }

      &::after {
        position: absolute;
        inset: 1px;
        z-index: 0;
        border: var(--stroke-default) solid var(--ew-panel-edge-color);
        border-radius: var(--radius-md);
        background:
          linear-gradient(180deg, var(--ew-panel-edge-top), transparent 28%),
          linear-gradient(
            90deg,
            var(--ew-panel-edge-start),
            transparent 34% 66%,
            var(--ew-panel-edge-end)
          );
        content: '';
        opacity: var(--ew-panel-edge-opacity);
        pointer-events: none;
      }

      &[aria-hidden='true'] {
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 0.2s ease,
          visibility 0s linear 0.2s;
        visibility: hidden;
      }

      &:first-child > .seg.-scroll {
        min-height: 9.7rem;
      }

      > .seg.-bar {
        display: flex;
        min-width: 0;
        position: relative;
        z-index: 1;
        align-items: center;
        gap: var(--space-100);
        margin: 0;
        border-bottom: var(--stroke-default) solid var(--hero-code-glass-line);
        background: var(--ew-title-bg);
        backdrop-filter: blur(16px) saturate(1.18);
        color: var(--code-muted);
        font-size: var(--text-xs);
        font-weight: 720;
        padding: var(--space-150) var(--space-200);
        -webkit-backdrop-filter: blur(16px) saturate(1.18);

        > .value.-side {
          flex: 0 0 auto;
          color: var(--ink);
          font-size: var(--text-xs);
          font-weight: 820;
          text-transform: uppercase;
        }

        > .value.-path {
          min-width: 0;
          overflow: hidden;
          color: var(--code-muted);
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
          font-size: var(--text-xs);
          font-weight: 560;
          opacity: 0.62;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      > .seg.-scroll {
        --magic-code-font-size: 0.78rem;
        --magic-code-line-box: 1.16rem;
        --magic-code-padding-x: 0.82rem;
        --magic-code-padding-y: 0.78rem;
        --magic-highlight-padding-x: 0.24rem;
        position: relative;
        z-index: 1;
        overflow-x: auto;
        background: var(--ew-scroll-bg);
        backdrop-filter: blur(12px) saturate(1.12);
        -webkit-backdrop-filter: blur(12px) saturate(1.12);

        > .fr.-highlights {
          position: absolute;
          z-index: 0;
          inset: 0;
          min-width: 100%;
          padding: var(--magic-code-padding-y) 0;
          pointer-events: none;

          > .g {
            display: block;
            height: var(--magic-code-line-box);
            margin: 0 calc(var(--magic-code-padding-x) - var(--magic-highlight-padding-x));
            background: var(--ew-highlight-bg);
            opacity: 0;
            transition:
              background-color 0.16s ease,
              opacity var(--local-magic-highlight-fade-ms, 240ms) cubic-bezier(0.22, 1, 0.36, 1);

            &[data-active='true'] {
              opacity: 1;
            }
          }
        }

        > .fr.-light,
        > .fr.-dark {
          position: relative;
          z-index: 1;
        }

        > .fr.-light {
          display: var(--code-theme-light-display);
        }

        > .fr.-dark {
          display: var(--code-theme-dark-display);
        }
      }
    }
  }

  @media (max-width: 620px) {
    > .unit > .article > .seg.-scroll {
      --magic-code-font-size: 0.78rem;
      --magic-code-line-box: 1.15rem;
      --magic-code-padding-x: 0.9rem;
      --magic-code-padding-y: 0.85rem;
      --magic-highlight-padding-x: 0.24rem;
    }
  }
}

/* shiki-magic-move output is non-owned DOM. This :deep() rule stays un-nested:
   Vue's scoped compiler mis-emits :deep() inside nested rules. */
.ne-endpoint-walkthrough
  > .unit
  > .article
  > .seg.-scroll
  > .fr
  :deep(.shiki-magic-move-container) {
  margin: 0;
  overflow: visible;
  padding: var(--magic-code-padding-y) var(--magic-code-padding-x);
  background: transparent !important;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: var(--magic-code-font-size);
  line-height: var(--magic-code-line-box);
}

@keyframes magic-step-progress {
  to {
    transform: scaleX(1);
  }
}

@keyframes magic-step-stripes {
  to {
    background-position: 0.7rem 0;
  }
}
</style>
