#!/usr/bin/env bash
# Put nerd on GitHub: commit this folder and push it to a new repository.
#   bash scripts/push-to-github.sh                   private repository called "nerd"
#   bash scripts/push-to-github.sh my-nerd --public  another name, visible to everyone
# Uses the GitHub CLI (gh, https://cli.github.com) when it is installed. Without it, make an empty
# repository at https://github.com/new and paste its URL when asked.
# Windows: run it in Git Bash (Start menu > Git Bash). From PowerShell:
#   & "C:\Program Files\Git\bin\bash.exe" scripts/push-to-github.sh
if [ -z "${BASH_VERSION:-}" ]; then echo "Run this with bash: bash scripts/push-to-github.sh"; exit 1; fi
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]:-$0}")"
[ -f server/index.js ] || cd ..
if [ ! -f server/index.js ] || [ ! -f package.json ]; then
  echo "Run this file from inside the nerd folder: bash scripts/push-to-github.sh"
  exit 1
fi

REPO="${1:-nerd}"
VISIBILITY="--private"
if [ "${2:-}" = "--public" ]; then VISIBILITY="--public"; fi

if ! git --version >/dev/null 2>&1; then
  echo "Git is not ready. On a Mac, click Install in the window that opened (Command Line Developer Tools), wait for it to finish, then run this again."
  echo "On Windows or Linux, get Git from https://git-scm.com/downloads, then run this again."
  exit 1
fi
if [ ! -d .git ]; then
  git init -q
  git symbolic-ref HEAD refs/heads/main
fi

# Commits need a name and an email. If you have none set, they are saved for this repository only.
GIT_NAME="$(git config user.name || true)"
while [ -z "$GIT_NAME" ]; do read -r -p "Your name for commits: " GIT_NAME; git config user.name "$GIT_NAME"; done
GIT_EMAIL="$(git config user.email || true)"
if [ -z "$GIT_EMAIL" ]; then
  echo "Commits show an email address. To keep yours private, use the ...@users.noreply.github.com one from https://github.com/settings/emails"
  while [ -z "$GIT_EMAIL" ]; do read -r -p "Email for commits: " GIT_EMAIL; git config user.email "$GIT_EMAIL"; done
fi

git add -A
# The database, uploaded files, keys and tunnel settings never go to GitHub.
NEVER='^data/.+\.db|^data/uploads/|(^|/)\.env(\.|$)|(^|/)\.cloudflared/'
if git ls-files | grep -E "$NEVER" || { git rev-parse -q --verify HEAD >/dev/null && git log --format= --name-only HEAD | grep -E "$NEVER"; }; then
  git reset -q
  echo "Stopped: the files listed above must not go to GitHub. Put nerd's .gitignore file back in this folder and run this again."
  echo "(If an earlier commit already has them, copy nerd to a new folder without its .git folder and run this there.)"
  exit 1
fi
# GitHub refuses files over 100 MB.
BIG="$(git diff --cached --name-only --diff-filter=AM | while IFS= read -r f; do if [ -f "$f" ] && [ "$(( $(wc -c < "$f") ))" -gt 95000000 ]; then echo "$f"; fi; done)"
if [ -n "$BIG" ]; then
  printf '%s\n' "$BIG"
  git reset -q
  echo "Stopped: GitHub refuses files over 100 MB. Move the files above out of this folder and run this again."
  exit 1
fi
if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -q -m "nerd: multi-university academic monitoring platform"
  echo "Committed $(git ls-files | wc -l | tr -d ' ') files."
fi

BRANCH="$(git symbolic-ref --short HEAD)"
TOKEN_URL="https://github.com/settings/tokens/new?scopes=repo&description=nerd"
if git remote get-url origin >/dev/null 2>&1; then
  if ! git push -u origin "$BRANCH"; then
    echo
    echo "The push to $(git remote get-url origin) did not work (the reason is above)."
    echo " - Wrong repository, or it was made with a README: run   git remote remove origin   then run this again."
    echo " - Password refused: paste a token from $TOKEN_URL instead (your account password does not work)."
    exit 1
  fi
  echo "Done: $(git remote get-url origin)"
elif command -v gh >/dev/null 2>&1; then
  # Git Bash's window cannot show gh's yes/no questions, so gh asks none there; "gh auth setup-git" covers them.
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) export GH_PROMPT_DISABLED=1 ;; esac
  if ! gh auth status >/dev/null 2>&1; then gh auth login --web --git-protocol https; fi
  gh auth setup-git
  if ! gh repo create "$REPO" "$VISIBILITY" --source=. --remote=origin --push; then
    echo "If GitHub says that name is taken, pick another one: bash scripts/push-to-github.sh my-nerd"
    exit 1
  fi
  echo "Done: $(gh repo view --json url -q .url)"
else
  echo "Make an empty repository called $REPO at https://github.com/new (leave README, .gitignore and license unticked)."
  URL=""
  while [ -z "$URL" ]; do read -r -p "Paste its URL, like https://github.com/<you>/$REPO.git : " URL; done
  git remote add origin "$URL"
  echo "A GitHub sign-in window may open; sign in there. If git asks for a password here instead, paste a token from $TOKEN_URL"
  if ! git push -u origin "$BRANCH"; then
    git remote remove origin
    echo
    echo "Could not push to $URL (the reason is above). Check the URL and your sign-in, then run this again."
    exit 1
  fi
  echo "Done: ${URL%.git}"
fi
