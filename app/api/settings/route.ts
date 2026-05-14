import { NextRequest, NextResponse } from "next/server"
import { sql, initDb } from "@/lib/db"

export async function GET() {
  try {
    await initDb()
    const rows = await sql`SELECT * FROM settings ORDER BY id LIMIT 1`
    if (rows.length === 0) return NextResponse.json({ keywords: [], positioning: "", icp: "", email_template: "" })
    const row = rows[0]
    return NextResponse.json({
      keywords: row.keywords,
      positioning: row.positioning,
      icp: row.icp,
      email_template: row.email_template,
    })
  } catch (err) {
    console.error("GET settings error:", err)
    return NextResponse.json({ keywords: [], positioning: "", icp: "", email_template: "" })
  }
}

export async function PUT(req: NextRequest) {
  try {
    await initDb()
    const { keywords, positioning, icp, email_template } = await req.json()
    const existing = await sql`SELECT id FROM settings LIMIT 1`
    if (existing.length === 0) {
      await sql`
        INSERT INTO settings (keywords, positioning, icp, email_template)
        VALUES (${JSON.stringify(keywords)}, ${positioning}, ${icp}, ${email_template})
      `
    } else {
      await sql`
        UPDATE settings SET
          keywords = ${JSON.stringify(keywords)},
          positioning = ${positioning},
          icp = ${icp},
          email_template = ${email_template},
          updated_at = NOW()
        WHERE id = ${existing[0].id}
      `
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("PUT settings error:", err)
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }
}
