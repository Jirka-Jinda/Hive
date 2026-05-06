# Hive User Guide

Hive is a desktop workspace for running local coding-agent sessions against your repositories. It combines repository management, terminal sessions, reusable markdown context, prompt templates, automation tasks, git helpers, log search, and approximate token usage tracking.

This guide is written for people using the installed app, not for developers working on Hive itself.

## Requirements

Hive runs as a desktop app and starts a local backend process automatically.

For normal use you should have:

- Windows 10 or Windows 11.
- Git, if you want to clone repositories, use branch worktrees, commit, push, or pull.
- At least one supported coding-agent CLI installed and authenticated.
- VS Code, optional, if you want to use the "Open in VS Code" action.

Supported agent CLIs:

- Claude Code CLI, command: `claude`
- GitHub Copilot CLI, command: `copilot`
- OpenAI Codex CLI, command: `codex`

Hive looks for these commands on your system `PATH`. If an agent is missing, it can still appear in the app, but it will not be selectable for new sessions until the CLI is installed.

## Installing And Starting

### Installer

1. Run the Hive Setup `.exe` file.
2. Choose an installation folder.
3. Launch Hive from the Start menu or desktop shortcut.

### Portable Or Unpacked Build

1. Open the release `executable` folder.
2. Run `Hive.exe` or the portable Hive executable.

When you close the Hive window, the app hides to the system tray instead of quitting. To exit fully, right-click the tray icon and choose `Quit`.

## First Launch Checklist

1. Open `Settings`.
2. Confirm the `Repositories Folder`. Hive clones and discovers repositories from this folder.
3. Confirm the `Central MD Folder`. Hive syncs central markdown files and prompt templates with this folder.
4. Add a credential profile if your agent needs an API key.
5. Add a repository.
6. Create a session for that repository.

You can also enable `PIN Lock` in Settings. When enabled, Hive asks for a 4-digit PIN when the app opens.

## Main Concepts

### Repository

A repository is a local folder or a Git clone that Hive tracks. Repositories appear in the left sidebar.

You can add repositories in two ways:

- `Local path`: Hive scans the configured repositories folder for untracked local repositories.
- `Git URL`: Hive clones the remote repository into the configured repositories folder.

When you add a repository, Hive can link central markdown files as default context for future sessions.

### Session

A session is a running or saved agent workspace for a repository. Each session has:

- A name.
- An agent type, such as Claude, Copilot, or Codex.
- An optional credential profile.
- Optional markdown context files.
- A terminal connected to the selected agent CLI.

Session states:

- Green dot: idle and ready.
- Amber pulsing dot: working.
- Gray dot: stopped.

### Git Branch Modes

For Git repositories, new sessions can use one of three branch modes:

- `New branch`: creates an isolated worktree from a new branch name.
- `Existing branch`: creates an isolated worktree from an available local or remote branch.
- `Repo root`: runs directly in the repository root checkout.

Use `Repo root` carefully. Changes are shared with the main checkout instead of being isolated in a session worktree.

### Markdown Context

Hive uses markdown files as reusable context for agents.

There are three scopes:

- `Central`: reusable across repositories.
- `Repo`: specific to the selected repository.
- `Session`: specific to one session worktree.

When a session starts, Hive resolves the effective context and injects it into the agent. Session files override repo files, and repo files can override central files with the same basename.

The selected session shows a `Resolved Context` panel so you can see exactly which files will be injected.

## Credentials And Agents

Open `Credential Profiles` to add API keys or tokens for supported agents.

The app shows the fields required by the selected agent type. Common fields include:

- Claude: `ANTHROPIC_API_KEY`
- Codex: `OPENAI_API_KEY`
- Copilot: `COPILOT_GITHUB_TOKEN`

You can also use agent CLIs that are already authenticated outside Hive, depending on the CLI. For example, a CLI login performed in a terminal may be enough for that agent to run without a Hive credential profile.

Credentials are stored locally. In the packaged desktop app, Hive derives an encryption key from the current machine.

## Working With Repositories

### Add A Repository

1. Click `+ Add` in the `Repositories` section.
2. Choose `Local path` or `Git URL`.
3. Select a discovered repository or enter a Git URL.
4. Click `Add Repository`.
5. Optionally choose central markdown context files to link to the repo.

### Edit A Repository

Select a repository and use its edit action to:

- Rename the repository display name.
- Change linked central context files.

### Remove A Repository

Select a repository and use its remove action.

If you check `Also delete from disk`, Hive deletes the local repository folder too. Leave this unchecked if you only want to remove the repository from Hive.

## Working With Sessions

### Start A Session

1. Select a repository.
2. Click `+ Add` in the `Sessions` section.
3. Enter a session name.
4. Choose an agent and optional credential profile.
5. For Git repositories, choose a branch mode.
6. Optionally choose context files.
7. Click `Start Session`.

The session terminal opens automatically when the session is selected.

### Restart A Session

Use the restart action on a session to stop and start its agent process again. This keeps the session record but refreshes the terminal connection.

### Archive Or Delete A Session

Archive a session when you want to keep it but move it out of the active list.

Delete a session when you no longer need it. For Git worktree sessions, Hive checks for uncommitted changes and warns you before deletion.

### Reorder Sessions

Drag sessions in the list to change their order.

## Terminal And Views

The main workspace can show:

- `Terminal`: the selected session terminal, or the shell terminal when no session is selected.
- `Editor`: the selected markdown file.
- `Diff`: the selected session diff view.

The shell terminal starts in the Central MD folder. Use it for local commands that are not tied to a specific agent session.

## Markdown Files

The right sidebar manages markdown files.

You can:

- Create files in central, repo, or session scope.
- Drag and drop `.md` files into a scope section.
- Rename or delete files.
- Open a file in the editor.
- Change a file type.
- Move a file between central and repo scope.
- Duplicate a central or repo file into the selected session.
- Preview markdown.
- View revision history and restore older revisions.

File types:

- `Documentation`
- `Skill`
- `Tool`
- `Instruction`
- `Prompt Template`
- `Other`

Only prompt template files appear in the prompt template runner and automation task template picker.

## Prompt Templates

Prompt templates are central markdown files with type `Prompt Template`.

Create one from the `Prompt Templates` section in the markdown sidebar, or create a central markdown file and set its type to `Prompt Template`.

A template can include YAML frontmatter:

```yaml
---
name: My Prompt
description: What this prompt does
params:
  - name: repo
    type: repo
  - name: session
    type: session
  - name: focus
    type: text
    default: "quality and correctness"
---

Review {{repo}} in session {{session}}.
Focus on {{focus}}.
```

Supported parameter types:

- `text`: free text input.
- `repo`: repository picker.
- `session`: session picker.

Run a prompt template with `Ctrl+1` or the prompt template button. Hive renders the template and sends it to the selected session.

## Automation Tasks

Automation tasks send prompt templates to running sessions on a schedule.

To create a task:

1. Open `Automation Tasks`.
2. Click `+ New Task`.
3. Enter a task name.
4. Choose a prompt template.
5. Choose a target session.
6. Choose a schedule preset or enter a cron expression.
7. Fill any template parameters.
8. Click `Create Task`.

You can run a task immediately, pause it, resume it, delete it, and inspect recent runs.

If a task fails repeatedly, Hive can disable it to avoid repeated errors.

## Git Tools

For Git repositories, Hive includes basic git helpers.

### Diff View

Use a session's diff action to open the diff view for that session. This helps review changes produced by the agent before committing.

### Git History

Open `Git History` to:

- View recent commits.
- See the current branch or HEAD.
- Commit current changes.
- Push.
- Fetch and pull.

Git history can target the repo root or a selected session worktree.

## Recent Changes

Open `Recent Changes` to see recent markdown and automation activity.

Events can include:

- Markdown file created, updated, moved, restored, or deleted.
- Automation task ran.
- Automation task failed.

Use `Open` on an event to jump back into the related screen when possible.

## Search Session Logs

Select a session and open `Search Session Logs` to search terminal output captured for that session.

Search results show matching snippets. Log search is useful for finding prior errors, file paths, commands, or agent responses.

## Token Usage

Hive can show approximate token usage for the selected repository or across all repositories.

The usage view includes:

- Total tokens.
- Prompt tokens.
- Output tokens.
- Session totals.
- Totals by agent.
- Totals by credential.

The token counter is approximate. It is intended for trend tracking and comparison, not billing-grade accounting.

Open `Prompt Pipeline` to disable `Token Usage Counter`. Disabling it hides the usage box and stops counting new tokens. Existing totals remain stored.

## Settings

Open `Settings` to configure:

- `Repositories Folder`: where Hive clones and discovers repositories.
- `Central MD Folder`: where central markdown files and prompt templates sync to disk.
- `PIN Lock`: optional 4-digit app lock.

Changing folders affects future operations immediately. If you move existing repositories or central files manually, refresh the app state after changing settings.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `F11` | Toggle full screen |
| `Ctrl+Shift+Tab` | Cycle to the next idle session |
| ``Ctrl+` `` | Cycle Terminal, Editor, and Diff views |
| `Ctrl+1` | Open prompt templates |
| `Ctrl+2` | Open automation tasks |
| `Ctrl+3` | Open recent changes |
| `Ctrl+4` | Open git history |
| `Ctrl+5` | Search selected session logs |
| `Ctrl+6` | Open selected repo or session in VS Code |
| `Ctrl+L` | Lock Hive, if PIN Lock is enabled |

The terminal captures many keyboard inputs while focused. If a shortcut does not fire, click outside the terminal and try again.

## Data And Files

Hive stores data locally.

Packaged desktop builds store the app database and terminal logs in a `data` folder next to the installed executable. Make sure the installation folder is writable by your user account.

The configured folders also matter:

- Repositories live in the `Repositories Folder`.
- Central markdown files live in the `Central MD Folder`.
- Session worktrees for Git repositories are managed under the repository storage area.

Back up these folders if you need to preserve Hive state, repositories, markdown files, and session logs.

## Troubleshooting

### An agent is not available in the session form

Install the agent CLI and restart Hive. The command must be available on your system `PATH`.

Check from a terminal:

```powershell
claude --version
copilot --version
codex --version
```

Only installed agents are selectable for new sessions.

### A session starts but the agent asks you to log in

Authenticate the CLI outside Hive or add a credential profile in Hive.

For example:

- Claude may need an Anthropic API key.
- Codex may need `codex login` or an `OPENAI_API_KEY` credential.
- Copilot may need its CLI login or token setup.

### Git actions fail

Confirm that Git is installed and available on `PATH`.

Also check that the repository has a valid remote if you are pushing, fetching, or pulling.

### A repository or central markdown file does not appear

Open `Settings` and confirm the configured folders. For local repositories, Hive discovers folders inside the configured repositories folder.

### The app opens but the backend fails to start

Restart Hive. If the problem repeats, check whether another process is blocking local ports or whether the installation folder is writable.

### The window disappears when closed

Hive is still running in the system tray. Use the tray icon to show Hive again or quit the app.

### Token totals look different from provider billing

Hive tracks approximate prompt and output tokens from terminal traffic. Provider billing can include details Hive cannot observe, such as hidden system prompts, tool schemas, cached tokens, or provider-specific accounting.
