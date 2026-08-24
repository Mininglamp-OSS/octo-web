import type { Preview } from '@storybook/react-vite'
import { OctoUIProvider } from '@octo/ui'
import React from 'react'

// 分层 CSS — 直接 import，不走 @import 链，避免 Vite 跨包路径问题
import '../../../packages/dmworkbase/src/theme/primitive.css'
import '../../../packages/dmworkbase/src/theme/semantic.css'
import '@octo/ui/styles.css'
import './preview.css'

const preview: Preview = {
  globalTypes: {
    theme: {
      name: 'Theme',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: '☀️ Light' },
          { value: 'dark', title: '🌙 Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme
      if (theme === 'dark') {
        document.body.setAttribute('theme-mode', 'dark')
      } else {
        document.body.removeAttribute('theme-mode')
      }
      return React.createElement(OctoUIProvider, null, Story())
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true },
  },
}

export default preview
