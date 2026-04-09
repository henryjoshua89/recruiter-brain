Recruiter Brain Phase 1 is a production-style intake and briefing app for recruiters.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required Environment Variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## Supabase Setup

1. Open your Supabase SQL editor.
2. Run the SQL in `supabase/schema.sql`.
3. Confirm `companies` and `roles` tables were created.

## What Phase 1 Includes

- Clean dashboard home page for Recruiter Brain
- Four-step New Role workflow:
  - Company setup and website context capture
  - Internal recruiter context form
  - Full JD paste input
  - Structured AI briefing output
- Anthropic model call using `claude-sonnet-4-20250514`
- Supabase persistence for company, role intake, and generated briefing

## Notes

- The app expects public company websites to be reachable from the server.
- The model response is validated for structure before being stored.
