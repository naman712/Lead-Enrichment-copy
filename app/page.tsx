"use client"

import { useState, useCallback, useRef, useEffect } from "react"

const BATCH_SIZE = 3

// ─── Types ────────────────────────────────────────────────────────────────────

type Settings = {
  keywords: string[]
  positioning: string
  icp: string
  emailTemplate: string
}

type EnrichedRow = {
  company: string
  data: Record<string, string | null>
  status: "pending" | "loading" | "done" | "error"
}

type Contact = {
  name: string | null
  role: string
  linkedin: string | null
  confidence: "high" | "medium" | "low"
}

type ContactRow = {
  company: string
  contacts: Contact[]
  status: "pending" | "loading" | "done" | "error"
}

type OutreachContact = {
  id: string
  company: string
  name: string
  role: string
  linkedin: string | null
  confidence: "high" | "medium" | "low"
  selected: boolean
  email?: { subject: string; body: string }
  linkedinMsg?: string
  status: "idle" | "loading" | "done" | "error"
}

type Tab = "upload" | "enrich" | "contacts" | "outreach" | "history"

type HistoryRun = {
  id: string
  keywords: string[]
  company_count: number
  created_at: string
}

type HistoryDetail = {
  run: HistoryRun
  enriched: Array<{ company: string; data: Record<string, string | null> }>
  emails: Array<{ company: string; subject: string; body: string }>
  contacts: Array<{ company: string; name: string; role: string; linkedin: string | null; confidence: string }>
}

