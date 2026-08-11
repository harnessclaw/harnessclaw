# Contributing to Harnessclaw

[English](./CONTRIBUTING.md) | [简体中文](./CONTRIBUTING_zh.md)

Thanks for taking the time to contribute! Whether you found us through the docs, a YouTube walkthrough, or the community group, this guide gets you from "just cloned it" to "PR merged" as quickly as possible.

If Harnessclaw is useful to you, the single most helpful thing you can do is **⭐ star the repo** — it is how new people find the project.

## Ways to Contribute

You do not need to write code to help:

- 🐛 **Report a bug** — open an [Issue](https://github.com/harnessclaw/harnessclaw/issues) with steps to reproduce, your OS, and the app version.
- 💡 **Suggest a feature** — start a thread in [Discussions](https://github.com/harnessclaw/harnessclaw/discussions) so we can shape it together.
- 📖 **Improve docs** — fix a typo, clarify a step, or translate a page. Doc-only PRs are very welcome and are the easiest first contribution.
- 🛠️ **Fix an issue** — pick up something labeled [`good first issue`](https://github.com/harnessclaw/harnessclaw/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/harnessclaw/harnessclaw/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).
- 💰 **Claim a reward** — some issues carry a bounty (see [Reward Workflow](#reward-workflow) below).

## Your First Pull Request

### 1. Set up the project

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/harnessclaw.git
cd harnessclaw
yarn install
yarn dev          # launches the app in development mode
```

Requirements: Node.js v18+ and Yarn. If `yarn dev` starts and the window opens, you are ready.

### 2. Create a branch

```bash
git checkout -b fix/short-description
```

### 3. Make your change

- Keep the change focused — one logical change per PR.
- Match the surrounding code style. Run `yarn lint` before you commit.
- If your change is user-visible, update the changelog (see [docs/release-rules.md](./docs/release-rules.md)).

### 4. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/) and require a **DCO sign-off** on every commit:

```bash
git commit -s -m "fix(chat): keep scroll position when a new message arrives"
```

The `-s` flag adds the `Signed-off-by` line required by our CI check. Commit types and scopes are documented in [docs/release-rules.md](./docs/release-rules.md).

### 5. Push and open a PR

```bash
git push origin fix/short-description
```

Open the PR against `main`, fill in the template (summary, checklist, linked issue), and a maintainer will review it. Draft PRs are fine if you want early feedback.

## Commit & Changelog Rules

The full commit convention, changelog structure, and release process live in **[docs/release-rules.md](./docs/release-rules.md)**. The essentials:

- Commit messages follow `type(scope): summary` (`feat`, `fix`, `docs`, `refactor`, `chore`, `build`, `ci`, `test`).
- Every commit is signed off with `git commit -s`.
- Do **not** hand-edit `CHANGELOG.md` / `CHANGELOG_zh.md`; edit the sources under `changelog/` and run `yarn changelog:build`.

## Reward Workflow

Some issues carry a bounty so contributors get paid for their work:

- Maintainers open an issue with the `Reward Task` template and set the amount/currency.
- When your PR closes that issue and is merged, a GitHub Action creates a `reward-<issue-number>` tag and comments the split on the issue.
- On the first day of each month, the reward tags from the previous month are aggregated into a `statistic-YYYY-MM` release.

Look for open issues with the `reward` label to find paid tasks.

## Code of Conduct

Be respectful and constructive. We want Harnessclaw to be a welcoming place for first-time and experienced contributors alike. Harassment or dismissive behavior is not tolerated.

## Questions?

- 💬 [GitHub Discussions](https://github.com/harnessclaw/harnessclaw/discussions) for ideas and questions
- 🐛 [Issues](https://github.com/harnessclaw/harnessclaw/issues) for bugs and tasks

Welcome aboard — we are glad you are here. 🎉
