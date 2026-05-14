import { NextRequest, NextResponse } from "next/server"
import { chat } from "@/lib/llm"

export async function POST(req: NextRequest) {
  try {
    const { company, enrichedData, positioning, icp, emailTemplate } = await req.json() as {
      company: string
      enrichedData: Record<string, string | null>
      positioning: string
      icp?: string
      emailTemplate?: string
    }

    const dataLines = Object.entries(enrichedData)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")

    const prompt = `Write a cold outreach email for the following context.

YOUR COMPANY POSITIONING:
${positioning || "Not provided — write a generic professional outreach."}

TARGET COMPANY: ${company}
${dataLines ? `\nWHAT WE KNOW ABOUT THEM:\n${dataLines}` : ""}
${icp ? `\nIDEAL CUSTOMER PROFILE:\n${icp}` : ""}
${emailTemplate ? `\nEMAIL STRUCTURE / TONE GUIDANCE:\n${emailTemplate}` : ""}

REQUIREMENTS:
- Subject line + email body separated by "---"
- Under 150 words total
- American English, active voice
- Open with a specific hook tied to what we know about the company
- One clear value prop tied to their likely pain points
- Single CTA: ask for a 15-min call
- No filler phrases — no "I hope this email finds you well", no "Excited to share"
- Do NOT start with "My name is" — reference the sender's company from the positioning
- Direct and peer-to-peer in tone
- No em dashes, no bullet points in the body

FORMAT EXACTLY AS:
Subject: [subject line]
---
[email body]`

    const text = await chat([{ role: "user", content: prompt }])
    const parts = text.split("---")
    const subject = parts[0]?.replace("Subject:", "").trim() ?? ""
    const body = parts[1]?.trim() ?? text

    return NextResponse.json({ company, subject, body })
  } catch (err) {
    console.error("Draft email error:", err)
    return NextResponse.json({ error: "Email drafting failed" }, { status: 500 })
  }
}
