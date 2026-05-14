"use client"

import { useState, useCallback, useRef, useEffect } from "react"

const BATCH_SIZE = 3
const SETTINGS_KEY = "lq_settings_v1"

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

type EmailRow = {
  company: string
  subject: string
  body: string
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

type Tab = "settings" | "upload" | "enrich" | "emails" | "contacts"

const DEFAULT_SETTINGS: Settings = {
  keywords: ["Industry", "Employees", "Founded", "HQ Location", "Revenue"],
  positioning: "",
  icp: "",
  emailTemplate: "",
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<Tab>("settings")
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [companies, setCompanies] = useState<string[]>([])
  const [runKeywords, setRunKeywords] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS.keywords
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) return JSON.parse(raw).keywords ?? DEFAULT_SETTINGS.keywords
    } catch {}
    return DEFAULT_SETTINGS.keywords
  })
  const [enriched, setEnriched] = useState<EnrichedRow[]>([])
  const [emails, setEmails] = useState<EmailRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null)
  const [newKw, setNewKw] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
        setSettingsState(parsed)
        // Sync runKeywords only if the user hasn't started a run yet
        if (enriched.length === 0) setRunKeywords(parsed.keywords)
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = (s: Settings) => {
    setSettingsState(s)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    if (enriched.length === 0) setRunKeywords(s.keywords)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

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
      setEmails([])
      setContacts([])
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
      const batch = rows.slice(bs, bs + BATCH_SIZE)
      setEnriched((prev) =>
        prev.map((r, i) => (i >= bs && i < bs + BATCH_SIZE ? { ...r, status: "loading" } : r))
      )
      await Promise.all(
        batch.map(async (row, offset) => {
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

  // ─── Draft Emails ────────────────────────────────────────────────────────

  const startDraftEmails = async () => {
    setTab("emails")
    const rows: EmailRow[] = companies.map((c) => ({ company: c, subject: "", body: "", status: "pending" }))
    setEmails(rows)

    for (let bs = 0; bs < rows.length; bs += BATCH_SIZE) {
      const batch = rows.slice(bs, bs + BATCH_SIZE)
      setEmails((prev) =>
        prev.map((r, i) => (i >= bs && i < bs + BATCH_SIZE ? { ...r, status: "loading" } : r))
      )
      await Promise.all(
        batch.map(async (row, offset) => {
          const idx = bs + offset
          const enrichedRow = enriched.find((e) => e.company === row.company)
          try {
            const res = await fetch("/api/draft-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                company: row.company,
                enrichedData: enrichedRow?.data ?? {},
                positioning: settings.positioning,
                icp: settings.icp,
                emailTemplate: settings.emailTemplate,
              }),
            })
            const json = await res.json()
            setEmails((prev) =>
              prev.map((r, i) =>
                i === idx ? { ...r, subject: json.subject, body: json.body, status: "done" } : r
              )
            )
          } catch {
            setEmails((prev) =>
              prev.map((r, i) => (i === idx ? { ...r, status: "error" } : r))
            )
          }
        })
      )
    }
  }

  // ─── Find Contacts ───────────────────────────────────────────────────────

  const startFindContacts = async () => {
    setTab("contacts")
    const rows: ContactRow[] = companies.map((c) => ({ company: c, contacts: [], status: "pending" }))
    setContacts(rows)

    for (let bs = 0; bs < rows.length; bs += BATCH_SIZE) {
      const batch = rows.slice(bs, bs + BATCH_SIZE)
      setContacts((prev) =>
        prev.map((r, i) => (i >= bs && i < bs + BATCH_SIZE ? { ...r, status: "loading" } : r))
      )
      await Promise.all(
        batch.map(async (row, offset) => {
          const idx = bs + offset
          try {
            const res = await fetch("/api/find-contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ company: row.company, icp: settings.icp }),
            })
            const json = await res.json()
            setContacts((prev) =>
              prev.map((r, i) =>
                i === idx ? { ...r, contacts: json.contacts ?? [], status: "done" } : r
              )
            )
          } catch {
            setContacts((prev) =>
              prev.map((r, i) => (i === idx ? { ...r, status: "error" } : r))
            )
          }
        })
      )
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  const exportData = async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrichedData: enriched, emails, contacts, keywords: runKeywords }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `leads-${Date.now()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doneCount = (arr: Array<{ status: string }>) => arr.filter((r) => r.status === "done").length
  const allEnrichedDone = enriched.length > 0 && doneCount(enriched) === enriched.length

  // Nav item accessibility
  const canAccess = (t: Tab) => {
    if (t === "settings" || t === "upload") return true
    if (t === "enrich") return enriched.length > 0
    if (t === "emails") return emails.length > 0
    if (t === "contacts") return contacts.length > 0
    return false
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        tab={tab}
        setTab={setTab}
        canAccess={canAccess}
        hasCompanies={companies.length > 0}
        enrichedDone={allEnrichedDone}
        emailsDone={emails.length > 0 && doneCount(emails) === emails.length}
        onExport={exportData}
        showExport={enriched.length > 0 || emails.length > 0 || contacts.length > 0}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {tab === "settings" && (
            <SettingsPage
              settings={settings}
              saved={settingsSaved}
              newKw={newKw}
              setNewKw={setNewKw}
              onSave={saveSettings}
            />
          )}
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
            />
          )}
          {tab === "enrich" && (
            <EnrichPage
              enriched={enriched}
              keywords={runKeywords}
              doneCount={doneCount(enriched)}
              total={enriched.length}
              onDraftEmails={startDraftEmails}
            />
          )}
          {tab === "emails" && (
            <EmailsPage
              emails={emails}
              doneCount={doneCount(emails)}
              total={emails.length}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              setEmails={setEmails}
              onFindContacts={startFindContacts}
            />
          )}
          {tab === "contacts" && (
            <ContactsPage
              contacts={contacts}
              doneCount={doneCount(contacts)}
              total={contacts.length}
              onExport={exportData}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  tab, setTab, canAccess, hasCompanies, enrichedDone, emailsDone, onExport, showExport,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  canAccess: (t: Tab) => boolean
  hasCompanies: boolean
  enrichedDone: boolean
  emailsDone: boolean
  onExport: () => void
  showExport: boolean
}) {
  const runItems: { id: Tab; label: string; icon: React.ReactNode; hint?: string }[] = [
    {
      id: "upload",
      label: "Upload",
      icon: <IconUpload />,
      hint: !hasCompanies ? "Upload a CSV or Excel file" : undefined,
    },
    { id: "enrich", label: "Enrich", icon: <IconSearch />, hint: !hasCompanies ? "Upload companies first" : undefined },
    { id: "emails", label: "Emails", icon: <IconMail />, hint: !enrichedDone ? "Run enrichment first" : undefined },
    { id: "contacts", label: "Contacts", icon: <IconPerson />, hint: !emailsDone ? "Draft emails first" : undefined },
  ]

  return (
    <aside className="w-52 shrink-0 bg-black flex flex-col h-screen">
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase mb-0.5">Neoflo</p>
        <p className="text-sm font-semibold text-white leading-tight">Lead Qualification</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {/* Settings */}
        <NavItem
          active={tab === "settings"}
          accessible={true}
          icon={<IconSettings />}
          label="Settings"
          onClick={() => setTab("settings")}
        />

        <div className="my-3 border-t border-white/10" />
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase px-3 mb-1">Run</p>

        {runItems.map((item) => (
          <NavItem
            key={item.id}
            active={tab === item.id}
            accessible={canAccess(item.id)}
            icon={item.icon}
            label={item.label}
            hint={item.hint}
            onClick={() => canAccess(item.id) && setTab(item.id)}
          />
        ))}
      </nav>

      {/* Export */}
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

// ─── Settings Page ────────────────────────────────────────────────────────────

function SettingsPage({
  settings, saved, newKw, setNewKw, onSave,
}: {
  settings: Settings
  saved: boolean
  newKw: string
  setNewKw: (v: string) => void
  onSave: (s: Settings) => void
}) {
  const [local, setLocal] = useState(settings)

  // Sync when settings load from localStorage
  useEffect(() => { setLocal(settings) }, [settings])

  const addKw = (raw = newKw) => {
    const incoming = raw.split(",").map((k) => k.trim()).filter(Boolean)
    const unique = incoming.filter((k) => !local.keywords.includes(k))
    if (unique.length) setLocal((s) => ({ ...s, keywords: [...s.keywords, ...unique] }))
    setNewKw("")
  }

  const removeKw = (kw: string) =>
    setLocal((s) => ({ ...s, keywords: s.keywords.filter((k) => k !== kw) }))

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure defaults used across every run. Change these any time — your next run picks them up automatically."
      />

      <div className="flex flex-col gap-5">
        {/* Enrichment fields */}
        <Card title="Enrichment fields" description="Data points to extract for each company.">
          <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
            {local.keywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1 bg-black text-white text-xs px-2.5 py-1 font-medium">
                {kw}
                <button onClick={() => removeKw(kw)} className="hover:text-white/60 ml-0.5 text-base leading-none">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKw}
              onChange={(e) => {
                const v = e.target.value
                if (v.endsWith(",")) { addKw(v); return }
                setNewKw(v)
              }}
              onKeyDown={(e) => e.key === "Enter" && addKw()}
              placeholder="Add fields — comma separated (e.g. Tech Stack, Funding Stage, CEO)"
              className="flex-1 border border-gray-300 px-3 py-2 text-sm focus:border-black transition-colors bg-white"
            />
            <button
              onClick={() => addKw()}
              className="border border-black px-4 py-2 text-sm font-medium hover:bg-black hover:text-white transition-colors"
            >
              Add
            </button>
          </div>
        </Card>

        {/* Positioning */}
        <Card title="Your positioning" description="Describes your product and value prop. Used to personalize every outreach email.">
          <textarea
            value={local.positioning}
            onChange={(e) => setLocal((s) => ({ ...s, positioning: e.target.value }))}
            rows={4}
            placeholder="e.g. We're Neoflo — AP automation for mid-market companies. We reduce invoice processing time by 80% and cut manual errors to near zero. Used by 40+ finance teams processing 10K+ invoices/month."
            className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white leading-relaxed"
          />
        </Card>

        {/* ICP */}
        <Card title="Ideal customer profile (ICP)" description="Who you're selling to. Helps focus contact discovery on the right personas.">
          <textarea
            value={local.icp}
            onChange={(e) => setLocal((s) => ({ ...s, icp: e.target.value }))}
            rows={3}
            placeholder="e.g. Mid-market companies (100–2000 employees), US-based, finance teams processing 1000+ invoices/month. Decision makers: CFO, VP Finance, Controller."
            className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white leading-relaxed"
          />
        </Card>

        {/* Email template */}
        <Card title="Email template / tone guidance" description="Optional structure or style notes applied to every drafted email.">
          <textarea
            value={local.emailTemplate}
            onChange={(e) => setLocal((s) => ({ ...s, emailTemplate: e.target.value }))}
            rows={4}
            placeholder={`e.g.\n- Open with a specific hook about their business\n- Line 2: our value prop in one sentence with a number\n- Line 3: social proof (e.g. "We do this for [similar company]")\n- CTA: ask for a 15-min call this week`}
            className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:border-black transition-colors resize-none bg-white font-mono leading-relaxed"
          />
        </Card>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSave(local)}
            className="bg-black text-white px-6 py-2.5 text-sm font-medium hover:bg-gray-900 transition-colors"
          >
            Save settings
          </button>
          {saved && (
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <span className="text-green-600">✓</span> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Upload Page ──────────────────────────────────────────────────────────────

function UploadPage({
  companies, settings, runKeywords, setRunKeywords,
  uploading, fileRef, onDrop, onFile, onStartEnrich,
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
}) {
  const [newKw, setNewKw] = useState("")

  const addKw = (raw = newKw) => {
    const incoming = raw.split(",").map((k) => k.trim()).filter(Boolean)
    const unique = incoming.filter((k) => !runKeywords.includes(k))
    if (unique.length) setRunKeywords([...runKeywords, ...unique])
    setNewKw("")
  }

  const removeKw = (kw: string) => setRunKeywords(runKeywords.filter((k) => k !== kw))

  return (
    <div>
      <PageHeader
        title="New run"
        subtitle="Upload a list of companies, review the fields, then start enrichment."
      />

      <div className="flex flex-col gap-5">
        {/* Drop zone */}
        <Card title="Company list" description="Upload a .xlsx or .csv with a column of company names.">
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
                <span className="text-xs text-gray-400 mt-1">Click to replace file</span>
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

          {/* Company preview */}
          {companies.length > 0 && (
            <div className="mt-3 border border-gray-100 max-h-40 overflow-y-auto">
              {companies.map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <span className="text-xs text-gray-300 w-5 text-right shrink-0">{i + 1}</span>
                  <span className="text-sm text-gray-800">{c}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Fields for this run */}
        <Card
          title="Fields for this run"
          description={
            runKeywords.length > 0 && JSON.stringify(runKeywords) !== JSON.stringify(settings.keywords)
              ? "Customized for this run — differs from saved settings"
              : "Loaded from Settings. Edit below to override for this run only."
          }
        >
          <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
            {runKeywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1 bg-black text-white text-xs px-2.5 py-1 font-medium">
                {kw}
                <button onClick={() => removeKw(kw)} className="hover:text-white/60 ml-0.5 text-base leading-none">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKw}
              onChange={(e) => {
                const v = e.target.value
                if (v.endsWith(",")) { addKw(v); return }
                setNewKw(v)
              }}
              onKeyDown={(e) => e.key === "Enter" && addKw()}
              placeholder="Add more fields (comma separated)"
              className="flex-1 border border-gray-300 px-3 py-2 text-sm focus:border-black transition-colors bg-white"
            />
            <button onClick={() => addKw()} className="border border-black px-4 py-2 text-sm font-medium hover:bg-black hover:text-white transition-colors">
              Add
            </button>
          </div>
        </Card>

        {/* Settings summary */}
        {(settings.positioning || settings.icp) && (
          <Card title="Active settings" description="These will be applied to emails and contact discovery.">
            <div className="flex flex-col gap-3">
              {settings.positioning && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Positioning</p>
                  <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">{settings.positioning}</p>
                </div>
              )}
              {settings.icp && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">ICP</p>
                  <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">{settings.icp}</p>
                </div>
              )}
            </div>
          </Card>
        )}

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
  enriched, keywords, doneCount, total, onDraftEmails,
}: {
  enriched: EnrichedRow[]
  keywords: string[]
  doneCount: number
  total: number
  onDraftEmails: () => void
}) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0

  // Split keywords into short (inline grid) and long (full-width) based on typical value length
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
            onClick={onDraftEmails}
            className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors"
          >
            Draft emails →
          </button>
        )}
      </div>

      {/* Progress bar */}
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

      {/* Company cards */}
      <div className="flex flex-col gap-4">
        {enriched.map((row, i) => {
          const isLoading = row.status === "loading"
          const isPending = row.status === "pending"
          const shortFields = keywords.filter((k) => !isLongField(k))
          const longFields = keywords.filter((k) => isLongField(k))

          return (
            <div key={i} className="bg-white border border-gray-200 overflow-hidden">
              {/* Card header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-black text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {row.company.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-black text-base">{row.company}</span>
                </div>
                <StatusBadge status={row.status} />
              </div>

              {/* Fields grid */}
              {!isPending && (
                <div className="px-5 py-4">
                  {/* Short fields — 3-column grid */}
                  {shortFields.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3.5 mb-4 sm:grid-cols-3">
                      {shortFields.map((kw) => (
                        <div key={kw}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">
                            {kw}
                          </p>
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

                  {/* Long fields — full width, separated by a line if short fields exist */}
                  {longFields.length > 0 && (
                    <div className={`flex flex-col gap-4 ${shortFields.length > 0 ? "pt-4 border-t border-gray-100" : ""}`}>
                      {longFields.map((kw) => (
                        <div key={kw}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
                            {kw}
                          </p>
                          {isLoading ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="h-2.5 bg-gray-200 rounded pulse-bar w-full" />
                              <div className="h-2.5 bg-gray-100 rounded pulse-bar w-4/5" />
                              <div className="h-2.5 bg-gray-100 rounded pulse-bar w-2/3" />
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

              {/* Pending state */}
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

// ─── Emails Page ──────────────────────────────────────────────────────────────

function EmailsPage({
  emails, doneCount, total, expandedEmail, setExpandedEmail, setEmails, onFindContacts,
}: {
  emails: EmailRow[]
  doneCount: number
  total: number
  expandedEmail: string | null
  setExpandedEmail: (v: string | null) => void
  setEmails: React.Dispatch<React.SetStateAction<EmailRow[]>>
  onFindContacts: () => void
}) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Email drafts"
          subtitle={allDone ? `${total} emails drafted. Click any row to edit and copy.` : `${doneCount} of ${total} drafted.`}
        />
        {allDone && (
          <button onClick={onFindContacts} className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors">
            Find contacts →
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

      <div className="flex flex-col gap-2">
        {emails.map((email, i) => {
          const isOpen = expandedEmail === email.company
          return (
            <div key={i} className="bg-white border border-gray-200 overflow-hidden">
              {/* Row header */}
              <button
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
                onClick={() => setExpandedEmail(isOpen ? null : email.company)}
              >
                <span className="font-semibold text-sm text-black min-w-[140px] shrink-0">{email.company}</span>
                <span className="flex-1 text-xs text-gray-500 truncate">
                  {email.status === "done" && email.subject ? email.subject : ""}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={email.status} />
                  {email.status === "done" && (
                    <span className="text-gray-400 text-xs">{isOpen ? "▲" : "▼"}</span>
                  )}
                </div>
              </button>

              {/* Expanded editor */}
              {isOpen && email.status === "done" && (
                <div className="border-t border-gray-100 bg-gray-50/60">
                  <div className="px-5 py-4 flex flex-col gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">Subject line</label>
                      <input
                        type="text"
                        value={email.subject}
                        onChange={(e) =>
                          setEmails((prev) => prev.map((r, idx) => idx === i ? { ...r, subject: e.target.value } : r))
                        }
                        className="w-full border border-gray-200 bg-white px-3 py-2 text-sm focus:border-black transition-colors font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">Email body</label>
                      <textarea
                        value={email.body}
                        rows={9}
                        onChange={(e) =>
                          setEmails((prev) => prev.map((r, idx) => idx === i ? { ...r, body: e.target.value } : r))
                        }
                        className="w-full border border-gray-200 bg-white px-3 py-2 text-sm focus:border-black transition-colors resize-none font-mono leading-relaxed"
                      />
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`)}
                      className="self-start text-xs font-semibold border border-gray-300 px-4 py-1.5 hover:border-black hover:bg-black hover:text-white transition-colors"
                    >
                      Copy email
                    </button>
                  </div>
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
  contacts, doneCount, total, onExport,
}: {
  contacts: ContactRow[]
  doneCount: number
  total: number
  onExport: () => void
}) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = doneCount === total && total > 0
  const allContacts = contacts.flatMap((row) => (row.contacts ?? []).map((c) => ({ ...c, company: row.company }))).filter((c) => c.name && c.name.toLowerCase() !== "unknown")

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Contacts"
          subtitle={
            allDone
              ? `${allContacts.length} contacts found across ${total} companies.`
              : `${doneCount} of ${total} companies searched.`
          }
        />
        {allDone && (
          <button onClick={onExport} className="shrink-0 bg-black text-white px-5 py-2.5 text-sm font-semibold hover:bg-gray-900 transition-colors">
            Export all →
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

      {/* Loading list */}
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

      {allContacts.length > 0 && (
        <div className="bg-white border border-gray-200 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-black text-white">
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Company</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">LinkedIn</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {allContacts.map((c, i) => (
                <tr key={i} className={`border-t border-gray-100 align-top ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-blue-50/20 transition-colors`}>
                  <td className="px-4 py-3 font-semibold text-black whitespace-nowrap">{c.company}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.name ? (
                      <span className="font-medium text-black">{c.name}</span>
                    ) : (
                      <span className="text-gray-300">Unknown</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.role}</td>
                  <td className="px-4 py-3">
                    {c.linkedin ? (
                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer"
                        className="text-black underline text-xs hover:text-gray-500 whitespace-nowrap">
                        View profile ↗
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
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

// ─── Shared UI ────────────────────────────────────────────────────────────────

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold text-black tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{subtitle}</p>}
    </div>
  )
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-black">{title}</h3>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function CellValue({ value }: { value: string }) {
  const isLong = value.length > 55
  if (!isLong) {
    return <span className="text-sm text-gray-700 leading-snug">{value}</span>
  }
  return (
    <div className="group relative">
      <span
        className="text-sm text-gray-700"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          lineHeight: "1.45",
        }}
      >
        {value}
      </span>
      <div className="hidden group-hover:block absolute z-30 left-0 top-full mt-1 w-72 bg-black text-white text-xs p-3 leading-relaxed shadow-xl pointer-events-none">
        {value}
      </div>
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
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
        <span className="text-green-500">✓</span> Done
      </span>
    )
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

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
    </svg>
  )
}

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

function IconUploadLg() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-gray-300">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}
