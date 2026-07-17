const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'

export type BraveFreshness = 'pd' | 'pw' | 'pm' | 'py'

type BraveWebResult = {
  title?: string
  url?: string
  description?: string
  age?: string
  extra_snippets?: string[]
}

type BraveSearchResponse = {
  query?: { original?: string; more_results_available?: boolean }
  web?: { results?: BraveWebResult[] }
}

function plainText(value: string | undefined) {
  return (value ?? '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function searchBraveWeb({
  query,
  count = 6,
  freshness,
}: {
  query: string
  count?: number
  freshness?: BraveFreshness
}) {
  const apiKey = process.env.BRAVE_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Brave Search is not configured. Add BRAVE_API_KEY to .env.local and restart the app.')
  }

  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error('A Brave Search query is required.')
  if (normalizedQuery.length > 400 || normalizedQuery.split(/\s+/).length > 50) {
    throw new Error('Brave Search queries must be at most 400 characters and 50 words.')
  }

  const safeCount = Math.max(1, Math.min(20, Math.trunc(count)))
  const url = new URL(BRAVE_WEB_SEARCH_URL)
  url.searchParams.set('q', normalizedQuery)
  url.searchParams.set('count', String(safeCount))
  url.searchParams.set('search_lang', 'en')
  url.searchParams.set('safesearch', 'moderate')
  url.searchParams.set('extra_snippets', 'true')
  if (freshness) url.searchParams.set('freshness', freshness)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!response.ok) {
    const detail = plainText((await response.text()).slice(0, 300))
    throw new Error(`Brave Search request failed (${response.status})${detail ? `: ${detail}` : '.'}`)
  }

  const data = (await response.json()) as BraveSearchResponse
  return {
    query: data.query?.original ?? normalizedQuery,
    moreResultsAvailable: data.query?.more_results_available ?? false,
    results: (data.web?.results ?? [])
      .filter((result): result is BraveWebResult & { title: string; url: string } => Boolean(result.title && result.url))
      .slice(0, safeCount)
      .map((result) => ({
        title: plainText(result.title),
        url: result.url,
        description: plainText(result.description),
        age: result.age,
        extraSnippets: (result.extra_snippets ?? []).map(plainText).filter(Boolean),
      })),
  }
}
