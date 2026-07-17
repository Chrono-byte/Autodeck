import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchBraveWeb } from './brave-search.server'

beforeEach(() => {
  delete process.env.BRAVE_API_KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BRAVE_API_KEY
})

describe('searchBraveWeb', () => {
  it('requires the configured environment key', async () => {
    await expect(searchBraveWeb({ query: 'Commander deck tech' })).rejects.toThrow('BRAVE_API_KEY')
  })

  it('sends the key only in the subscription header and normalizes results', async () => {
    process.env.BRAVE_API_KEY = 'test-secret'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query: { original: 'Atraxa deck tech', more_results_available: true },
      web: { results: [{
        title: '<strong>Atraxa</strong> guide',
        url: 'https://example.com/atraxa',
        description: 'A &amp; B',
        extra_snippets: ['Proliferate <b>strategy</b>'],
      }] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchBraveWeb({ query: 'Atraxa deck tech', count: 50, freshness: 'pm' })
    const [requestedUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit]

    expect(requestedUrl.searchParams.get('count')).toBe('20')
    expect(requestedUrl.searchParams.get('freshness')).toBe('pm')
    expect(requestedUrl.toString()).not.toContain('test-secret')
    expect(new Headers(init.headers).get('X-Subscription-Token')).toBe('test-secret')
    expect(result.results[0]).toMatchObject({
      title: 'Atraxa guide',
      description: 'A & B',
      extraSnippets: ['Proliferate strategy'],
    })
  })

  it('reports upstream errors without exposing the API key', async () => {
    process.env.BRAVE_API_KEY = 'never-expose-this'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Rate limit exceeded', { status: 429 })))
    const error = await searchBraveWeb({ query: 'deck guide' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('Brave Search request failed (429)')
    expect((error as Error).message).not.toContain('never-expose-this')
  })
})
