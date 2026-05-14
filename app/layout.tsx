import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Lead Generation — Neoflo",
  description: "Enrich company data and automate outreach",
  icons: {
    icon: "/neoflo-icon.png",
    shortcut: "/neoflo-icon.png",
    apple: "/neoflo-icon.png",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-white text-black antialiased">{children}</body>
    </html>
  )
}
