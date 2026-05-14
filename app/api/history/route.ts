import { NextRequest, NextResponse } from "next/server"
import { sql, initDb } from "@/lib/db"

export async function GET() {
  try {
    await initDb()
    const runs = await sql`SELECT * FROM runs ORDER BY created_at DESC LIMIT 50`
    return NextResponse.json({ runs })
  } catch (err) {
    console.error("GET history error:", err)
    return NextResponse.json({ runs: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDb()
    const { keywords, company_count, enriched, emails, contacts } = await req.json()

    const runRows = await sql`
      INSERT INTO runs (keywords, company_count)
      VALUES (${JSON.stringify(keywords)}, ${company_count})
      RETURNING id
    `
    const runId = runRows[0].id

    if (enriched?.length) {
      for (const e of enriched) {
        await sql`
          INSERT INTO enriched_companies (run_id, company, data)
          VALUES (${runId}, ${e.company}, ${JSON.stringify(e.data ?? {})})
        `
      }
    }

    if (emails?.length) {
      for (const e of emails) {
        await sql`
          INSERT INTO email_drafts (run_id, company, subject, body)
          VALUES (${runId}, ${e.company}, ${e.subject ?? ""}, ${e.body ?? ""})
        `
      }
    }

    if (contacts?.length) {
      for (const row of contacts) {
        for (const c of row.contacts ?? []) {
          if (!c.name || c.name.toLowerCase() === "unknown") continue
          await sql`
            INSERT INTO contacts (run_id, company, name, role, linkedin, confidence)
            VALUES (${runId}, ${row.company}, ${c.name}, ${c.role}, ${c.linkedin ?? null}, ${c.confidence})
          `
        }
      }
    }

    return NextResponse.json({ ok: true, runId })
  } catch (err) {
    console.error("POST history error:", err)
    return NextResponse.json({ error: "Failed to save run" }, { status: 500 })
  }
}
