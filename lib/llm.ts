const OPENROUTER_BASE = "https://openrouter.ai/api/v1"
const MODEL = "anthropic/claude-sonnet-4-5"

export async function chat(messages: { role: string; content: string }[], system?: string): Promise<string> {
  const allMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://neoflo.ai",
      "X-Title": "Neoflo Lead Qualification",
    },
    body: JSON.stringify({ model: MODEL, messages: allMessages, max_tokens: 2048 }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ""
}
