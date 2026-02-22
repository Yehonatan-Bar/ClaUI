---
description: MANDATORY - INVOKE IMMEDIATELY after completing ANY development task (feature, bug fix, refactor, maintenance). Creates SR-PTD documentation for future skill extraction. This is NOT optional - every task MUST have documentation.
---

# SR-PTD Documentation Skill

## Purpose

Capture exactly what happened during a task **in a structure that maps directly to Claude Skill architecture**. Over time, these documents become raw material for building Skills - patterns emerge, reusable components accumulate, and workflows crystallize.

**Key Principle:** Every task you complete is a potential Skill waiting to be extracted. Document it accordingly.

---

## How SR-PTD Maps to Skills

| Document Section | Skill Component | Extraction Value |
|------------------|-----------------|------------------|
| **Task Trigger Profile** | YAML `description` | What requests should activate this skill? |
| **Workflow Executed** | SKILL.md body | Step-by-step process to replicate |
| **Knowledge Accessed** | `references/` | Schemas, APIs, docs Claude needed |
| **Code Written/Used** | `scripts/` | Reusable scripts for future tasks |
| **Outputs Produced** | `assets/` | Templates, formats to standardize |

---

## Process

### Step 1: Determine Document Type

Choose based on task complexity:

**Full SR-PTD** (Sections A-J): For complex tasks, multi-step implementations, tasks likely to become skills
**Quick Capture**: For simpler tasks, quick fixes, routine work

### Step 2: Create Documentation File

**Filename Format:** `SR-PTD_[YYYY-MM-DD]_[task-id]_[brief-description].md`

**Save Location:** `C:\projects\Skills\Dev_doc_for_skills\`

### Step 3: Fill All Applicable Sections

Follow the template structure below. Be thorough - this documentation serves as the foundation for future Skills.

### Step 4: Assess Skill Potential

Score the task's reusability. High scores (20+) indicate strong skill candidates.

### Step 5: If Conversation Continues

Update the existing document instead of creating a new one. One document per session.

---

## Full SR-PTD Template

### Section A - Header and Skill Trigger Profile

```markdown
# SR-PTD - [Task ID or Brief Description]

## Section A - Header and Skill Trigger Profile

### Metadata
- **Date**: YYYY-MM-DD
- **Task ID/Ref**: [ticket number, request ID, or descriptive identifier]
- **Type**: Feature | Bug Fix | Maintenance | System Update | Refactor | Research | Automation
- **Domain/Module**: [e.g., auth, payments, meetings, reports]
- **Complexity**: Low | Medium | High | Critical
- **Time Spent**: Total __h (Planning __h | Execution __h | Verification __h)

### Skill Trigger Profile (Future YAML description)

**What triggered this task?**
> [Exact user request or problem statement that initiated this work]

**Keywords/Phrases that indicated this task:**
> [List the words/concepts that signaled this type of work was needed]

**Context markers:**
- File types involved: [.py, .docx, .xlsx, etc.]
- Systems touched: [DB name, API name, service name]
- Domain concepts: [meetings, reports, users, payments, etc.]

**Draft Skill Trigger** (if this became a skill, when should it activate?):
> [Write 1-2 sentences describing when this skill should trigger]
```

### Section B - Context and Inputs

```markdown
## Section B - Context and Inputs

### Problem Statement
- **Objective**: [1-2 sentences - what needed to be accomplished]
- **Why it mattered**: [Business value or technical necessity]
- **Success criteria**: [How did we know when it was done?]

### Starting State
- **Files/Data received**: 
  - `[filename]` - [purpose/contents]
  - `[filename]` - [purpose/contents]
- **Existing code/configs touched**: 
  - `[path/file]` - [what it contained]
- **Relevant tickets/docs**: [Links]

### Environment
- **Runtime**: [Local | CI | Staging | Prod]
- **Tool versions**: [Python 3.11, Node 18, etc.]
- **Dependencies used**: [Key packages]

### Constraints and Dependencies
- **Deadlines**: [if any]
- **External dependencies**: [APIs, services, people]
- **Blockers encountered**: [if any]
```

### Section C - Workflow Executed (Future SKILL.md Body)

```markdown
## Section C - Workflow Executed

### Workflow Type
- [ ] Sequential (steps in fixed order)
- [ ] Conditional (branching based on input/state)
- [ ] Iterative (repeat until condition met)
- [ ] Hybrid

