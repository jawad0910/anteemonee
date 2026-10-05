# cpanteemonee — Anteemonee Control Panel

Admin panel lives at `/cpanteemonee/` inside the Anteemonee website folder.

## Access
- URL: `cpanteemonee/index.html` (open via file:// or `https://anteemonee.com/cpanteemonee/`)
- Default login: `admin` / `Anteemonee@2026`
- Stay signed-in toggle stored in localStorage; session in sessionStorage.

## What it manages
- **Users** — `profiles` table (username, email, full_name, plan_type, subscription_status). Grant/revoke lifetime, edit. Tries Supabase first, falls back to mock localStorage.
- **eBooks** — title/author/subject/class/pages/file/cover/status. Local + `ebooks` table (see migration `20250104000000_cpanteemonee_tables.sql`).
- **Past Papers** — yearly vs topical, board/class/subject/year/session/chapter/file+solution.
- **Board Notes** — chapter-wise notes (title/subject/class/board/chapter/content/status).
- **Flashcards** — front/back/subject/box (Leitner). Also writes to Supabase `flashcards` if available.
- **Definitions** — term/definition/subject/chapter glossary.
- **Test Builder** — custom test templates.
- **AI Models** — personas (Chipa Sahab, Coder), providerIndex, system_prompt, active toggle. Mirrors `js/ai-chatbot.js` PERSONAS.
- **API Keys** — Groq/Qwen/Mistral/Gemini/OpenAI masked keys. Production keys must be in Supabase Edge Function secrets, not this table.
- **Voice Services** — OpenAI Realtime + Gemini Live + TTS/STT config, stored per-user in `user_call_keys`.
- **Payments & Coupons** — trial info (`trials`, `trial_devices`, `active_devices`), Safepay, coupons CRUD.
- **Taxonomy** — boards, class_levels, education_systems, groups, subjects.
- **Site Settings** — version.json, maintenance mode, announcement, homepage stats, rate limit, export/import JSON.

## Data persistence
- Supabase-first (anon key), localStorage fallback so the panel works even before migrations run.
- Export/Import JSON dumps all stores for backup or migration.
- For durable server state, run SQL in `supabase/migrations/20250104000000_cpanteemonee_tables.sql` in Supabase SQL Editor.

## Theme
Uses the same liquid-glass variables as `css/style.css` (`--bg`, `--liquid-bg`, `--accent`, etc.) and respects light/dark toggle via `Anteemonee_theme_mode`.

## Files
- `index.html` — single-page app shell + all sections + modals.
- `css/panel.css` — panel layout/style.
- `js/panel.js` — all CRUD, Supabase integration, auth gate, routing.

## Security note
This is a client-side admin. For production, protect `/cpanteemonee/` via server auth or add `profiles.is_admin` and enforce RLS `using ((select is_admin from profiles where id=auth.uid()) = true)`.
