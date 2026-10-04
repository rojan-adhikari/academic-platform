# nerd

**nerd** is an academic intelligence platform for universities and colleges. It covers attendance prediction, explainable academic-risk analysis, voice mark entry, Excel-style voice sheets, real-time notifications, a campus guide (KPR Compass), and student / staff / admin portals with strict tenant isolation.

The institutions are real public universities and colleges in India. **Every student, staff member, mark and attendance record is generated sample data.** No real personal data is used.

## Run it

Requirements: **Node.js 22.5 or newer**. There are no npm dependencies, because it uses Node's built-in `node:sqlite`.

```bash
cd academic-platform
npm start          # http://localhost:3000 (seeds the database on first run)
npm run seed       # reset the data to its starting state (do this before a live demo)
npm test           # end-to-end API self-test against a temporary database (134 checks)
```

Options: `PORT=8080 npm start` changes the port, and `DB_PATH=/path/nerd.db npm start` uses a different database file.

### Put it on GitHub and online (free)

```bash
bash scripts/push-to-github.sh                     # commit this folder and push it to a new private GitHub repo
bash scripts/host-cloudflare.sh                    # start nerd and get a public https://....trycloudflare.com link
bash scripts/host-cloudflare.sh nerd.example.com   # or use your own domain on Cloudflare
```

- nerd runs on your computer and a Cloudflare Tunnel brings visitors to it, so the site is online while that window is open and the computer is awake. No router or firewall changes, no account for the quick link.
- On Windows, run these in **Git Bash**. The push uses the GitHub CLI (`gh`) if it is installed, otherwise it asks for the URL of an empty repo made at github.com/new.
- The database, uploaded files, `.env` and tunnel settings never go to GitHub (`.gitignore`, and the script checks).
- Every demo account uses the password 123456 and the site says so, so share the link only with people you trust.
- Quick links cannot stream live updates, so new notifications appear within a minute. Your own domain streams them instantly.
- Cloudflare Pages and Workers cannot run nerd as it is, because it needs Node's SQLite and a server that keeps running.

### Free "ask anything" answers for nerd AI (optional)

