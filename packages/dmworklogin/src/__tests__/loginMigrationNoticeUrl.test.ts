import { describe, expect, it } from 'vitest'
import { resolveAegisRegisterUrl } from '../loginMigrationNoticeUrl'

describe('resolveAegisRegisterUrl', () => {
  it.each([
    ['https://accounts.example.com', 'https://accounts.example.com/register'],
    ['https://accounts-test.example.com', 'https://accounts-test.example.com/register'],
    ['https://accounts-test.example.com/', 'https://accounts-test.example.com/register'],
  ])('builds the register URL from appconfig account_url %s', (accountUrl, expected) => {
    expect(resolveAegisRegisterUrl(accountUrl)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    'javascript:alert(1)',
    'data:text/html,hello',
    '/account',
  ])('does not fall back when account_url is missing or unsafe: %s', (accountUrl) => {
    expect(resolveAegisRegisterUrl(accountUrl)).toBeUndefined()
  })
})
