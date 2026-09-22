# Git Workflow — bb1-projects

Repo root: `/Users/jespineli_bluebridge/Documents/BB1 Projects`
Remote: https://github.com/jespineli-ops/bb1-projects
Branches: `dev` (active work), `main` (promoted/stable)

`gh` CLI is installed at `~/.local/bin/gh` (not on PATH by default — add
`export PATH="$HOME/.local/bin:$PATH"` to your shell profile, or use the
full path, if you want to run `gh` commands).

## Adding a commit to `dev`

    cd "/Users/jespineli_bluebridge/Documents/BB1 Projects"
    git status                    # see what changed
    git add <files>                # or `git add .` for everything
    git commit -m "your message"
    git push                       # dev already tracks origin/dev

If someone else (or another machine) pushed to `dev` in the meantime, run
`git pull` before pushing to avoid a rejected push.

## Promoting a project from `dev` to `main`

Pick one of the following depending on how surgical you need to be.

### Option A — merge everything on `dev` into `main`

Use this while `main` only contains what's already on `dev` (nothing to
lose by merging it all).

    git checkout main
    git pull origin main
    git merge dev
    git push origin main
    git checkout dev               # switch back to keep working on dev

### Option B — promote just one project folder

Useful once `dev` has multiple projects and only one is ready for `main`.

    git checkout main
    git pull origin main
    git checkout dev -- Quorum      # pull only that folder's content from dev
    git commit -m "Promote Quorum to main"
    git push origin main
    git checkout dev

This copies the current state of the folder as of `dev`, not a full commit
history merge — good when `dev` has WIP on other folders you don't want in
`main` yet.

### Option B2 — move or update a single file

Same idea as Option B, but scoped to one file — useful for a targeted fix
or a single script update without dragging along the rest of the folder.

    git checkout main
    git pull origin main
    git checkout dev -- "Quorum/src/FileCabinet/SuiteScripts/[QPG] Contracts/bb1_qpg_cntr_helper_lib.js"
    git commit -m "Promote bb1_qpg_cntr_helper_lib.js to main"
    git push origin main
    git checkout dev

Swap in whatever file path you need to promote. This creates the file on
`main` if it doesn't exist there yet, or overwrites it with the `dev`
version if it does — it does not delete the file from `dev`.

### Option C — PR-based (recommended once this repo isn't just you)

    gh pr create --base main --head dev --title "Promote Quorum" --body "..."
    gh pr merge --merge              # or --squash

Gives you a review step and a record of what moved, instead of merging
straight from the command line.

---

For now (repo is small, `main` is basically empty), **Option A** is
simplest. Switch to **B or C** once several projects live on `dev` at
different readiness levels.
