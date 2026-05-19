# Email Rewrite Backup Branch

Date: 2026-03-18

Temporary safety note after the Git history email rewrite.

- Backup branch kept locally: `backup/pre-email-rewrite-20260318-160744`
- Purpose: restore the pre-rewrite history if a problem is discovered after the forced push
- Suggested retention: keep for 1-2 days, then delete if GitHub attribution and repository state look correct

If rollback is needed:

```bash
git checkout main
git reset --hard backup/pre-email-rewrite-20260318-160744
git push --force-with-lease origin main
```
