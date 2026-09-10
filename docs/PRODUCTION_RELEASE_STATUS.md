# Production release status — 2026-09-10

Status: implementation and automated verification in draft PR #30. Not merged, deployed, or certified production ready.

## Intended result

An isolated client deployment with the intended VeraTitle UI, durable large-packet processing, source retention and physical-page citations, attributable examiner review, reviewed exports, and evidence-grounded Ask Vera. Unreadable pages require review without converting missing evidence into a substantive title defect.

## Applied changes

See PHASE_2_SECURITY_REVIEW.md and PHASE_3_DURABILITY_REVIEW.md for security and durable processing changes and their limitations.

The subsequent release-control change generates CSV/JSON from client-scoped stored dossiers and saved decisions. It ignores client-supplied report contents, requires dispositions, and blocks final export for unresolved physical pages. Ask Vera rebuilds its review and evidence graph from current saved decisions. Browser printing has the matching integrity gate; browser printing is not a tamper-proof signed export.

## Remaining sequence

1. Finish automated checks for each change on the PR branch. This happens before deployment.
2. Connect and inspect the actual hosting project, identify staging versus production, and confirm the intended UI/repository mapping. Vercel connection requested; currently only GitHub is connected.
3. Configure staging database, Blob, persistent worker, OCR and model credentials. Run migration explicitly. Add individual authentication/roles and operational controls using the actual identity/deployment environment. Do not treat shared access codes as examiner identity.
4. Exercise real representative 50-, 250- and 1000-page packets against examiner-reviewed expected outcomes. Measure accuracy, page references, runtime, memory, retry recovery and cost. Test source access, saved decisions, Ask Vera, exports, client isolation and concurrent load. Synthetic 1000-page shard tests do not establish OCR throughput or accuracy.
5. Resolve failures and document remaining release risks. Validate backup/restore, rollback, monitoring and operator recovery. Define retention and database privileges. Review historical-data migration and checkpoint compatibility.
6. Only after staging acceptance, merge and deploy the verified release; verify production health and a controlled complete review workflow.

No calendar completion estimate is reliable before environment access and representative packet acceptance results. Code fixes are applied to the PR as completed; tests run before staging and again against configured integrations. Production receives only the accepted release.

## Evidence and limitations

The phase 3 GitHub Actions run passed all harnesses, TypeScript, a production build, and 18 real PostgreSQL integration checks: https://github.com/xrupert/cybridtech-examiner/actions/runs/34505904941

Release-control coverage adds authorization, input rejection, cross-review decision isolation, disposition requirements and integrity-hold export tests (28 security/correctness checks in total). Consult the latest PR check for verification of the latest commit.

Deployment credentials, an actual database connection, OCR/model connectivity, individual identity, real-packet performance/accuracy, and production smoke tests have not been verified. Additional gaps include receipt side-effect deduplication, code-version checkpoint compatibility, browser-dependent submission of remaining batch files, fleet limits, operator controls, and revision-consistent multi-review exports. Do not infer production readiness from a successful build.
