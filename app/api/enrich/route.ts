import { NextRequest, NextResponse } from "next/server"
import { chat } from "@/lib/llm"

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

// ─── Tavily search + extract (primary when key present) ───────────────────────

type TavilyResult = { title: string; url: string; content: string; raw_content?: string; score: number }

async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_raw_content: true,
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`)
  const data = await res.json()
  return data.results ?? []
}

async function tavilyExtract(urls: string[]): Promise<Record<string, string>> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, urls }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) return {}
  const data = await res.json()
  const map: Record<string, string> = {}
  for (const r of data.results ?? []) {
    if (r.raw_content) map[r.url] = r.raw_content.slice(0, 5000)
  }
  return map
}

// ─── Jina Reader fallback ─────────────────────────────────────────────────────

async function readUrl(url: string, maxChars = 4000): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        ...FETCH_HEADERS,
        "Accept": "text/plain",
        "X-Timeout": "15",
        "X-Remove-Selector": "nav, footer, header, [class*='cookie'], [class*='banner'], [id*='cookie']",
      },
      signal: AbortSignal.timeout(18000),
    })
    if (!res.ok) return ""
    const text = await res.text()
    return text.slice(0, maxChars)
  } catch {
    return ""
  }
}

// ─── DuckDuckGo fallback search ───────────────────────────────────────────────

type SearchResult = { title: string; snippet: string; link: string }

async function ddgSearch(query: string, num = 8): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) }
    )
    const html = await res.text()
    const results: SearchResult[] = []
    const titleRe = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g
    const snippetRe = /<a class="result__snippet"[^>]*>([^<]*)<\/a>/g
    const links: string[] = [], titles: string[] = [], snippets: string[] = []
    let m
    while ((m = titleRe.exec(html)) !== null) { links.push(m[1]); titles.push(m[2].trim()) }
    while ((m = snippetRe.exec(html)) !== null) snippets.push(m[1].trim())
    for (let i = 0; i < Math.min(titles.length, num); i++) {
      results.push({ title: titles[i], snippet: snippets[i] ?? "", link: links[i] ?? "" })
    }
    return results
  } catch { return [] }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { company, keywords } = await req.json() as { company: string; keywords: string[] }

    const directDomain = `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`
    let fullContext = ""

    if (process.env.TAVILY_API_KEY) {
      // ── Tavily path ──────────────────────────────────────────────────────────
      const [generalResults, statsResults] = await Promise.all([
        tavilySearch(`${company} company overview site:${company.toLowerCase().replace(/\s+/g, "")}.com OR site:crunchbase.com OR site:linkedin.com`, 5),
        tavilySearch(`"${company}" revenue customers employees ${new Date().getFullYear()} statistics annual report`, 5),
      ])

      const allResults = [...generalResults, ...statsResults]

      // Collect content already returned by Tavily search
      const searchContent = allResults
        .filter((r) => r.raw_content || r.content)
        .map((r) => `\n=== ${r.url} ===\n${(r.raw_content ?? r.content).slice(0, 5000)}`)
        .join("\n\n")

      // Extract homepage + subpages via Tavily extract
      const pagesToExtract = [
        directDomain,
        `${directDomain}/about`,
        `${directDomain}/customers`,
        `${directDomain}/about-us`,
      ]
      const extracted = await tavilyExtract(pagesToExtract)
      const extractContent = Object.entries(extracted)
        .map(([url, content]) => `\n=== ${url} ===\n${content}`)
        .join("\n\n")

      fullContext = [
        extractContent && `COMPANY PAGES:\n${extractContent}`,
        searchContent && `WEB SEARCH RESULTS:\n${searchContent}`,
      ].filter(Boolean).join("\n\n")

    } else {
      // ── Jina + DuckDuckGo fallback path ──────────────────────────────────────
      const [generalResults, statsResults] = await Promise.all([
        ddgSearch(`${company} official website`),
        ddgSearch(`"${company}" customers employees revenue ${new Date().getFullYear()} statistics`),
      ])

      const allResults = [...generalResults, ...statsResults]

      const pagesToCrawl = [
        directDomain,
        `${directDomain}/about`,
        `${directDomain}/customers`,
        `${directDomain}/about-us`,
        ...allResults
          .filter((r) => r.link && !r.link.includes("duckduckgo") && !r.link.includes("bing.com"))
          .slice(0, 4)
          .map((r) => r.link),
      ]

      const crawlResults = await Promise.all(
        pagesToCrawl.slice(0, 8).map(async (url) => {
          const content = await readUrl(url)
          return content ? `\n=== ${url} ===\n${content}` : ""
        })
      )

      const searchContext = allResults
        .filter((r) => r.snippet)
        .map((r) => `[${r.title}] ${r.snippet}`)
        .join("\n")

      fullContext = [
        crawlResults.filter(Boolean).join("\n\n") && `CRAWLED PAGES:\n${crawlResults.filter(Boolean).join("\n\n")}`,
        searchContext && `SEARCH SNIPPETS:\n${searchContext}`,
      ].filter(Boolean).join("\n\n")
    }

    const prompt = `You are a precise business research analyst. Extract data about "${company}" for the fields listed below.

PRIORITY ORDER:
1. Use the crawled/extracted content below as the primary source
2. If a field is missing from the content, use your training knowledge — do NOT leave fields null
3. Use "~" prefix only for genuinely uncertain estimates (e.g. "~$1.2B")

${fullContext}

Extract values for these fields: ${keywords.join(", ")}

Rules:
- Use the most specific number available (e.g. "4,200 customers" not "thousands")
- Prefix uncertain values with "~"
- For revenue: include year if known (e.g. "$2.1B (2024)")
- For brief/description: 2-3 sentences on what the company does and who it serves
- For pain points: top business pain points this company's customers face
- Only return null if you have absolutely no knowledge of the value

Return a JSON object with exactly these keys: ${keywords.map((k) => `"${k}"`).join(", ")}
Return only valid JSON. No markdown. No explanation.`

    const text = await chat(
      [{ role: "user", content: prompt }],
      "You are a business research analyst. Fill every field using provided content first, then training knowledge. Never return null if you know the answer. Return only valid JSON."
    )

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON in response")

    return NextResponse.json({ company, data: JSON.parse(jsonMatch[0]) })
  } catch (err) {
    console.error("Enrich error:", err)
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 })
  }
}
