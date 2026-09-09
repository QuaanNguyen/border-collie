# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues.
Use the `gh` CLI for issue operations.

## Conventions

- Create an issue with `gh issue create`.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list` and suitable state or label filters.
- Comment with `gh issue comment <number>`.
- Apply or remove labels with `gh issue edit`.
- Close an issue with `gh issue close`.

Infer the repository from its Git remote when running these commands inside the clone.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

When a skill says “publish to the issue tracker”, create a GitHub issue.

When a skill says “fetch the relevant ticket”, run `gh issue view <number> --comments`.