### High-Level Steps Taken
1. [Step name] - [One-line what was done]
2. [Step name] - [One-line what was done]
3. [Step name] - [One-line what was done]
...

### Detailed Step Log

#### Step 1: [Step Name]
- **Action**: [What was done]
- **Tool/Command**: 
  ```bash
  [Exact command or code snippet]
  ```
- **Input**: [What this step received]
- **Output**: [What this step produced]
- **Decision made**: [If any choice was made, what and why]
- **Time**: [Optional]

#### Step 2: [Step Name]
- **Action**: 
- **Tool/Command**: 
  ```bash
  ```
- **Input**: 
- **Output**: 
- **Decision made**: 

[Continue for each meaningful step...]

### Decision Points Encountered

| Decision | Options Considered | Choice Made | Rationale |
|----------|-------------------|-------------|-----------|
| [What needed deciding] | [Option A, Option B] | [Chosen option] | [Why] |

### Workflow Diagram (if complex)
```
START
  |
  +-> [Step 1]
  |     |
  |     v
  +-> [Step 2] --> Condition? --> YES -> [Path A]
  |                    |
  |                    +-> NO -> [Path B]
  |
  +-> [Final Step]
```
```

### Section D - Knowledge Accessed (Future references/)

```markdown
## Section D - Knowledge Accessed

### Database/Data Knowledge Used

**Tables Queried:**
| Table | Columns Used | Purpose in This Task |
|-------|--------------|---------------------|
| | | |

**Queries Written:**
```sql
-- [Purpose of query]
[Actual SQL]
```

**Schema Knowledge Required:**
> [What did you need to know about the data structure?]

**Relationships Leveraged:**
> [What table joins or foreign keys were important?]

---

### API Knowledge Used

**Endpoints Called:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| | | |

**Request/Response Patterns:**
```json
// Request to [endpoint]
{
}

// Response
{
}
```

**Authentication Used:**
> [How did you authenticate?]

**Rate Limits/Errors Encountered:**
> [Any API-specific issues?]

---

### Codebase Knowledge Used

**Files Read/Modified:**
| File Path | Why Accessed | Key Content |
|-----------|--------------|-------------|
| | | |

**Patterns/Conventions Followed:**
> [What naming conventions, code patterns, or architectural decisions did you follow?]

**Dependencies/Imports Required:**
```python
# Key imports used
from x import y
```

---

### Documentation/External Knowledge Used

**Docs Consulted:**
- [Link or reference] - [What you learned from it]
- [Link or reference] - [What you learned from it]

**Domain Knowledge Applied:**
> [What business logic, rules, or domain concepts were essential?]
```

### Section E - Code Written/Used (Future scripts/)

```markdown
## Section E - Code Written/Used

### New Code Created

#### Script/Function 1: [Name]
**Purpose**: [One line]
**Reusability**: [ ] One-time | [ ] Likely reusable | [ ] Definitely reusable

```python
# [filename].py
[Full code or key sections]
```

**Inputs**: [Parameters, files, etc.]
**Outputs**: [Return values, files created, etc.]
**Dependencies**: [Required packages]

**Should this become a skill script?** [ ] Yes | [ ] No
**Why/Why not**: 

---

#### Script/Function 2: [Name]
**Purpose**: 
**Reusability**: [ ] One-time | [ ] Likely reusable | [ ] Definitely reusable

```python
```

**Should this become a skill script?** [ ] Yes | [ ] No
**Why/Why not**: 

---

### Existing Code Reused

| Code Source | What It Did | Modifications Made |
|-------------|-------------|-------------------|
| [path or snippet name] | | |

---

### Code That Should Be Extracted to Script

| Functionality | Current Location | Extraction Priority | Notes |
|---------------|------------------|---------------------|-------|
| [What it does] | [Inline/ad-hoc] | High | Medium | Low | [Why extract] |
```

### Section F - Outputs Produced (Future assets/)

```markdown
## Section F - Outputs Produced

### Files Created

| Filename | Format | Purpose | Template Potential |
|----------|--------|---------|-------------------|
| | | | [ ] Could be template |
| | | | [ ] Could be template |

### Output Patterns/Formats Used

**If output followed a structure, document it:**

```markdown
# [Output Type] Structure

## Section 1: [Name]
[What goes here]

## Section 2: [Name]
[What goes here]
```

**Should this become a template asset?** [ ] Yes | [ ] No
**Why/Why not**: 

---

### Generated Artifacts

