import nagiCss from '@nagi-labs/eslint-plugin-nagi-css'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  ...nagiCss.configs.recommended(
    {
      surfaceRootPrefixes: ['ne-'],
      componentClasses: {
        ContentRenderer: 'pv-content-renderer',
        Icon: 'pv-icon',
      },
      intrinsicComponents: {
        NuxtLink: 'a',
      },
      libraryBoundaryPrefixes: ['pv-'],
      tokens: {
        sources: [{ file: 'app/assets/css/base.css', layer: 'semantic' }],
      },
    },
    {
      files: ['app/**/*.vue'],
    },
  ),
  {
    files: ['app/**/*.vue'],
    rules: {
      // oxfmt owns this purely stylistic choice for Vue templates.
      'vue/html-self-closing': 'off',
    },
  },
)