nerd AI always answers questions about your own attendance, marks, timetable and deadlines, with no setup. To let it answer anything else (explain a topic, help with code, general chat) for free, run a model on your own computer with [Ollama](https://ollama.com):

1. Install Ollama from ollama.com (Windows, macOS or Linux).
2. Download a model once: `ollama pull llama3.2` (about 2 GB; `llama3.2:1b` is smaller for slower laptops).
3. Start nerd as usual with `npm start`. It finds Ollama by itself and prints `[nerd AI] Online answers via ollama (...)`.

No key, no account and no internet are needed once the model is downloaded, and nothing leaves the laptop. Own-record questions are still answered instantly by nerd itself; only open questions go to the model. If Ollama is not running, nerd AI quietly falls back to its built-in answers. Settings: `NERD_AI_MODEL=gemma3` picks a model, `NERD_AI_OLLAMA=off` turns detection off.

Other options: any OpenAI-compatible service works with `NERD_AI_URL`, `NERD_AI_MODEL` and `NERD_AI_KEY` (some have free tiers, which may keep what you send). Claude is the paid option: set `ANTHROPIC_API_KEY` and run `npm install @anthropic-ai/sdk`.

## Sign-in accounts

The password for every account is **`123456`**. Pick the institution first (Sign in → search "KPR"), then the portal tab. "Keep me signed in on this device" keeps you signed in for 30 days; leaving it unchecked makes the session end when the browser closes.

| Where | Student | Faculty | Admins |
|---|---|---|---|
| KPRIET (Anna University) | `25CS324` Rojan Adhikari | `CS014` Dr. Kavitha Raman | `kpriet.admin` (college), `kpriet.cse.admin` (CSE dept) |
| Any other college, e.g. PSG Tech | `25CSE101` (each college has its own) | `CS001` | `psgct.admin` (`<college code>.admin`) |

University admins are `<university code>.admin`, for example `au.admin` for Anna University. The platform super admin is `superadmin`, who can sign in from any college's Administrator tab.

Every college seeds its own students, so the same roll number (for example `25CSE101`) can exist in more than one college and opens a different student at each — which shows the tenant isolation. KPRIET's demo student signs in with the short roll `25CS324`.

## Institutions

There are 14 universities and 28 colleges. Anna University comes first, with **KPR Institute of Engineering and Technology (KPRIET)** as the fully populated flagship, plus CEG, MIT Chromepet, PSG Tech, CIT, KCT and SSN. The others are IIT Madras, IIT Bombay, IIT Delhi, NIT Trichy, BITS Pilani (Pilani, Goa, Hyderabad), VIT (Vellore, Chennai), Delhi University (St. Stephen's, Hindu, SRCC), Mumbai University (VJTI, St. Xavier's), VTU (RVCE, BMSCE), Jadavpur University, Amrita (Coimbatore, Amritapuri), MAHE (MIT Manipal) and SRM IST.

## Demo script

1. **Landing and sign-in:** open the site, click **Sign in**, type "KPR" and choose KPRIET. The split-screen sign-in page has Student / Faculty / Administrator tabs, a one-time-code option and a password reset.
2. **Voice mark entry:** sign in as `CS014`, open Data Structures (Section A), then the **Voice Entry** tab. Click the mic (Chrome or Edge) or type `Rojan Adhikari scored 21 out of 25.`.
   - The system finds the student, infers *Internal Assessment 1* and validates the mark. Nothing is saved until you press **Confirm & Save**.
   - Also try `Rahul scored 23 out of 25 in Internal One.` (two Rahuls, so it asks you to choose) and `Rojan scored 28 out of 25` (rejected).
3. **Voice sheets:** as `CS014`, open **Voice Sheets** and create a blank sheet (Name, Roll, Physics, Chemistry, Math, English, History, Total, Avg) or one built from a course.
   - Press **Ctrl + Alt** to start listening (or use the mic button or the command box).
   - Say a number such as "75": it fills the selected cell and moves on. It moves right if you last moved right (arrow key, Tab or a click to the right) and down if you last moved down.
   - Say "Physics 82" or "E5 82" to target a column or a cell. With no column named, the selected column is used.
   - Select a Total or Avg cell and say "C5 to G5": every cell from the first to the last is included (C5, D5, E5, F5, G5), and the result is calculated according to that column's header (sum, average, standard deviation, variance, max, min, count or percentage) and stays live as the marks change. A range on a different row, or a value outside the column's limit, is shown as an error and nothing is written.
   - Ask for a figure: "mean of Physics", "standard deviation of Total", "variance for Rojan", "mean and standard deviation of C2 to C21". The answer is read out and shown in the log; the sheet is unchanged. Variance and standard deviation divide by n (the whole class); say "sample standard deviation" for n − 1. Absent and blank cells are left out.
   - **Noisy room?** Keep **Nearest voice only** on: nerd measures the microphone level while each phrase is spoken and accepts only the person close to the mic, logging quieter background chatter as ignored instead of writing it. Watch the meter (your voice should cross the line), adjust the sensitivity, or switch to **Hold Ctrl+Alt to talk**. A headset or close-talk mic works best.
   - Press **Save**. On a course sheet, **Post marks to course** shows a summary first, then saves the marks as voice entries.
4. **Student:** in another browser or a private window, sign in at KPRIET as `25CS324`.
   - A live toast shows "New marks available".
   - On Performance → Risk, Data Structures moves **Attention → High** and lists the reasons.
   - The Attendance page shows "missing the next class takes you below 75%" plus the recovery plan and a what-if calculator.
5. **Campus guide (KPR Compass):** open **Campus guide** on the KPRIET sign-in page (no login needed) or from the portal menu.
   - Search a place, get walking directions on the official campus map, use live GPS guidance with spoken prompts, browse events and register, scan a QR checkpoint, and switch between English and Tamil.
   - As `kpriet.admin`, **Campus Guide** under Institution edits events, rooms, map points and paths (closures, stairs), facilities, alerts and GPS calibration, runs the badge desk and ID check-in review, and publishes the guide.
6. **Admin:** as `kpriet.admin`, the dashboard shows people, portal status, departments, course requests and recent changes. **Student & teacher portals** switches portal features (timetable, classroom, clubs, voice entry, campus guide, nerd AI, or the whole portal) on or off per college. **Audit Logs** show every change with who, when, and the old and new values.
7. **Isolation:** as `kpriet.admin`, open a KPRIET student, then change the id in the URL to a PSG Tech student. The page says "You do not have permission to access this record" and the API returns 403.

## Feature coverage

| Area | What's there |
|---|---|
| Hierarchy | University → college → campus/faculty → department → programme → regulation → batch → academic year → semester → section → course offering → registrations, all editable by admins. |
| Public site | A short landing page built around a real outline map of India (@svg-maps/india, CC BY 4.0). Every one of the 36 states and union territories has a dot placed inside its border, all linked into one network; tap a dot or a state to see its name. Below it: the institution directory, an institution finder and a split-screen sign-in. Every university and college shows its real logo. |
| Auth | Separate Student, Faculty and Administrator sign-in scoped to the chosen college. Hashed passwords (scrypt), HttpOnly session cookie, CSRF token, login throttling, one-time-code sign-in and password reset, change password. |
| Roles | Super, university, college and department admins, staff and students. Admins manage structure, people and registrations but not academic records: creating or removing assessments and assignments belongs to the course's own teacher, not to admins. Admins can edit the permission matrix (Settings → Permissions), including who can manage the campus guide. |
| Student portal | Dashboard with prioritised alerts, academic profile and course registration, subject-wise attendance with predictions and a what-if tool, performance with class averages and trends, explainable risk, notifications, a printable report and the campus guide. |
| Attendance engine | Configurable threshold (75% by default). Safe / Attention / Critical status, safe misses, classes needed to recover, and a target. |
| Risk engine | A logistic-regression model over attendance gap/decline, assessment level/drop, assignments and previous SGPA, plus configurable early-warning rules. Returns Normal / Attention / High per subject and overall, always with contributing factors. |
| Voice entry | Web Speech API (en-IN) or typed input. Parses multiple entries, number words, fuzzy names and roll numbers, validates against max marks and asks for confirmation. |
| Voice sheets | Excel-style grid with column letters and row numbers, Ctrl + Alt voice control, direction-aware auto-advance, column and cell targeting, header-driven range calculations with live formulas (a spoken range covers every cell between its ends), spoken mean, variance and standard deviation for a column, a student or a block, validation errors, undo, CSV import/export and posting marks to a course. |
| Noise handling | For noisy staff rooms, voice capture gates on microphone level so only the closest speaker is accepted and background chatter is ignored, with a live input meter, a sensitivity control, hold-to-talk, and rejection of low-confidence recognitions. |
| Campus guide | KPR Compass integrated for KPRIET: search with aliases, shortest-path walking routes, GPS alignment and live guidance, events with posters and registration, QR checkpoints, visitor ID check-in, English/Tamil, and a full admin editor with publishing and an audit trail. When an admin publishes a new event, the college's students and staff are notified and the event appears on their dashboards (see *Cross-portal visibility*). |
| Cross-portal visibility | Admin actions that affect students and staff surface in their portals, not just the admin's. Announcements notify the chosen audience; publishing a campus-guide event notifies the college's students and staff and adds the event to the student dashboard's **Campus events** card. Students register for an open event with one tap from that card (and can cancel), and their registrations appear in the admin's event participants list (with CSV export). |
| Branding / logos | Each university and college has a logo. **Real logos are bundled for all 28 colleges and all 14 universities** in `public/assets/logos/`. Admins can upload or replace a logo from Settings. |
| nerd AI | The assistant in the bottom-right corner of every page. **Built in (no setup):** it answers from the signed-in person's own records (`GET /api/assistant/facts`: attendance per course, safe misses, marks, risk with reasons, timetable, deadlines; for teachers, classes, marks still to enter and flagged students) plus a knowledge base of about 1,700 phrasings (`public/js/nerdai-data.js`, built by `tools/nerdai-build.js`). It keeps context for follow-ups ("can I skip DS?" then "what about marks?"), fixes typos, asks a clarifying question when unsure, and handles small talk, maths, the date and study tips. **Ask anything (optional):** `POST /api/assistant/chat` sends the conversation plus only that person's own facts to a model: a free local Ollama model (auto-detected), any OpenAI-compatible endpoint, or Claude (paid). Rate-limited to 40 messages per 10 minutes per user; if the model is unavailable it falls back to built-in answers. See *Free "ask anything" answers* above. Admins can switch nerd AI off per portal. |
| Attendance status | Each course's status follows one clear rule, shown on the student's attendance page: **Safe** — at least 80% and more than two classes of margin; **Attention** — close to 75%, or two more absences would cross it; **Critical** — below 75%. |
| Staff | Course workspace: roster, attendance, marks grid, assessment/assignment CRUD, voice entry, voice sheets and announcements. The sidebar's **Analytics & Risk** opens cross-course risk monitoring; per-course analytics is a tab inside each course. |
| Admin | A people-and-portals console: dashboard, students, teachers, administrators, **Student & teacher portals** (feature switches per college), course requests, announcements, universities/colleges (by role), departments, campuses, campus guide, import/export, audit log and settings. Attendance, marks, assignments, notes and classroom belong to teachers and are not shown in the admin portal. Super admins and university admins pick a college to manage its portals. |
| Data | CSV templates, validate-only dry run, all-or-nothing or valid-rows-only import, CSV exports and printable reports. |
| Notifications | Dashboards show only new (unread) notifications. Reading one moves it to the Read tab of the notification centre, filed by category (marks, attendance, academic risk, courses, registration, clubs, classroom, announcements, system), where it can be deleted singly, by selection, or all read in a category. |
| Timetable | A full weekly class timetable per section: 7 periods Monday–Friday with tea and lunch breaks and a mentor hour, generated from the real faculty/course/section assignments so names and times stay consistent. Labs occupy two back-to-back periods, theory courses repeat across the week, and Saturday carries activity slots (remedial/tutorial, seminar, club activity). Students see their section's timetable; staff see their own teaching timetable (which section, when). |
| Clubs | Each college has clubs (Ignitron, IEEE, Robotics, Sangamam, Mental Health club and more). Students browse by category and join from the student portal through a short membership form (name and roll pre-filled, phone and a reason to join required); staff see each club's roster with members' contact details. |
| Classroom | A Google-Classroom-style stream per course: teachers post assignments, notes and materials (title, details, link, due date, points) and can attach a PDF (notes, question papers) that students download and read; teachers edit/delete posts and see submissions. Students see the stream for their registered courses and submit assignments with a note, a link and/or a PDF upload. New assignments notify the class. |
| Deadlines | Students get a read-only list of upcoming (and past) assignment deadlines across their courses, with their submission status; only teachers can change a deadline (from the classroom). |
| Languages | Full-UI language switch between English, Tamil (தமிழ்) and Hindi (हिन्दी) from the top bar, applied across every page and portal and remembered per device. It covers the full interface chrome plus generated sentences (risk factors, attendance predictions, counts) via phrase and pattern translation. Free-form content people type (announcement text, notification bodies) and proper nouns (institution and course names) stay in their original language. |
| Real time | Server-sent events push notifications and refreshes. A background job queue recalculates risk after marks or attendance change. |
| Charts | Lightweight dependency-free SVG charts. Every data point on a trend line is tappable (and keyboard-focusable): clicking a point shows its full weekday and date with the value, which also works on touch where there is no hover. |
| UI | Self-hosted Inter font (with Tamil/Devanagari fallbacks), responsive down to phone width, keyboard focus states and labels, and a strict CSP with no inline scripts. |

## Architecture

- `server/`: a plain Node HTTP server with no framework.
  - `db.js`: SQLite schema. `scope.js`: tenant scoping and RBAC.
  - `engine/`: attendance prediction, the risk model, the voice parser and the event queue.
  - `routes/`: the API, including `campus.js` (campus guide) and `sheets.js` (voice sheets).
  - `seed.js`: sample data. `selftest.js`: end-to-end checks.
- `public/`: a vanilla JS single-page app. `js/compass/` holds the KPR Compass routing, GPS, search and Tamil logic, ported from the original app. `js/vendor/` holds qrcode-generator and ZXing (both MIT, see `LICENSES.md`).
- Every API query is filtered by the signed-in user's scope, and record-level checks block URL and id tampering.

## Not done / limitations

- **The risk model is trained on a synthetic cohort.** It shows the method, not real predictive accuracy, and must be retrained on real institutional data before any real use.
- **Real email is not sent in this environment.** This cloud sandbox has no mail server or SMTP credentials, so one-time codes (sign-in and password reset) are shown on screen, clearly labelled as dev mode — never presented as a delivered email. Email delivery is a clean, pluggable step that turns on with env vars, with no code change; see *Email & one-time codes* below. In-app notifications are unaffected.
- Import takes CSV only; save Excel files as CSV first.
- Voice recognition depends on the browser's Web Speech API (Chrome or Edge). Other browsers can type commands instead. The nearest-speaker noise gate uses the microphone level and recognition confidence, which the browser provides with limited noise cancellation, so results improve a lot with a headset or close-talk microphone; the level meter and gate are unavailable if microphone access is blocked.
- The campus guide map, points and paths are KPRIET's from KPR Compass. Other colleges can enable a guide, but they start from that structure and must survey their own campus. No events are pre-loaded; admins add them.
- Live GPS guidance needs HTTPS (or localhost) and location permission.
- Single-node SQLite. Production would need Postgres, a real job queue and horizontal scaling.
- **All 28 college logos are bundled; three universities still use crests.** Real logos for every college and 11 of the 14 universities were supplied and are included under `public/assets/logos/`. Anna University, Mumbai University and VTU show a generated monogram crest until a university-level logo is added — admins upload one in **Settings → Institution logo**, or you drop image files into `public/assets/logos/<code>.<ext>` (see that folder's README). The logo then replaces the crest everywhere automatically. (This sandbox has no general outbound internet, so logos cannot be auto-fetched; they must be supplied, as these were.)
- **Map of India.** The landing map uses real state/union-territory outlines from [@svg-maps/india](https://github.com/VictorCazanave/svg-maps) (CC BY 4.0), with coordinates rounded to integers for a lightweight graphic; see `public/js/vendor/LICENSES.md`.
- Not deployed anywhere. It runs locally only.

## Email & one-time codes

Forgot-password and one-time-code sign-in are fully built. The sending step lives in `server/mailer.js` (a minimal, zero-dependency SMTP client) and is **off until you configure it** — until then the code is shown on screen in dev mode.

To send real email from your own domain (e.g. `rojanadhikari20622.com.np`), set these environment variables before `npm start` and restart:

```
MAIL_ENABLED=1
SMTP_HOST=smtp.your-provider.com        # the SMTP server for the domain
SMTP_PORT=587                           # 587 = STARTTLS, 465 = implicit TLS
SMTP_SECURE=0                           # 1 only for port 465
SMTP_USER=postmaster@rojanadhikari20622.com.np
SMTP_PASS=your-smtp-password-or-app-key
MAIL_FROM="nerd <no-reply@rojanadhikari20622.com.np>"
MAIL_DOMAIN=rojanadhikari20622.com.np   # used in the SMTP EHLO greeting
```

What you must provide: an SMTP host/username/password for the domain (from your email host, or a transactional-email provider with the domain verified). Gmail cannot send *as* a custom domain unless that domain is configured as a Gmail "Send mail as" alias with an app password — a transactional SMTP provider with the domain verified (SPF/DKIM) is the reliable route. Once set, codes are emailed to each account's registered address and the dev-mode on-screen code disappears automatically. The app never claims an email was delivered when it was not.
