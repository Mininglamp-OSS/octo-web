import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOidcClient, isElectronDesktop } from '../electron'
import { OidcBindHttpError } from '../http'
import { createFetchHttpClient, fetchHttpClient } from '../http'

describe('electron runtime helpers', () => {
  const origLocation = window.location

  function setProtocol(protocol: 'file:' | 'http:' | 'https:') {
    // jsdom's window.location is read-only; redefine for the test.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...origLocation, protocol },
    })
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: origLocation,
    })
  })

  it('detects Electron packaged shell via file:// protocol', () => {
    setProtocol('file:')
    expect(isElectronDesktop()).toBe(true)
    setProtocol('http:')
    expect(isElectronDesktop()).toBe(false)
    setProtocol('https:')
    expect(isElectronDesktop()).toBe(false)
  })

  it('returns the absolute-base client under file:// with a valid apiURL', async () => {
    setProtocol('file:')
    const client = getOidcClient('https://api.example.com/v1/')
    expect(client).not.toBe(fetchHttpClient)

    // Sanity: relative path is resolved against apiURL.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    const realFetch = globalThis.fetch
    globalThis.fetch = fetchMock as never
    try {
      await client.get('/v1/user/thirdlogin/authcode')
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/user/thirdlogin/authcode')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('preserves HTTP status and backend message from the Electron proxy', async () => {
    setProtocol('file:')
    const invoke = vi.fn().mockResolvedValue({
      __octoOidcHttpResponse: true,
      ok: false,
      status: 409,
      body: { msg: 'already_verified' },
    })
    Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
    const client = getOidcClient('https://api.example.com')

    await expect(client.post('/v1/auth/oidc/aegis/bind/confirm', {}))
      .rejects.toMatchObject({
        constructor: OidcBindHttpError,
        status: 409,
        msg: 'already_verified',
      })
  })

  it('falls back to the apiClient-relative client under browser protocols', () => {
    setProtocol('https:')
    expect(getOidcClient('https://api.example.com')).toBe(fetchHttpClient)
    setProtocol('http:')
    expect(getOidcClient('http://api.example.com')).toBe(fetchHttpClient)
  })

  it('falls back to the default client when apiURL is empty or malformed under file://', () => {
    // Caller is responsible for surfacing this as a fatal misconfiguration;
    // getOidcClient itself must not throw so callers can decide how to react.
    setProtocol('file:')
    expect(getOidcClient('')).toBe(fetchHttpClient)
    expect(getOidcClient('not a url')).toBe(fetchHttpClient)
    expect(getOidcClient('file:///malicious')).toBe(fetchHttpClient)
  })

  it('re-uses createFetchHttpClient for equivalent apiURLs (shape check)', () => {
    // Not an identity check — createFetchHttpClient returns a fresh object
    // each call — but the returned shape must include get/post.
    setProtocol('file:')
    const client = getOidcClient('https://api.example.com')
    expect(typeof client.get).toBe('function')
    expect(typeof client.post).toBe('function')
    // Ensures we're not accidentally returning the shared singleton.
    expect(client).not.toBe(fetchHttpClient)
    // Reference kept so the import isn't tree-shaken from test coverage.
    void createFetchHttpClient
  })
})