- **Reports**: [Paths/links]
- **Data files**: [Paths/links]
- **Configs created**: [Paths/links]
- **PRs/Commits**: [Links]
```

### Section G - Issues and Fixes

```markdown
## Section G - Issues and Fixes

### Issues Encountered

#### Issue 1: [Brief Name]
- **Symptom**: [What went wrong / what you observed]
- **Root Cause**: [Why it happened]
- **Fix Applied**: [What you did]
- **Time Lost**: [Optional]
- **Prevention**: [How to avoid in future]

#### Issue 2: [Brief Name]
- **Symptom**: 
- **Root Cause**: 
- **Fix Applied**: 
- **Prevention**: 

### Error Patterns Worth Documenting

| Error Type | Cause | Solution | Include in Skill? |
|------------|-------|----------|-------------------|
| | | | [ ] Yes |
| | | | [ ] Yes |
```

### Section H - Verification and Validation

```markdown
## Section H - Verification and Validation

### Tests Run

| Test Type | What Was Tested | Result | Evidence |
|-----------|-----------------|--------|----------|
| Manual | | Pass/Fail | |
| Unit | | Pass/Fail | |
| Integration | | Pass/Fail | |
| E2E | | Pass/Fail | |

### Validation Evidence
- **Screenshots**: [Links/paths]
- **Logs**: [Links/paths]
- **Metrics**: [Before/after if applicable]

### Success Criteria Verification

| Criterion | Met? | Evidence |
|-----------|------|----------|
| [From Section B] | Yes/No | |
| | | |
```

### Section I - Skill Extraction Assessment

```markdown
## Section I - Skill Extraction Assessment

### Reusability Score

Rate this task's potential for skill extraction:

| Dimension | Score (1-5) | Notes |
|-----------|-------------|-------|
| **Frequency**: How often will similar tasks occur? | | |
| **Consistency**: Is the workflow stable or highly variable? | | |
| **Complexity**: Would Claude benefit from structured guidance? | | |
| **Codifiability**: Can steps be clearly documented? | | |
| **Tool-ability**: Are there scripts worth bundling? | | |
| **TOTAL** | /25 | |

**Extraction Recommendation:**
- [ ] **High Priority** (Score 20+): Create skill soon
- [ ] **Medium Priority** (Score 12-19): Accumulate more examples first
- [ ] **Low Priority** (Score <12): Keep as reference only

---

### Proposed Skill Structure (if extracting)

```
[proposed-skill-name]/
+-- SKILL.md
|   +-- [Workflow from Section C]
+-- scripts/
|   +-- [Code from Section E marked as reusable]
+-- references/
|   +-- schema.md      <- [DB knowledge from Section D]
|   +-- api.md         <- [API knowledge from Section D]
|   +-- examples.md    <- [This task as an example]
+-- assets/
    +-- [Templates from Section F]
```

### Draft Skill Description

```yaml
name: [proposed-name]
description: |
  [Combine trigger profile from Section A with workflow summary from Section C.
   This should clearly state WHAT the skill does and WHEN it should activate.]
```

---

### Knowledge Gaps Identified

