import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const [runRows, enrichedRows, emailRows, contactRows] = await Promise.all([
      sql`SELECT * FROM runs WHERE id = ${id}`,
      sql`SELECT * FROM enriched_companies WHERE run_id = ${id} ORDER BY created_at`,
      sql`SELECT * FROM email_drafts WHERE run_id = ${id} ORDER BY created_at`,
      sql`SELECT * FROM contacts WHERE run_id = ${id} ORDER BY company, confidence DESC`,
    ])
    if (!runRows.length) return NextResponse.json({ error: "Run not found" }, { status: 404 })
    return NextResponse.json({
      run: runRows[0],
      enriched: enrichedRows,
      emails: emailRows,
      contacts: contactRows,
    })
  } catch (err) {
    console.error("GET history/[id] error:", err)
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 })
  }
}
