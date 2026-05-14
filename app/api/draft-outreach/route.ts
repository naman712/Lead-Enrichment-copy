import { NextRequest, NextResponse } from "next/server"
import { chat } from "@/lib/llm"

export async function POST(req: NextRequest) {
  try {
    const { contact, company, enrichedData, positioning, icp } = await req.json() as {
      contact: { name: string; role: string }
      company: string
      enrichedData: Record<string, string | null>
      positioning: string
      icp?: string
    }

    const dataLines = Object.entries(enrichedData)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")

    const firstName = contact.name.split(" ")[0]

    const prompt = `You are writing outreach for a salesperson. Generate two things for reaching out to ${contact.name}, ${contact.role} at ${company}.

YOUR COMPANY POSITIONING:
${positioning || "A B2B SaaS company."}

TARGET: ${contact.name} (${contact.role}) at ${company}
${dataLines ? `\nCOMPANY CONTEXT:\n${dataLines}` : ""}
${icp ? `\nICP:\n${icp}` : ""}

Generate BOTH:

1. EMAIL — subject line + body
Rules:
- Subject + body separated by "---"
- Under 120 words total
- American English, active voice
- Open with a hook specific to ${company} or ${contact.role}
- One value prop tied to their pain points
- CTA: 15-min call
- Address them as "${firstName}"
- No "I hope this finds you well", no em dashes, no bullets in body
- Direct, peer-to-peer tone

2. LINKEDIN MESSAGE — short note (under 280 characters)
Rules:
- Start with their first name "${firstName},"
- Reference their role or company briefly
- One sentence value prop
- Ask to connect or chat
- Casual, not salesy
- No hashtags

FORMAT EXACTLY AS:
EMAIL_SUBJECT: [subject]
---
[email body]
===LINKEDIN===
[linkedin message]`

    const text = await chat([{ role: "user", content: prompt }])

    const linkedinSplit = text.split("===LINKEDIN===")
    const emailPart = linkedinSplit[0] ?? ""
    const linkedinMsg = linkedinSplit[1]?.trim() ?? ""

    const emailParts = emailPart.split("---")
    const subject = emailParts[0]?.replace("EMAIL_SUBJECT:", "").trim() ?? ""
    const body = emailParts[1]?.trim() ?? emailPart.trim()

    return NextResponse.json({ subject, body, linkedinMsg })
  } catch (err) {
    console.error("Draft outreach error:", err)
    return NextResponse.json({ error: "Outreach drafting failed" }, { status: 500 })
  }
}
