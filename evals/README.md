# Orbit acceptance suites

`orbit eval` measures task completion from repository changes and verification
commands, not from the model claiming that it succeeded. Every task runs in a
disposable Git worktree and is discarded after its redacted trace and report
are copied to `.orbit/evaluations/`.

Review every suite before allowing its verification commands:

```powershell
orbit eval evals/deepseek-v4.yaml --provider deepseek --model deepseek-v4-pro --allow-commands
```

Use a dedicated low-privilege provider account. Do not put credentials in a
suite. Provider and model overrides can be supplied on the command line or per
task. The checked-in suite is deliberately small; release owners should add
representative private repositories without committing customer code.