| Gap | Impact | How to Fill |
|-----|--------|-------------|
| [What you didn't know that would have helped] | [Time lost, errors caused] | [Research, docs, ask someone] |

### Patterns Emerging

> [If you've done similar tasks before, what patterns are you seeing?
> This helps identify when multiple SR-PTDs should merge into one Skill.]
```

### Section J - Tags and Storage

```markdown
## Section J - Tags and Storage

### Tags (for aggregation and skill clustering)

- **Languages**: [Python, TypeScript, SQL, etc.]
- **Frameworks/Libs**: [FastAPI, React, pandas, etc.]
- **Data Stores**: [PostgreSQL, Redis, S3, etc.]
- **External Services**: [Stripe, OpenAI, AWS, etc.]
- **Domain**: [meetings, reports, auth, payments, etc.]
- **Task Pattern**: [CRUD, ETL, generation, transformation, etc.]
- **Security/Compliance**: [PII, encryption, audit, etc.]

### Related Documents

- **Previous similar tasks**: [Links to other SR-PTDs]
- **Existing skills this could extend**: [Skill names]
- **Documentation updated**: [Links]

### Storage

- **Filename**: `SR-PTD_[YYYY-MM-DD]_[task-id]_[brief-description].md`
- **Location**: C:\projects\Skills\Dev_doc_for_skills\
- **Skill Candidate Queue**: [ ] Added to skill backlog
```

---

## Quick Capture Template (Minimal Version)

For simpler tasks, use this abbreviated format:

```markdown
# SR-PTD - [Brief Description]

**Date**: YYYY-MM-DD | **Type**: | **Domain**: | **Complexity**: 

## Trigger
> [What request/problem initiated this?]

## Workflow (numbered steps)
1. 
2. 
3. 

## Key Decisions
- [Decision] -> [Choice] -> [Why]

## Knowledge Used
- **DB**: 
- **API**: 
- **Code patterns**: 

## Code Written (if reusable)
```python
```

## Output Format (if templatable)
```
```

## Issues -> Fixes
- [Issue] -> [Fix]

## Skill Potential: Low | Medium | High
**Notes**: 

## Tags
Languages: | Domain: | Services: 
```

---

## Aggregation: From SR-PTDs to Skills

After accumulating 3-5 SR-PTDs for similar tasks:

### 1. Cluster Related Documents
Group SR-PTDs by:
- Same domain/module
- Similar trigger patterns
- Overlapping workflows
- Shared code/scripts

### 2. Extract Common Patterns
- **Workflow**: What steps appear in ALL instances?
- **Variations**: What steps differ and why?
- **Scripts**: What code was reused or rewritten each time?
- **References**: What knowledge was needed every time?

### 3. Build the Skill
1. Populate SKILL.md from common workflow
2. Add scripts from SR-PTDs marked "reusable"
3. Create reference files from aggregated knowledge
4. Add templates from recurring output formats

---

## Example: Mapping SR-PTD to Skill Components

**Task**: Generated executive summary from meeting transcript

| SR-PTD Section | Content | Skill Component |
|----------------|---------|-----------------|
| Trigger Profile | "Create summary from transcript, Hebrew, action items" | YAML description: "Generate executive summaries from meeting transcripts with action items extraction. Supports Hebrew and English output." |
| Workflow Step 1 | "Parsed transcript with regex for speakers" | SKILL.md: "Step 1: Parse transcript to identify speakers" |
| Workflow Step 2 | "Called Claude API with specific prompt" | scripts/generate_summary.py |
| DB Knowledge | "meetings table schema with transcript_id FK" | references/schema.md |
| API Knowledge | "POST /summaries endpoint format" | references/api.md |
| Output Format | "Executive summary with sections: Overview, Key Points, Action Items" | assets/summary_template.md |
| Issue Fixed | "Hebrew RTL formatting broke in HTML output" | SKILL.md: "Note: Use dir='rtl' for Hebrew output" |

---

## Skill Update Protocol

When a skill already exists and you complete a task using it, evaluate if updates are needed.

**Core Principle:** Every update must pass validation. Default to NOT updating unless criteria are met.

---

### Update Types

**Type A: Fix (Something Broke)**

| Severity | Trigger | Action |
|----------|---------|--------|
| **Critical** | Script crashed/hung, manual intervention required, documented method failed | Must fix immediately |
| **High** | Undocumented edge case, non-obvious workaround discovered | Update recommended |
| **Medium** | Confusing output, ambiguous docs | Consider update |

**Type B: Expand (Capability Growth)**

| Trigger | Action |
|---------|--------|
| New workflow variation discovered | Add conditional path to SKILL.md |
| Reusable code written during task | Extract to scripts/ |
| New schema/API knowledge acquired | Add to references/ |
| Output template created | Add to assets/ |
| Trigger scope should widen | Update YAML description |

**Type C: Skip (No Update Needed)**
- Skill worked as documented
- Environment-specific issue (one-off config)
- User preference (style, not function)
- Information already exists in skill
- Temporary issue (network, load)
- Rare edge case not worth documenting

---

### Decision Tree

```
Task completed using skill
|
+-> Did the skill's approach work?
    |
    +-> YES -> Any new capabilities discovered?
    |   |
    |   +-> YES -> Type B: Expand
    |   |   +-> Run Expansion Checklist
    |   |
    |   +-> NO -> Don't update
    |
    +-> NO -> Was manual intervention needed?
        |
        +-> YES -> Type A: Fix (Critical)
        |   +-> Must update
        |
        +-> NO -> Undocumented edge case?
            |
            +-> YES -> Type A: Fix (High)
            |   +-> Run Fix Checklist
            |
            +-> NO -> Just confusion?
                |
                +-> YES -> Type A: Fix (Medium)
                |   +-> Run Fix Checklist
                |
                +-> NO -> Don't update
```

---

### Pre-Update Validation

**All boxes must be checked. If any fails, STOP.**

#### For Type A (Fix)

- [ ] Gap is **absent**, not just "could be clearer"
- [ ] Verified info doesn't exist in SKILL.md, references/, or examples
- [ ] Issue is **reproducible**, not one-time environmental
- [ ] Solution is **generalizable** to other users/scenarios
- [ ] Benefit **outweighs** added complexity

#### For Type B (Expand)

- [ ] New capability is **reusable** (not one-time)
- [ ] Pattern appeared in **2+ similar tasks** (or clearly will)
- [ ] Doesn't **over-specialize** skill for rare cases
- [ ] Fits within skill's **domain scope**
- [ ] SKILL.md stays **under 500 lines** after addition

---

### Update Mapping: What Goes Where

| What You Learned | Skill Component | Update Action |
|------------------|-----------------|---------------|
| New trigger scenarios | YAML description | Expand trigger phrases |
| Workflow step missing/wrong | SKILL.md body | Fix/add step |
| New workflow branch | SKILL.md body | Add conditional path |
| Error pattern + solution | SKILL.md "Common Issues" | Add issue entry |
| DB schema knowledge | references/schema.md | Add/update tables |
| API endpoint details | references/api.md | Add/update endpoints |
| Code conventions | references/conventions.md | Document patterns |
| Detailed troubleshooting | references/troubleshooting.md | Add scenario |
| Reusable script | scripts/[name].py | Extract and test |
| Script bug fix | scripts/[name].py | Fix and test |
| Output format/template | assets/[template] | Add template file |

### Progressive Disclosure Rules

**SKILL.md body** (loaded when skill triggers):
- Core workflow steps
- Common issues (brief)
- References to detail files

**references/** (loaded on demand):
- Detailed schemas, APIs
- Extended troubleshooting
- Technical deep-dives
- Comprehensive examples

**Rule:** If adding >50 lines to SKILL.md, create a reference file instead.

---

### Update Process

#### Step 1: Classify
- Type A (Fix) or Type B (Expand)?
- Severity level?
- If Type C (Skip) -> Stop

#### Step 2: Validate
- Run appropriate checklist
- All boxes checked? -> Continue
- Any unchecked? -> Stop

#### Step 3: Map
- Identify which skill components need updates
- Use mapping table above

#### Step 4: Update

For each component:

**YAML Frontmatter:**
```yaml
# If trigger scope changed:
description: [Expanded description covering new scenarios]
```

**SKILL.md Body:**
```markdown
# Add to Common Issues (Type A Fix):
### Issue N: [Problem Name]
**Symptom:** [What user sees]
**Cause:** [Why it happens]
**Solution:** [How to fix]

# Add workflow branch (Type B Expand):
## Step N: [Step Name]
- IF [condition] -> [Action A]
- ELSE -> [Action B]
```

**references/[file].md:**
```markdown
# Add detailed knowledge
## [Topic]
[Detailed content that would bloat SKILL.md]
```

**scripts/[name].py:**
```python
#!/usr/bin/env python3
"""
Script: [name].py
Purpose: [One line]
Usage: python scripts/[name].py [args]
Returns: 0=success, 1=failure
"""
[Tested, working code]
```

**assets/[template]:**
```
[Reusable template or file]
```

#### Step 5: Verify
- [ ] YAML frontmatter valid
- [ ] SKILL.md < 500 lines
- [ ] New scripts tested
- [ ] No broken references
- [ ] No duplicate information across files

#### Step 6: Document
Brief summary (2-4 sentences):
- What was updated
- Why (trigger event)
- Which files changed
- Expected improvement

---

### Integration with SR-PTD

When completing a task with an SR-PTD document, extract updates:

| SR-PTD Section | Check For | Skill Update |
|----------------|-----------|--------------|
| Trigger Profile | New trigger phrases | -> YAML description |
| Workflow Executed | Missing/wrong steps | -> SKILL.md body |
| Decision Points | Undocumented branches | -> SKILL.md conditionals |
| Knowledge Accessed (DB) | Schema not in skill | -> references/schema.md |
| Knowledge Accessed (API) | Endpoints not in skill | -> references/api.md |
| Code Written | Marked "reusable" | -> scripts/ |
| Outputs Produced | Marked "template potential" | -> assets/ |
| Issues & Fixes | Novel error patterns | -> SKILL.md Common Issues |
| Skill Extraction Score | 20+ points | -> Consider new skill |

### SR-PTD Reusability Flags -> Updates

If SR-PTD contains:
- `[x] Should become skill script` -> Extract to scripts/
- `[x] Could be template` -> Extract to assets/
- `[x] Include in Skill (error)` -> Add to Common Issues

---

### Skill Update Quick Reference Card

```
+----------------------------------------------------------+
|                  SKILL UPDATE QUICK CHECK                 |
+----------------------------------------------------------+
|                                                          |
|  UPDATE WHEN:                                            |
|  * Script failed/hung (Critical)                         |
|  * Manual intervention required (Critical)               |
|  * Undocumented edge case hit (High)                     |
|  * Docs caused confusion (Medium)                        |
|  * Reusable code created (Expand)                        |
|  * New knowledge acquired (Expand)                       |
|                                                          |
|  DON'T UPDATE WHEN:                                      |
|  * Skill worked as documented                            |
|  * Environment-specific issue                            |
|  * User preference (not function)                        |
|  * Info already in skill                                 |
|  * Rare edge case                                        |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  WHERE TO PUT UPDATES:                                   |
|                                                          |
|  Trigger change      -> YAML description                 |
|  Workflow fix/add    -> SKILL.md body                    |
|  Error pattern       -> SKILL.md Common Issues           |
|  Detailed knowledge  -> references/                      |
|  Reusable code       -> scripts/                         |
|  Templates           -> assets/                          |
|                                                          |
|  RULE: >50 lines -> reference file, not SKILL.md        |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  VALIDATION (all must pass):                             |
|  [ ] Gap is absent, not just unclear                     |
|  [ ] Verified not already documented                     |
|  [ ] Reproducible, not one-time                          |
|  [ ] Generalizable to others                             |
|  [ ] Benefit > complexity                                |
|  [ ] SKILL.md stays < 500 lines                          |
|                                                          |
+----------------------------------------------------------+
```

---

### Update Examples

#### Example 1: Type A Fix (Critical)
**Situation:** Script hung with garbled output, had to kill and use manual commands
**Update:** 
- Fix script PowerShell parsing (scripts/kill-port.sh)
- Add Issue 6 to SKILL.md with manual fallback
- Add error pattern to references/troubleshooting.md

#### Example 2: Type A Fix (High)
**Situation:** Port showed LISTEN after killing process (zombie connection)
**Update:**
- Add Issue 5 to SKILL.md explaining zombie connections
- Add process-name-based cleanup to workflow

#### Example 3: Type B Expand
**Situation:** Wrote reusable validation script during task, SR-PTD marked it "definitely reusable"
**Update:**
- Extract script to scripts/validate_input.py
- Add usage reference to SKILL.md
- Test script independently

#### Example 4: Don't Update
**Situation:** Skill worked perfectly, user asked to change output colors
**Why:** Preference, not function. Skill worked as documented.

---

## Quick Reference Card

```
+----------------------------------------------------------+
|                  SR-PTD QUICK REFERENCE                   |
+----------------------------------------------------------+
|                                                          |
|  AFTER EVERY TASK:                                       |
|  1. Create SR-PTD file in Dev_doc_for_skills/            |
|  2. Fill sections (full or quick capture)                |
|  3. Score skill potential                                |
|  4. Tag for aggregation                                  |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  SECTION -> SKILL MAPPING:                               |
|                                                          |
|  Trigger Profile    -> YAML description                  |
|  Workflow Executed  -> SKILL.md body                     |
|  Knowledge Accessed -> references/                       |
|  Code Written       -> scripts/                          |
|  Outputs Produced   -> assets/                           |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  SKILL POTENTIAL SCORING:                                |
|                                                          |
|  20+ points  -> High Priority (create skill soon)        |
|  12-19 points -> Medium (accumulate more examples)       |
|  <12 points  -> Low (keep as reference)                  |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  FILE NAMING:                                            |
|  SR-PTD_YYYY-MM-DD_[task-id]_[description].md            |
|                                                          |
|  SAVE TO:                                                |
|  C:\projects\Skills\Dev_doc_for_skills\                  |
|                                                          |
+----------------------------------------------------------+
```

---

## Maintenance

This skill improves based on usage. Updates occur when:
- Documentation structure proves insufficient
- New patterns emerge from aggregated SR-PTDs
- Skill extraction workflow is refined

Updates follow the Skill Update Protocol and require validation.
