import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Lead Qualification — Neoflo",
  description: "Enrich company data and automate outreach",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-white text-black antialiased">{children}</body>
    </html>
  )
}
