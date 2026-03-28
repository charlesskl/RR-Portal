# Learned Failure Patterns

Auto-discovered patterns from deployment fixes. Max 50 entries (FIFO eviction when full).

This file is maintained by `trigger.sh` — do NOT edit manually. When the agent fixes a
novel failure (not in the FP-01 through FP-10 registry in CLAUDE.md), it records the fix
in the state JSON's `fixes[]` array with `pattern_known: false`. After the deployment
completes, trigger.sh appends the novel pattern here.

Core patterns (FP-01 through FP-10) live in `devops/agent/CLAUDE.md` and are never evicted.
