\# Addendum: Redundancy Removal, Deprecation, and Scrap/Rebuild Policy (Claude Instructions)

\#\# A) Objective  
Reduce the system to a single, coherent platform aligned to \`SPEC.md\`, removing redundant or low-quality subsystems and rebuilding them where necessary, without breaking production-critical behaviours.

This is not “refactor for fun.” It is:  
\- remove duplication  
\- remove dead features  
\- remove half-implemented workflows  
\- rebuild only the parts that are structurally incompatible with the target product

\#\# B) Non-Negotiable Constraints  
1\) Do not remove any code-path that is required for running the existing app until the replacement is implemented and validated.  
2\) All removals must be behind a \*\*deprecation plan\*\*:  
   \- replacement exists  
   \- migration completed (data and/or API)  
   \- tests updated  
   \- old endpoints/features removed only after a final compatibility checkpoint  
3\) No “big bang rewrite” unless the component is formally deemed “Scrap” under §E criteria.

\#\# C) Deliverables for Cleanup Work (Required)  
Claude must produce:  
1\) \`ARCHITECTURE\_AUDIT.md\`  
   \- current systems inventory (modules, endpoints, DB tables)  
   \- redundancy mapping (what overlaps what)  
   \- quality assessment per subsystem  
   \- proposed keep/remove/rebuild decision for each  
2\) \`DEPRECATION\_PLAN.md\`  
   \- stepwise plan for removing old systems  
   \- migration steps  
   \- compatibility strategy  
   \- rollback plan  
3\) A set of PR-sized commits:  
   \- Each commit must be focused and reversible (no giant “everything changed” commits)

\#\# D) “Keep / Remove / Rebuild” Classification Rules

\#\#\# D1) KEEP (retain and improve)  
A subsystem is KEEP if ALL are true:  
\- it is aligned with the target model in \`SPEC.md\`  
\- it is structurally sound (separable, testable, understandable)  
\- improving it is cheaper and safer than rebuilding  
\- it does not enforce incorrect semantics (VAT, listing keys, workflow, job model)

\#\#\# D2) REMOVE (delete)  
A subsystem is REMOVE if ANY are true:  
\- it is unused by UI and API (dead code)  
\- it duplicates another subsystem that will be the single source of truth  
\- it conflicts with the target data model and is not used in production  
\- it is a partial prototype that introduces confusion (two ways to do the same task)

Removal requirements:  
\- remove all references (routes, UI links, DB access)  
\- remove or migrate tables if no longer used  
\- update documentation and tests

\#\#\# D3) REBUILD (scrap and replace)  
A subsystem is REBUILD if ANY are true:  
\- it is tightly coupled and cannot be adapted cleanly to:  
  \- job-based sync/publish  
  \- feature store  
  \- recommendation lifecycle  
  \- VAT semantics  
\- it contains pervasive logic duplication across UI/back-end  
\- it blocks core outcomes from \`SPEC.md\` (e.g., prevents deterministic economics or audit trail)  
\- patching would exceed 60% of the effort of a clean rewrite (estimated and stated)

Rebuild requirements:  
\- build a replacement behind \`/api/v2\`  
\- keep old subsystem functional until replacement passes acceptance gates (§F)  
\- then fully remove old subsystem (or leave it only if explicitly marked “legacy retained”)

\#\# E) Subsystems to Review for Potential Scrap/Rebuild (Explicit Scope)  
Claude must evaluate, at minimum:  
1\) API versioning and endpoints  
   \- Anything under \`/api/v1\` that overlaps \`/api/v2\` must be deprecated.  
2\) Any file-based state (JSON config, credential files, ad hoc data stores)  
   \- If it overlaps Postgres schema in \`SPEC.md\`, migrate and remove.  
3\) Scoring/recommendation logic  
   \- If there are multiple scoring paths, unify into one recommendation engine per spec.  
4\) Keepa sync and caching  
   \- If scattered or inline, rebuild into a job \+ snapshot model.  
5\) “Push to Amazon” / publishing workflow  
   \- If not job-based with lifecycle, rebuild it into publish jobs \+ events \+ history.  
6\) UI implementations that hardcode calculations  
   \- Any “profit/margin computed in UI” must be removed and rebuilt to consume backend economics.

\#\# F) Acceptance Gates Before Removing Old Systems  
Old subsystem can only be removed when replacement meets:  
1\) Feature parity for the affected workflow (as defined by user stories in \`SPEC.md\`)  
2\) Data migration complete (or formally declared unnecessary)  
3\) Tests:  
   \- economics unit tests pass  
   \- recommendation fixture tests pass  
   \- API contract tests for v2 pass  
4\) Manual verification checklist completed and documented in \`DEPRECATION\_PLAN.md\`

\#\# G) Migration Rules  
1\) Data migrations must be idempotent.  
2\) Backfill scripts must log:  
   \- rows migrated  
   \- rows skipped  
   \- errors with actionable details  
3\) If new tables replace old ones, preserve historical data by migrating it into:  
   \- listing\_events  
   \- recommendation\_events  
   \- snapshots / features  
4\) If history cannot be migrated cleanly, document the limitation explicitly and keep read-only legacy access until cutover.

\#\# H) Rollback Plan (Mandatory)  
For every removal:  
\- provide a revert strategy:  
  \- git revert commit(s)  
  \- DB migration rollback (if feasible) or safe forward-only plan  
\- ensure old and new can coexist behind:  
  \- feature flags OR  
  \- route prefix separation (\`/api/v1\` vs \`/api/v2\`)

\#\# I) Definition of “Done” for Cleanup  
Cleanup is DONE when:  
\- there is exactly one way to do each core workflow:  
  \- compute economics  
  \- sync/enrich  
  \- generate recommendations  
  \- publish price/stock changes  
\- redundant endpoints and UI pathways are removed  
\- the codebase clearly maps to the modules in \`SPEC.md\`  
\- documentation reflects the new single-source-of-truth architecture

