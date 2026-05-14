import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][]

    // Find the column with company names — look for "company" header or use first column
    const headerRow = rows[0]?.map((h) => String(h).toLowerCase().trim()) ?? []
    const companyColIdx = headerRow.findIndex((h) =>
      h.includes("company") || h.includes("name") || h.includes("organization")
    )
    const colIdx = companyColIdx >= 0 ? companyColIdx : 0

    const companies = rows
      .slice(1)
      .map((row) => String(row[colIdx] ?? "").trim())
      .filter(Boolean)

    return NextResponse.json({ companies, total: companies.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Failed to parse file" }, { status: 500 })
  }
}
