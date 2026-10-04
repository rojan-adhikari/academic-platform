# Institution logos

Drop official university and college logo files here to replace the generated crests.

- **File name** = the institution's **code**, lower-cased, plus an image extension.
  Examples: `au.png` (Anna University), `kpriet.svg`, `iitm.png`, `bits.webp`.
- Supported formats: `.svg`, `.png`, `.webp`, `.jpg`.
- Square or near-square images look best (they are shown inside a rounded badge).
- Codes are the ones shown in the sign-in / institution directory and in `server/seed.js`
  (universities: `AU`, `IITM`, `BITS`, …; colleges: `KPRIET`, `PSGCT`, `CEG`, …).

How it is picked up:

- On **seed**, any file here whose name matches an institution code is linked automatically.
- Admins can also upload a logo in-app (Admin → the institution's branding), which writes the
  file here and links it immediately — no reseed needed.
- When no file matches, that institution keeps its generated monogram crest.

These files are served as static assets from `/assets/logos/…`. No real logos are bundled:
they are trademarked and could not be fetched in the build environment, so add your own here.
