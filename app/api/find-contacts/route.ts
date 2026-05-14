import { NextRequest, NextResponse } from "next/server"
import { chat } from "@/lib/llm"

async function searchContacts(company: string): Promise<string> {
  if (process.env.TAVILY_API_KEY) {
    try {
      const queries = [
        `current CFO "VP Finance" "Head of Finance" Controller "${company}" 2024 2025`,
        `site:linkedin.com/in "${company}" CFO OR "VP Finance" OR "Finance Director" OR "Controller" OR "Head of Accounts Payable"`,
      ]

      const results = await Promise.all(queries.map((q) =>
        fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: q,
            search_depth: "advanced",
            max_results: 6,
            include_raw_content: false,
          }),
          signal: AbortSignal.timeout(15000),
        }).then((r) => r.json()).catch(() => ({ results: [] }))
      ))

      const allResults = results.flatMap((r) => r.results ?? []) as { title: string; content: string; url: string }[]

      // Separate LinkedIn profile URLs so they can be matched to names
      const linkedinProfiles = allResults
        .filter((r) => r.url.includes("linkedin.com/in/"))
        .map((r) => `LINKEDIN_PROFILE: ${r.title} | ${r.url}`)
        .join("\n")

      const otherResults = allResults
        .map((r) => `${r.title} | ${r.content} | ${r.url}`)
        .join("\n")

      return [linkedinProfiles, otherResults].filter(Boolean).join("\n")
    } catch {
      return ""
    }
  }

  // DuckDuckGo fallback
  const query = `${company} current CFO "VP Finance" "Finance Director" "Head of Finance" site:linkedin.com 2024 2025`
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" } }
    )
    const html = await res.text()
    const results: string[] = []
    const titleRe = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let tm, sm, i = 0
    while ((tm = titleRe.exec(html)) !== null) results.push(tm[1].replace(/<[^>]+>/g, "").trim())
    while ((sm = snippetRe.exec(html)) !== null) {
      if (results[i]) results[i] += " — " + sm[1].replace(/<[^>]+>/g, "").trim()
      i++
    }
    return results.slice(0, 8).join("\n")
  } catch {
    return ""
  }
}

export async function POST(req: NextRequest) {
  try {
    const { company, icp } = await req.json() as { company: string; icp?: string }

    const searchResults = await searchContacts(company)

    const prompt = `Find CURRENT finance and procurement decision-makers at "${company}" as of 2025.

${searchResults ? `Live search results (use these to verify current roles):\n${searchResults}\n` : ""}
${icp ? `\nTarget persona context:\n${icp}` : ""}

CRITICAL: Only include people who are CURRENTLY employed at ${company} right now. If search results show someone has moved to another company, do NOT include them.

Identify up to 6 contacts relevant for a B2B SaaS finance automation product (CFO, VP Finance, Finance Director, Controller, Head of AP, Procurement Head).

Return a JSON array. Each object must have exactly these keys:
- "name": full name (string or null if not found in search results)
- "role": current job title at ${company}
- "linkedin": LinkedIn profile URL — use the exact URL from any "LINKEDIN_PROFILE:" line that matches this person's name. If no match found, return null. Never fabricate a URL.
- "confidence": "high" if confirmed in search results, "medium" if partially confirmed, "low" if inferred

Return only the JSON array, no other text.`

    const text = await chat([{ role: "user", content: prompt }])
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error("No JSON array in response")

    return NextResponse.json({ company, contacts: JSON.parse(jsonMatch[0]) })
  } catch (err) {
    console.error("Find contacts error:", err)
    return NextResponse.json({ error: "Contact search failed" }, { status: 500 })
  }
}