const DEFAULT_SETTINGS: Settings = {
  keywords: ["Industry", "Employees", "Founded", "HQ Location", "Revenue"],
  positioning: "",
  icp: "",
  emailTemplate: "",
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<Tab>("upload")
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [companies, setCompanies] = useState<string[]>([])
  const [runKeywords, setRunKeywords] = useState<string[]>(DEFAULT_SETTINGS.keywords)
  const [enriched, setEnriched] = useState<EnrichedRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [outreach, setOutreach] = useState<OutreachContact[]>([])
  const [uploading, setUploading] = useState(false)
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([])
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load settings from DB on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const parsed: Settings = {
          keywords: data.keywords ?? DEFAULT_SETTINGS.keywords,
          positioning: data.positioning ?? "",
          icp: data.icp ?? "",
          emailTemplate: data.email_template ?? "",
        }
        setSettingsState(parsed)
        setRunKeywords(parsed.keywords)
      })
      .catch(() => {})
  }, [])

  const saveSettings = useCallback((s: Settings) => {
    setSettingsState(s)
    if (enriched.length === 0) setRunKeywords(s.keywords)
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords: s.keywords,
        positioning: s.positioning,
        icp: s.icp,
        email_template: s.emailTemplate,
      }),
    }).catch(() => {})
  }, [enriched.length])

  // ─── Upload ──────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/parse-excel", { method: "POST", body: fd })
    const json = await res.json()
    setUploading(false)
    if (json.companies?.length) {
      setCompanies(json.companies)
      setRunKeywords(settings.keywords)
      setEnriched([])
      setContacts([])
      setOutreach([])
    }
  }, [settings.keywords])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ─── Enrich ──────────────────────────────────────────────────────────────

  const startEnrich = async () => {
    setTab("enrich")
    const rows: EnrichedRow[] = companies.map((c) => ({ company: c, data: {}, status: "pending" }))
    setEnriched(rows)

    for (let bs = 0; bs < rows.length; bs += BATCH_SIZE) {
      setEnriched((prev) =>
        prev.map((r, i) => (i >= bs && i < bs + BATCH_SIZE ? { ...r, status: "loading" } : r))
      )
      await Promise.all(
        rows.slice(bs, bs + BATCH_SIZE).map(async (row, offset) => {
          const idx = bs + offset
          try {
            const res = await fetch("/api/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ company: row.company, keywords: runKeywords }),
            })
            const json = await res.json()
            setEnriched((prev) =>
              prev.map((r, i) => (i === idx ? { ...r, data: json.data ?? {}, status: "done" } : r))
            )
          } catch {
            setEnriched((prev) =>
              prev.map((r, i) => (i === idx ? { ...r, status: "error" } : r))
            )
          }
        })
      )
    }
  }

  // ─── Find People ─────────────────────────────────────────────────────────

  const startFindPeople = async () => {
    setTab("contacts")
    const rows: ContactRow[] = companies.map((c) => ({ company: c, contacts: [], status: "pending" }))
    setContacts(rows)
    let finalContacts = rows

    for (let bs = 0; bs < rows.length; bs += BATCH_SIZE) {
      setContacts((prev) =>
        prev.map((r, i) => (i >= bs && i < bs + BATCH_SIZE ? { ...r, status: "loading" } : r))
      )
      await Promise.all(
        rows.slice(bs, bs + BATCH_SIZE).map(async (row, offset) => {
          const idx = bs + offset
          try {
            const res = await fetch("/api/find-contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ company: row.company, icp: settings.icp }),
            })
            const json = await res.json()
            setContacts((prev) => {
              const next = prev.map((r, i) =>
                i === idx ? { ...r, contacts: json.contacts ?? [], status: "done" as const } : r
              )
              finalContacts = next
              return next
            })
          } catch {
            setContacts((prev) => {
              const next = prev.map((r, i) => (i === idx ? { ...r, status: "error" as const } : r))
              finalContacts = next
              return next
            })
          }
        })
      )
    }

    // Save run to DB
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: runKeywords,
          company_count: companies.length,
          enriched: enriched.filter((e) => e.status === "done"),
          emails: [],
          contacts: finalContacts,
        }),
      })
    } catch {}

    // Build outreach contacts list (pre-selected, all valid ones)
    const allContacts: OutreachContact[] = finalContacts
      .flatMap((row) =>
        (row.contacts ?? [])
          .filter((c) => c.name && c.name.toLowerCase() !== "unknown")
          .map((c, i) => ({
            id: `${row.company}-${i}`,
            company: row.company,
            name: c.name!,
            role: c.role,
            linkedin: c.linkedin,
            confidence: c.confidence,
            selected: true,
            status: "idle" as const,
          }))
      )
    setOutreach(allContacts)
  }

  // ─── Generate Outreach ───────────────────────────────────────────────────

  const startGenerateOutreach = async (selectedIds: string[]) => {
    setTab("outreach")
    const toGenerate = outreach.filter((c) => selectedIds.includes(c.id))

    setOutreach((prev) =>
      prev.map((c) => selectedIds.includes(c.id) ? { ...c, status: "loading" } : c)
    )

    for (let bs = 0; bs < toGenerate.length; bs += BATCH_SIZE) {
      await Promise.all(
        toGenerate.slice(bs, bs + BATCH_SIZE).map(async (contact) => {
          const enrichedRow = enriched.find((e) => e.company === contact.company)
          try {
            const res = await fetch("/api/draft-outreach", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contact: { name: contact.name, role: contact.role },
                company: contact.company,
                enrichedData: enrichedRow?.data ?? {},
                positioning: settings.positioning,
                icp: settings.icp,
              }),
            })
            const json = await res.json()
            setOutreach((prev) =>
              prev.map((c) =>
                c.id === contact.id
                  ? { ...c, email: { subject: json.subject, body: json.body }, linkedinMsg: json.linkedinMsg, status: "done" }
                  : c
              )
            )
          } catch {
            setOutreach((prev) =>
              prev.map((c) => (c.id === contact.id ? { ...c, status: "error" } : c))
            )
          }
        })
      )
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  const exportData = async () => {
    const emailsForExport = outreach
      .filter((c) => c.status === "done" && c.email)
      .map((c) => ({ company: c.company, subject: c.email!.subject, body: c.email!.body }))
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrichedData: enriched, emails: emailsForExport, contacts, keywords: runKeywords }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `leads-${Date.now()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── History ─────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/history")
    const data = await res.json()
    setHistoryRuns(data.runs ?? [])
  }, [])

  const loadHistoryDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/history/${id}`)
    const data = await res.json()
    setHistoryDetail(data)
  }, [])

  // ─── Nav state ───────────────────────────────────────────────────────────

  const doneCount = (arr: Array<{ status: string }>) => arr.filter((r) => r.status === "done").length
  const allEnrichedDone = enriched.length > 0 && doneCount(enriched) === enriched.length
  const allContactsDone = contacts.length > 0 && doneCount(contacts) === contacts.length

  const canAccess = (t: Tab) => {
    if (t === "upload" || t === "history") return true
    if (t === "enrich") return enriched.length > 0
    if (t === "contacts") return contacts.length > 0
    if (t === "outreach") return outreach.length > 0
    return false
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar
        tab={tab}
        setTab={setTab}
        canAccess={canAccess}
        enrichedDone={allEnrichedDone}
        contactsDone={allContactsDone}
        showExport={enriched.length > 0 || outreach.length > 0 || contacts.length > 0}
        onExport={exportData}
        onHistoryClick={loadHistory}
      />

      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {tab === "upload" && (
            <UploadPage
              companies={companies}
              settings={settings}
              runKeywords={runKeywords}
              setRunKeywords={setRunKeywords}
              uploading={uploading}
              fileRef={fileRef}
              onDrop={onDrop}
              onFile={handleFile}
              onStartEnrich={startEnrich}
              onSaveSettings={saveSettings}
            />
          )}
          {tab === "enrich" && (
            <EnrichPage
              enriched={enriched}
              keywords={runKeywords}
              doneCount={doneCount(enriched)}
              total={enriched.length}
              onFindPeople={startFindPeople}
            />
          )}
          {tab === "contacts" && (
            <ContactsPage
              contacts={contacts}
              outreach={outreach}
              doneCount={doneCount(contacts)}
              total={contacts.length}
              onGenerateOutreach={startGenerateOutreach}
              setOutreach={setOutreach}
            />
          )}
          {tab === "outreach" && (
            <OutreachPage
              outreach={outreach}
              setOutreach={setOutreach}
              onExport={exportData}
            />
          )}
          {tab === "history" && (
            <HistoryPage
              runs={historyRuns}
              detail={historyDetail}
              onLoad={loadHistory}
              onSelect={loadHistoryDetail}
              onBack={() => setHistoryDetail(null)}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  tab, setTab, canAccess, enrichedDone, contactsDone, showExport, onExport, onHistoryClick,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  canAccess: (t: Tab) => boolean
  enrichedDone: boolean
  contactsDone: boolean
  showExport: boolean
  onExport: () => void
  onHistoryClick: () => void
}) {
  const steps: { id: Tab; label: string; icon: React.ReactNode; hint?: string }[] = [
    { id: "upload", label: "Upload", icon: <IconUpload /> },
    { id: "enrich", label: "Enrich", icon: <IconSearch />, hint: !canAccess("enrich") ? "Upload companies first" : undefined },
    { id: "contacts", label: "People", icon: <IconPerson />, hint: !enrichedDone ? "Run enrichment first" : undefined },
    { id: "outreach", label: "Outreach", icon: <IconMail />, hint: !contactsDone ? "Find people first" : undefined },
  ]

  return (
    <aside className="w-52 shrink-0 bg-black flex flex-col h-screen">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase mb-0.5">Neoflo</p>
        <p className="text-sm font-semibold text-white leading-tight">Lead Qualification</p>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        <NavItem
          active={tab === "history"}
          accessible={true}
          icon={<IconHistory />}
          label="History"
          onClick={() => { onHistoryClick(); setTab("history") }}
        />

        <div className="my-3 border-t border-white/10" />
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase px-3 mb-1">Run</p>

        {steps.map((item, i) => (
          <div key={item.id} className="relative">
            {i > 0 && (
              <div className="absolute left-[22px] -top-1.5 w-px h-1.5 bg-white/10" />
            )}
            <NavItem
              active={tab === item.id}
              accessible={canAccess(item.id)}
              icon={item.icon}
              label={item.label}
              hint={item.hint}
              onClick={() => canAccess(item.id) && setTab(item.id)}
            />
          </div>
        ))}
      </nav>

      {showExport && (
        <div className="px-3 pb-4 border-t border-white/10 pt-3">
          <button
            onClick={onExport}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-black bg-white hover:bg-gray-100 transition-colors"
          >
            <IconExport />
            Export .xlsx
          </button>
        </div>
      )}
    </aside>
  )
}

function NavItem({
  active, accessible, icon, label, hint, onClick,
}: {
  active: boolean
  accessible: boolean
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
        active
          ? "bg-white/15 text-white font-medium"
          : accessible
          ? "text-white/70 hover:bg-white/8 hover:text-white"
          : "text-white/25 cursor-not-allowed"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-white" : accessible ? "text-white/50" : "text-white/20"}`}>
        {icon}
      </span>
      {label}
      {active && <span className="ml-auto w-1 h-1 rounded-full bg-white" />}
    </button>
  )
}

// ─── Upload Page ──────────────────────────────────────────────────────────────

function UploadPage({
  companies, settings, runKeywords, setRunKeywords,
  uploading, fileRef, onDrop, onFile, onStartEnrich, onSaveSettings,
}: {
  companies: string[]
  settings: Settings
  runKeywords: string[]
  setRunKeywords: (kw: string[]) => void
  uploading: boolean
  fileRef: React.RefObject<HTMLInputElement | null>
  onDrop: (e: React.DragEvent) => void
  onFile: (f: File) => void
  onStartEnrich: () => void
  onSaveSettings: (s: Settings) => void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localSettings, setLocalSettings] = useState(settings)
  const [newKw, setNewKw] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => { setLocalSettings(settings) }, [settings])

  const addKw = (raw = newKw) => {
    const incoming = raw.split(",").map((k) => k.trim()).filter(Boolean)
    const unique = incoming.filter((k) => !localSettings.keywords.includes(k))
    if (unique.length) setLocalSettings((s) => ({ ...s, keywords: [...s.keywords, ...unique] }))
    setNewKw("")
  }

  const handleSaveSettings = () => {
    onSaveSettings(localSettings)
    setRunKeywords(localSettings.keywords)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
    setSettingsOpen(false)
  }

  return (
    <div>
      <PageHeader title="New run" subtitle="Upload your company list, configure enrichment fields, then start." />

      <div className="flex flex-col gap-4">
        {/* Drop zone */}
        <div className="bg-white border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-black">Company list</h3>
              <p className="text-xs text-gray-500 mt-0.5">Upload a .xlsx or .csv with a column of company names.</p>
            </div>
          </div>
          <div
            className={`border-2 border-dashed border-gray-200 p-10 text-center transition-colors ${
              uploading ? "bg-gray-50" : "hover:border-gray-400 cursor-pointer"
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full spinner" />
                <span className="text-sm text-gray-500">Parsing file...</span>
              </div>
            ) : companies.length > 0 ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-2xl font-bold text-black">{companies.length}</span>
                <span className="text-sm text-gray-500">companies loaded</span>
                <span className="text-xs text-gray-400 mt-1">Click to replace</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <IconUploadLg />
                <p className="text-sm font-medium text-gray-700">Drop file here or click to browse</p>
                <p className="text-xs text-gray-400">.xlsx · .xls · .csv</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
          {companies.length > 0 && (
            <div className="mt-3 border border-gray-100 max-h-36 overflow-y-auto">
              {companies.map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <span className="text-xs text-gray-300 w-5 text-right shrink-0">{i + 1}</span>
                  <span className="text-sm text-gray-800">{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings accordion */}
        <div className="bg-white border border-gray-200 overflow-hidden">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-black">Configure</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {localSettings.keywords.slice(0, 4).join(", ")}{localSettings.keywords.length > 4 ? ` +${localSettings.keywords.length - 4} more` : ""}
                {localSettings.positioning ? " · Positioning set" : ""}
              </p>
            </div>
            <span className="text-gray-400 text-xs ml-4">{settingsOpen ? "▲" : "▼"}</span>
          </button>

          {settingsOpen && (
            <div className="border-t border-gray-100 px-5 py-5 flex flex-col gap-5">
              {/* Enrichment fields */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Enrichment fields</p>
                <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                  {localSettings.keywords.map((kw) => (
                    <span key={kw} className="flex items-center gap-1 bg-black text-white text-xs px-2.5 py-1 font-medium">
                      {kw}
                      <button
                        onClick={() => setLocalSettings((s) => ({ ...s, keywords: s.keywords.filter((k) => k !== kw) }))}
                        className="hover:text-white/60 ml-0.5 text-base leading-none"
                      >&times;</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKw}
                    onChange={(e) => { const v = e.target.value; if (v.endsWith(",")) { addKw(v); return }; setNewKw(v) }}
                    onKeyDown={(e) => e.key === "Enter" && addKw()}
                    placeholder="Add fields — comma separated"
                    className="flex-1 border border-gray-300 px-3 py-2 text-sm focus:border-black transition-colors bg-white"
                  />
                  <button onClick={() => addKw()} className="border border-black px-4 py-2 text-sm font-medium hover:bg-black hover:text-white transition-colors">Add</button>
                </div>
              </div>

              {/* Positioning */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Your positioning</p>
                <textarea
                  value={localSettings.positioning}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, positioning: e.target.value }))}
                  rows={3}
                  placeholder="e.g. We're Neoflo — AP automation for mid-market companies. We reduce invoice processing time by 80%."
                  className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white leading-relaxed"
                />
              </div>

              {/* ICP */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Ideal customer profile (ICP)</p>
                <textarea
                  value={localSettings.icp}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, icp: e.target.value }))}
                  rows={2}
                  placeholder="e.g. Mid-market (100–2000 employees), US-based finance teams. CFO, VP Finance, Controller."
                  className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white leading-relaxed"
                />
              </div>

              {/* Email template */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Email template / tone</p>
                <textarea
                  value={localSettings.emailTemplate}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, emailTemplate: e.target.value }))}
                  rows={3}
                  placeholder={`e.g.\n- Open with a hook about their business\n- Value prop in one sentence with a number\n- CTA: 15-min call`}
                  className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white font-mono leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveSettings}
                  className="bg-black text-white px-5 py-2 text-sm font-medium hover:bg-gray-900 transition-colors"
                >
                  Save settings
                </button>
                {savedFlash && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
              </div>
            </div>
          )}
        </div>

        {/* Start button */}
        {companies.length > 0 && (
          <button
            onClick={onStartEnrich}
            disabled={runKeywords.length === 0}
            className="self-start bg-black text-white px-7 py-3 text-sm font-semibold hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start enrichment — {companies.length} companies →
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Enrich Page ──────────────────────────────────────────────────────────────

function EnrichPage({
  enriched, keywords, doneCount, total, onFindPeople,
}: {
  enriched: EnrichedRow[]
  keywords: string[]
  doneCount: number
  total: number
  onFindPeople: () => void
}) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0
  const longFieldHints = ["brief", "description", "summary", "pain", "about", "overview", "notes", "detail"]
  const isLongField = (kw: string) => longFieldHints.some((h) => kw.toLowerCase().includes(h))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Enrichment"
          subtitle={
            allDone
              ? `${total} companies enriched.`
              : `${doneCount} of ${total} complete — running ${Math.min(BATCH_SIZE, total - doneCount)} in parallel.`
          }
        />
        {allDone && (
          <button
            onClick={onFindPeople}
            className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors"
          >
            Find people →
          </button>
        )}
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-gray-400">{pct}% complete</span>
          <span className="text-xs text-gray-400">{doneCount} / {total}</span>
        </div>
        <div className="w-full bg-gray-200 h-1 rounded-full overflow-hidden">
          <div
            className={`h-full bg-black rounded-full transition-all duration-500 ${!allDone && total > 0 ? "pulse-bar" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {enriched.map((row, i) => {
          const isLoading = row.status === "loading"
          const isPending = row.status === "pending"
          const shortFields = keywords.filter((k) => !isLongField(k))
          const longFields = keywords.filter((k) => isLongField(k))

          return (
            <div key={i} className="bg-white border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-black text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {row.company.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-black text-base">{row.company}</span>
                </div>
                <StatusBadge status={row.status} />
              </div>

              {!isPending && (
                <div className="px-5 py-4">
                  {shortFields.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3.5 mb-4 sm:grid-cols-3">
                      {shortFields.map((kw) => (
                        <div key={kw}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">{kw}</p>
                          {isLoading ? (
                            <div className="h-2.5 bg-gray-200 rounded pulse-bar w-3/4 mt-1" />
                          ) : (
                            <p className="text-sm text-gray-800 font-medium leading-snug">
                              {row.data[kw] ?? <span className="text-gray-300 font-normal">—</span>}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {longFields.length > 0 && (
                    <div className={`flex flex-col gap-4 ${shortFields.length > 0 ? "pt-4 border-t border-gray-100" : ""}`}>
                      {longFields.map((kw) => (
                        <div key={kw}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{kw}</p>
                          {isLoading ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="h-2.5 bg-gray-200 rounded pulse-bar w-full" />
                              <div className="h-2.5 bg-gray-100 rounded pulse-bar w-4/5" />
                            </div>
                          ) : (
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {row.data[kw] ?? <span className="text-gray-300">—</span>}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {isPending && (
                <div className="px-5 py-4">
                  <p className="text-sm text-gray-300">Waiting...</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Contacts Page ────────────────────────────────────────────────────────────

function ContactsPage({
  contacts, outreach, doneCount, total, onGenerateOutreach, setOutreach,
}: {
  contacts: ContactRow[]
  outreach: OutreachContact[]
  doneCount: number
  total: number
  onGenerateOutreach: (ids: string[]) => void
  setOutreach: React.Dispatch<React.SetStateAction<OutreachContact[]>>
}) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0
  const selected = outreach.filter((c) => c.selected)
  const allSelected = outreach.length > 0 && selected.length === outreach.length

  const toggleAll = () =>
    setOutreach((prev) => prev.map((c) => ({ ...c, selected: !allSelected })))

  const toggleOne = (id: string) =>
    setOutreach((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="People"
          subtitle={
            allDone
              ? `${outreach.length} contacts found. Select who to reach out to.`
              : `${doneCount} of ${total} companies searched.`
          }
        />
        {allDone && selected.length > 0 && (
          <button
            onClick={() => onGenerateOutreach(selected.map((c) => c.id))}
            className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors"
          >
            Generate outreach for {selected.length} →
          </button>
        )}
      </div>

      <div className="mb-5">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-gray-400">{pct}% complete</span>
          <span className="text-xs text-gray-400">{doneCount}/{total}</span>
        </div>
        <div className="w-full bg-gray-200 h-1 rounded-full overflow-hidden">
          <div
            className={`h-full bg-black rounded-full transition-all duration-500 ${!allDone && total > 0 ? "pulse-bar" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {!allDone && (
        <div className="bg-white border border-gray-200 mb-5 overflow-hidden">
          {contacts.map((row, i) => (
            <div key={i} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <span className="text-sm font-medium text-black flex-1">{row.company}</span>
              <StatusBadge status={row.status} />
            </div>
          ))}
        </div>
      )}

      {allDone && outreach.length > 0 && (
        <div className="bg-white border border-gray-200 overflow-hidden">
          {/* Select all header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 accent-black cursor-pointer"
            />
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              {allSelected ? "Deselect all" : "Select all"} ({outreach.length})
            </span>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-black text-white">
                <th className="px-4 py-3 w-10" />
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">LinkedIn</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {outreach.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => toggleOne(c.id)}
                  className={`border-t border-gray-100 cursor-pointer transition-colors ${
                    c.selected ? "bg-gray-50" : "bg-white"
                  } hover:bg-gray-50/80`}
                >
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 accent-black cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-black whitespace-nowrap">{c.company}</td>
                  <td className="px-4 py-3 font-medium text-black whitespace-nowrap">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.role}</td>
                  <td className="px-4 py-3">
                    {c.linkedin ? (
                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-black underline text-xs hover:text-gray-500 whitespace-nowrap">
                        View profile ↗
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge level={c.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Outreach Page ────────────────────────────────────────────────────────────

function OutreachPage({
  outreach, setOutreach, onExport,
}: {
  outreach: OutreachContact[]
  setOutreach: React.Dispatch<React.SetStateAction<OutreachContact[]>>
  onExport: () => void
}) {
  const [activeTab, setActiveTab] = useState<Record<string, "email" | "linkedin">>({})
  const generated = outreach.filter((c) => c.status === "done" || c.status === "loading")
  const doneCount = outreach.filter((c) => c.status === "done").length

  const getTab = (id: string) => activeTab[id] ?? "email"
  const switchTab = (id: string, t: "email" | "linkedin") =>
    setActiveTab((prev) => ({ ...prev, [id]: t }))

  const updateEmail = (id: string, field: "subject" | "body", val: string) =>
    setOutreach((prev) =>
      prev.map((c) => c.id === id ? { ...c, email: { ...c.email!, [field]: val } } : c)
    )
  const updateLinkedin = (id: string, val: string) =>
    setOutreach((prev) => prev.map((c) => c.id === id ? { ...c, linkedinMsg: val } : c))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Outreach"
          subtitle={`${doneCount} of ${generated.length} generated. Email + LinkedIn message per contact.`}
        />
        {doneCount > 0 && (
          <button onClick={onExport} className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors">
            Export all →
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {generated.map((contact) => {
          const tab = getTab(contact.id)
          const isLoading = contact.status === "loading"
          return (
            <div key={contact.id} className="bg-white border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div>
                  <p className="font-semibold text-black text-sm">{contact.name}</p>
                  <p className="text-xs text-gray-500">{contact.role} · {contact.company}</p>
                </div>
                <div className="flex items-center gap-3">
                  {contact.linkedin && (
                    <a href={contact.linkedin} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 underline hover:text-black">LI ↗</a>
                  )}
                  <StatusBadge status={contact.status} />
                </div>
              </div>

              {/* Tab switcher */}
              {!isLoading && contact.status === "done" && (
                <>
                  <div className="flex border-b border-gray-100">
                    {(["email", "linkedin"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => switchTab(contact.id, t)}
                        className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          tab === t
                            ? "border-b-2 border-black text-black"
                            : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        {t === "email" ? "Email" : "LinkedIn"}
                      </button>
                    ))}
                  </div>

                  <div className="px-5 py-4">
                    {tab === "email" && contact.email && (
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">Subject</label>
                          <input
                            type="text"
                            value={contact.email.subject}
                            onChange={(e) => updateEmail(contact.id, "subject", e.target.value)}
                            className="w-full border border-gray-200 bg-white px-3 py-2 text-sm focus:border-black transition-colors font-medium"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">Body</label>
                          <textarea
                            value={contact.email.body}
                            rows={8}
                            onChange={(e) => updateEmail(contact.id, "body", e.target.value)}
                            className="w-full border border-gray-200 bg-white px-3 py-2 text-sm focus:border-black transition-colors resize-none font-mono leading-relaxed"
                          />
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(`Subject: ${contact.email!.subject}\n\n${contact.email!.body}`)}
                          className="self-start text-xs font-semibold border border-gray-300 px-4 py-1.5 hover:border-black hover:bg-black hover:text-white transition-colors"
                        >
                          Copy email
                        </button>
                      </div>
                    )}
                    {tab === "linkedin" && (
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                            LinkedIn message <span className="text-gray-300 normal-case font-normal tracking-normal">({(contact.linkedinMsg ?? "").length}/280)</span>
                          </label>
                          <textarea
                            value={contact.linkedinMsg ?? ""}
                            rows={4}
                            maxLength={300}
                            onChange={(e) => updateLinkedin(contact.id, e.target.value)}
                            className="w-full border border-gray-200 bg-white px-3 py-2 text-sm focus:border-black transition-colors resize-none leading-relaxed"
                          />
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(contact.linkedinMsg ?? "")}
                          className="self-start text-xs font-semibold border border-gray-300 px-4 py-1.5 hover:border-black hover:bg-black hover:text-white transition-colors"
                        >
                          Copy message
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {isLoading && (
                <div className="px-5 py-4 flex flex-col gap-2">
                  <div className="h-2.5 bg-gray-200 rounded pulse-bar w-1/2" />
                  <div className="h-2.5 bg-gray-100 rounded pulse-bar w-full" />
                  <div className="h-2.5 bg-gray-100 rounded pulse-bar w-4/5" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── History Page ─────────────────────────────────────────────────────────────

function HistoryPage({
  runs, detail, onLoad, onSelect, onBack,
}: {
  runs: HistoryRun[]
  detail: HistoryDetail | null
  onLoad: () => void
  onSelect: (id: string) => void
  onBack: () => void
}) {
  useEffect(() => { onLoad() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (detail) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-black">← Back</button>
          <div>
            <h1 className="text-xl font-bold text-black">Run — {new Date(detail.run.created_at).toLocaleString()}</h1>
            <p className="text-sm text-gray-500">{detail.run.company_count} companies · {(detail.run.keywords as string[]).join(", ")}</p>
          </div>
        </div>

        {detail.enriched.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Enriched Companies</h2>
            <div className="flex flex-col gap-3">
              {detail.enriched.map((e, i) => (
                <div key={i} className="bg-white border border-gray-200 px-5 py-4">
                  <p className="font-semibold text-black mb-2">{e.company}</p>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                    {Object.entries(e.data).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{k}</p>
                        <p className="text-sm text-gray-800">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detail.contacts.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Contacts</h2>
            <div className="bg-white border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-black text-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide">LinkedIn</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.contacts.map((c, i) => (
                    <tr key={i} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                      <td className="px-4 py-3 font-semibold text-black">{c.company}</td>
                      <td className="px-4 py-3 text-black">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.role}</td>
                      <td className="px-4 py-3">
                        {c.linkedin
                          ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-black underline text-xs hover:text-gray-500">View ↗</a>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><ConfidenceBadge level={c.confidence as "high" | "medium" | "low"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="History" subtitle="All past enrichment runs." />
      {runs.length === 0 ? (
        <div className="bg-white border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
          No runs yet. Complete a run to see history here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => onSelect(run.id)}
              className="bg-white border border-gray-200 px-5 py-4 text-left hover:border-black transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-black text-sm">{new Date(run.created_at).toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{run.company_count} companies · {(run.keywords as string[]).join(", ")}</p>
                </div>
                <span className="text-gray-300 group-hover:text-black text-lg">→</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold text-black tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{subtitle}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "loading")
    return (
      <span className="flex items-center gap-1.5 text-gray-400 text-xs">
        <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-black rounded-full spinner inline-block" />
        Running
      </span>
    )
  if (status === "done")
    return <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><span className="text-green-500">✓</span> Done</span>
  if (status === "error")
    return <span className="text-xs font-semibold text-red-500">Error</span>
  return <span className="text-xs text-gray-300">Pending</span>
}

function ConfidenceBadge({ level }: { level: string }) {
  const styles =
    level === "high" ? "bg-black text-white" :
    level === "medium" ? "bg-gray-200 text-gray-600" :
    "bg-gray-100 text-gray-400"
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${styles}`}>
      {level}
    </span>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 10V3M5 6l3-3 3 3M3 13h10" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l3.5 3.5" strokeLinecap="round" />
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="10" rx="1" />
      <path d="M1 3l7 6 7-6" />
    </svg>
  )
}

function IconPerson() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" />
    </svg>
  )
}

function IconExport() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1v9M5 7l3 3 3-3M3 12v2h10v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function IconUploadLg() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-gray-300">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}
