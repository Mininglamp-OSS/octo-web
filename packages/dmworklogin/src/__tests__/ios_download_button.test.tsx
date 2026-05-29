import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { i18n } from '@octo/base/src/i18n/instance'

import { IOSDownloadButton, IOS_DOWNLOAD_URL } from '../IOSDownloadButton'

describe('IOSDownloadButton', () => {
  beforeEach(() => {
    i18n.setLocale('zh-CN', { persist: false })
  })

  it('points at the public TestFlight URL', () => {
    expect(IOS_DOWNLOAD_URL).toBe('https://testflight.apple.com/join/uPrdCcy3')
  })

  it('renders an <a> with the TestFlight href opening safely in a new tab', () => {
    const html = renderToStaticMarkup(React.createElement(IOSDownloadButton))
    expect(html).toContain(`href="${IOS_DOWNLOAD_URL}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('下载 iOS 客户端')
    expect(html).toContain('wk-login-download-btn')
  })
})
