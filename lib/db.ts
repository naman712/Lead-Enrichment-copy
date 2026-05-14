import { neon } from "@neondatabase/serverless"

export const sql = neon(process.env.DATABASE_URL!)

export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      keywords JSONB NOT NULL DEFAULT '[]',
      positioning TEXT NOT NULL DEFAULT '',
      icp TEXT NOT NULL DEFAULT '',
      email_template TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      keywords JSONB NOT NULL DEFAULT '[]',
      company_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS enriched_companies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      contact_name TEXT,
      contact_role TEXT,
      subject TEXT,
      body TEXT,
      linkedin_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  // Add columns for existing deployments upgrading from old schema
  await sql`ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS contact_name TEXT`
  await sql`ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS contact_role TEXT`
  await sql`ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS linkedin_message TEXT`
  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      name TEXT,
      role TEXT,
      linkedin TEXT,
      confidence TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}
