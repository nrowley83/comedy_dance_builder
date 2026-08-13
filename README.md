# The Call Board

A recital/show planning tool: track your people, pieces, roles, and
props, then use Reports to build a show from whatever cast and time
you've got. Data lives in a Supabase (Postgres) database behind a
login screen only you can get past.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account
   and a new project (any name/region/password — you won't need the
   database password day-to-day, just save it somewhere).
2. Once it's provisioned, open **SQL Editor** in the left sidebar, click
   **New query**, paste in the contents of `supabase/schema.sql` from
   this repo, and run it. That creates `people`, `pieces`, `roles`,
   `tracks`, `props`, `assignments`, `cast_presets`, and `saved_shows`,
   and locks every one of them down to signed-in users only. (If you'd
   already run an earlier version of this script, running the current
   version again is safe — it renames the old `tracks` table to `roles`
   in place, renames `costumes` to `props`, and adds new columns/tables
   including `energy` on `pieces` and the new grouping `tracks` table,
   all without touching your existing data.)

## 2. Turn off public sign-up and create your login

By default Supabase lets anyone sign themselves up. Turn that off so
you're the only account that can ever exist:

1. Go to **Authentication → Sign In / Providers** (or **Authentication →
   Settings**, depending on your project version) and turn **off** "Allow
   new users to sign up" (sometimes labeled "Enable email signups").
2. Go to **Authentication → Users**, click **Add user → Create new user**,
   enter the email and password you want to log in with, and check
   **Auto Confirm User** so it doesn't wait on a confirmation email.

That's your one login. The app has no sign-up screen — only sign in.

## 3. Run it locally (optional, to test before deploying)

```bash
npm install
cp .env.example .env.local
# edit .env.local and paste in your Project URL + anon key
npm run dev
```

Visit the local URL it prints, sign in with the account you created,
add a person/piece, and confirm new rows show up in Supabase under
**Table Editor**.

## 4. Deploy on Vercel

1. Push this repo to GitHub (you've already got the repo — just commit
   and push these files).
2. In Vercel: **Add New… → Project**, import the GitHub repo. Vercel
   will auto-detect it as a Vite app — no build settings to change.
3. Before deploying (or right after, then redeploy), go to the
   project's **Settings → Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Deploy. Visit the site — you'll land on a sign-in screen. Log in with
   the account you created in step 2.

## How the login actually protects things

This isn't just a lock screen bolted onto the frontend — the database
itself refuses to serve data to anyone who isn't signed in (that's what
the `auth.uid() is not null` policies in `schema.sql` do). Even if
someone found your Supabase URL and anon key, they couldn't read or
write your tables without logging in first.

If you ever want more than one person to have their own login, repeat
step 2's "Add user" for each of them — everyone with an account gets
full access to all 5 tables (there's no per-user data separation here,
just a single shared board behind a shared gate).

## Project structure

```
supabase/schema.sql   — run once in Supabase's SQL editor
src/lib/supabase.js    — Supabase client setup
src/lib/db.js          — all reads/writes to the 5 tables
src/App.jsx            — the whole UI, including the login screen
```
