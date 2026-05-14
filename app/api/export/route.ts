import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"

export async function POST(req: NextRequest) {
  try {
    const { enrichedData, emails, contacts, keywords } = await req.json() as {
      enrichedData: Array<{ company: string; data: Record<string, string | null> }>
      emails: Array<{ company: string; subject: string; body: string }>
      contacts: Array<{ company: string; contacts: Array<Record<string, string>> }>
      keywords: string[]
    }

    const wb = XLSX.utils.book_new()

    // Sheet 1: Enriched Data
    if (enrichedData.length > 0) {
      const headers = ["Company", ...keywords]
      const rows = enrichedData.map((row) => [
        row.company,
        ...keywords.map((k) => row.data[k] ?? ""),
      ])
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      XLSX.utils.book_append_sheet(wb, ws, "Enriched Data")
    }

    // Sheet 2: Email Drafts
    if (emails.length > 0) {
      const headers = ["Company", "Subject", "Email Body"]
      const rows = emails.map((e) => [e.company, e.subject, e.body])
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      XLSX.utils.book_append_sheet(wb, ws, "Email Drafts")
    }

    // Sheet 3: Contacts
    const allContacts: string[][] = []
    contacts.forEach(({ company, contacts: cs }) => {
      cs.forEach((c) => {
        allContacts.push([company, c.name ?? "", c.role ?? "", c.linkedin ?? "", c.confidence ?? ""])
      })
    })
    if (allContacts.length > 0) {
      const ws = XLSX.utils.aoa_to_sheet([
        ["Company", "Name", "Role", "LinkedIn", "Confidence"],
        ...allContacts,
      ])
      XLSX.utils.book_append_sheet(wb, ws, "Contacts")
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leads-${Date.now()}.xlsx"`,
      },
    })
  } catch (err) {
    console.error("Export error:", err)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
