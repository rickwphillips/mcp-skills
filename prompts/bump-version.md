---
name: bump-version
title: Bump Version
description: Bump a project's semver version number, append a CHANGELOG entry, commit, and push.
arguments:
  - name: project_path
    description: Filesystem path to the project root (containing package.json or similar manifest).
    required: true
  - name: level
    description: "patch | minor | major"
    required: true
  - name: summary
    description: One-line description of what changed in this version.
    required: true
---

# Bump Version

Bump a project's semver version, write a CHANGELOG entry, and commit. Push only if the user confirms.

## Inputs

- `project_path`: project root
- `level`: `patch` | `minor` | `major`
- `summary`: one-liner describing the change (used as the changelog entry)

## Steps

1. **Detect manifest**:
   - `package.json` (Node)
   - `pyproject.toml` or `setup.py` (Python)
   - `Cargo.toml` (Rust)
   - `composer.json` (PHP)
   - bare `VERSION` file
   Stop if none found and ask the user where the version lives.

2. **Read current version** from the manifest. Bump it according to semver:
   - `patch`: `1.2.3 → 1.2.4`
   - `minor`: `1.2.3 → 1.3.0`
   - `major`: `1.2.3 → 2.0.0`

3. **Update manifest** with the new version. Use the project's filesystem write tool, not a shell `sed` (preserves formatting).

4. **Update `CHANGELOG.md`** at the project root. Format:
   ```
   ## [<new_version>] - <YYYY-MM-DD>

   - <summary>
   ```
   Insert above the most recent entry. Date must be plain `YYYY-MM-DD` — never include `T00:00:00`. Create the file with a `# Changelog` heading if missing.

5. **Show diff** — manifest version line + new CHANGELOG entry — and ask user to confirm.

6. **On confirmation**: commit with message `chore: bump to v<new_version>` then ask before pushing.

## Anti-patterns

- Don't bump the version *and* commit unrelated changes in the same commit.
- Don't write a CHANGELOG entry vaguer than the summary the user gave you. If their summary is vague, ask for specifics first.
- Don't skip the date. Don't use any date format other than `YYYY-MM-DD`.
- Don't push without explicit confirmation.
