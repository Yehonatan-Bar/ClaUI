# ============================================================
# MANDATORY: Post-Task Documentation (SR-PTD)
# ============================================================
#
# Copy this section to your ~/.claude/CLAUDE.md file
# It will enforce automatic documentation after every task
#
# ============================================================

## MANDATORY: Post-Task Documentation

**CRITICAL RULE - THIS IS NOT OPTIONAL - NO EXCEPTIONS:**

When planning ANY development task, you MUST add as the FINAL item in your task list:
```
[ ] Create SR-PTD documentation using skill at ~/.claude/skills/sr-ptd/
```

### Before Starting Any Task:
1. Create your task plan as usual
2. Add SR-PTD documentation as the last task item
3. This step is MANDATORY for: features, bug fixes, refactors, maintenance, research

### When Completing the SR-PTD Task:
1. Read `~/.claude/skills/sr-ptd/SKILL.md` for full instructions
2. Choose template: Full (complex tasks) or Quick (simple tasks)
3. Create file: `SR-PTD_YYYY-MM-DD_[task-id]_[description].md`
4. Save to: `C:\projects\Skills\Dev_doc_for_skills\`
5. Fill all applicable sections thoroughly

### Task Completion Criteria:
A task is NOT complete until SR-PTD documentation exists.
If you finish implementation but skip documentation, the task has FAILED.

### If Conversation Continues After Task:
Update the existing SR-PTD document instead of creating a new one.
One document per session, keep it current.

### Templates Location:
- Full template: `~/.claude/skills/sr-ptd/assets/full-template.md`
- Quick template: `~/.claude/skills/sr-ptd/assets/quick-template.md`
- Example: `~/.claude/skills/sr-ptd/references/example-completed.md`
