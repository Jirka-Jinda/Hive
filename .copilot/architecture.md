# Architecture Guidelines

## Purpose

This repository is a monorepo for an AI workspace application with three runtime boundaries:

- `packages/frontend`: React/Vite UI
- `packages/backend`: Hono API, WebSocket terminal bridge, SQLite-backed services
- `packages/electron`: Desktop shell and preload bridge

The goal of this document is to keep the codebase maintainable as it grows. The preferred style is clean architecture with explicit layer boundaries, small responsibilities, and clear dependency direction.

## Core Principles

1. Keep business rules independent from frameworks.
2. Separate UI concerns, application orchestration, domain logic, and infrastructure.
3. Depend inward: outer layers may depend on inner layers, never the reverse.
4. Prefer simple flows over clever abstractions.
5. Keep modules cohesive and boring: one area, one responsibility.
6. Make side effects explicit at the edges.
7. Optimize for testability and replaceability.

## High-Level Boundaries

### Frontend

The frontend is responsible for:

- rendering UI
- local interaction state
- user-triggered workflows
- consuming backend APIs and WebSocket streams

The frontend is not responsible for:

- persistent business rules
- filesystem rules
- repo validation
- terminal process lifecycle
- credential security

### Backend

The backend is responsible for:

- use-case orchestration
- domain validation
- persistence
- filesystem interaction
- agent/process management
- WebSocket bridging

The backend should be the source of truth for business rules.

### Electron

Electron is only the shell. It should handle:

- window lifecycle
- desktop-only integrations
- preload-safe APIs
- backend bootstrapping in packaged mode

Electron should not contain product logic that also needs to work in the web app.

## Clean Architecture Layers

Use these conceptual layers even if the folder names evolve.

### 1. Presentation Layer

Examples:

- React components
- layout components
- route handlers and request parsing
- Electron window/menu wiring

Responsibilities:

- collect input
- render output
- map transport details to application calls
- keep formatting and view behavior local

Must not contain:

- persistence rules
- business policy
- SQL
- filesystem logic
- process spawning logic

### 2. Application Layer

Examples:

- use cases
- workflow services
- command/query handlers
- orchestration across repositories/services

Responsibilities:

- coordinate operations
- enforce application-specific rules
- define transaction boundaries
- transform domain results into DTOs

Good examples for this repo:

- create session for repo + agent + credentials
- add repository from local path or git URL
- list markdown files across central and repo scopes
- save markdown content and refresh metadata

### 3. Domain Layer

Examples:

- entities
- value objects
- policy logic
- validation rules

Responsibilities:

- represent core concepts like repo, session, credential profile, markdown file
- hold invariant rules that should stay true regardless of transport or storage

Domain code should be pure where practical and should not know about Hono, React, SQLite, Electron, or WebSocket details.

### 4. Infrastructure Layer

Examples:

- SQLite access
- filesystem access
- `simple-git`
- `node-pty`
- encryption helpers
- HTTP client wrappers
- WebSocket adapters

Responsibilities:

- implement interfaces needed by inner layers
- isolate third-party APIs
- keep framework-specific details out of business logic

## Dependency Direction

Preferred direction:

`presentation -> application -> domain`

`infrastructure -> application/domain contracts`

Avoid:

- components importing low-level infrastructure details directly
- route files owning SQL
- React components containing cross-screen workflow logic
- Electron preload exposing broad Node access
- domain models importing framework types

## Package-Specific Guidance

## Backend

Current structure already separates `routes`, `services`, `db`, `utils`, and `ws`. Keep moving toward stronger layering.

Recommended evolution:

- `routes/`: transport only
- `application/`: use cases and orchestration
- `domain/`: entities, validation, policies
- `infrastructure/`: DB repositories, filesystem adapters, git/process adapters
- `ws/`: transport adapter for terminal streaming

Rules:

- Hono route files should parse input, call a use case, and map errors to HTTP responses.
- Route files should not contain business decisions beyond request validation.
- Database queries should be centralized behind repository-like modules or infrastructure services.
- Filesystem and git operations should be wrapped so they can be tested and swapped more easily.
- `node-pty` usage should stay isolated to process-oriented infrastructure.
- WebSocket handlers should delegate to application/process services instead of owning session rules.

Suggested backend flow:

1. Route validates request shape.
2. Application service executes the use case.
3. Domain rules validate invariants.
4. Infrastructure performs DB/filesystem/process work.
5. Route serializes the result.

## Frontend

The frontend should be split by responsibility, not just by component size.

Recommended mental model:

- `components/`: presentation and interaction
- `store/`: app state and UI/application coordination
- `api/`: backend transport clients
- `hooks/`: reusable integration hooks, not business dumping grounds

Rules:

- Components should stay focused on rendering and user interaction.
- Shared app workflows should live in store actions or dedicated frontend application hooks.
- Keep fetch/WebSocket details inside `api/` and `hooks/`.
- Avoid duplicating backend rules in the UI. The frontend may validate for UX, but the backend remains authoritative.
- Derived state should be computed close to where it is used, unless multiple screens depend on it.
- Prefer typed DTOs from `api/client.ts` instead of ad hoc inline shapes.

Frontend container/presenter split is encouraged when a component starts doing too much:

- container: data loading, orchestration, store calls
- presenter: rendering only

## Electron

Electron should remain thin.

Rules:

- `main.ts` handles app lifecycle, window creation, IPC registration, and backend process startup.
- `preload.ts` exposes the smallest safe bridge possible.
- Do not expose filesystem or shell primitives to the renderer unless there is a clear need.
- Desktop-only features should degrade gracefully when the app runs in browser-only development mode.

## Layer Separation Rules

### Never do this

- Put SQL directly in route handlers.
- Put filesystem mutations directly in React components.
- Put business rules in Electron main/preload.
- Let WebSocket event handlers become the source of truth for session state.
- Reuse UI DTOs as domain models without thinking about invariants.

### Prefer this

- Small route handlers that call one application service.
- Small React components that receive props and emit events.
- Shared domain validation in one place.
- Infrastructure wrappers around external libraries.
- Explicit return types and transport DTOs.

## State and Data Flow

Use one-directional flow whenever possible.

### Frontend flow

1. User interacts with UI.
2. Component calls store action or app-level handler.
3. Handler calls API/WebSocket adapter.
4. Response updates store state.
5. UI re-renders from state.

### Backend flow

1. Request enters route.
2. Route maps to use case input.
3. Application service runs.
4. Infrastructure reads/writes DB, filesystem, process state.
5. Result returns as DTO.

## Error Handling

- Validate early at boundaries.
- Fail with typed, user-meaningful errors where possible.
- Do not leak raw infrastructure exceptions to the UI without mapping.
- Keep logging in outer layers.
- Keep domain/application layers focused on meaning, not log formatting.

## Testing Strategy

Aim for tests at the right layer.

### Domain/Application

- fast unit tests
- invariant validation
- use-case behavior
- edge cases and negative paths

### Infrastructure

- integration tests for DB, filesystem, git, and process boundaries
- careful mocking only when isolation is necessary

### Frontend

- component behavior tests for important UI flows
- store/action tests for workflow logic
- avoid over-testing presentational markup

### End-to-End

- repo creation
- session creation
- terminal attachment
- markdown CRUD
- credential lifecycle

## Naming and Structure

- Prefer names that reflect business meaning over implementation detail.
- Use `createX`, `updateX`, `listX`, `deleteX`, `attachX`, `startX` for use cases.
- Use `Repository`, `Store`, `Manager`, or `Service` deliberately:
- `Repository`: persistence abstraction
- `Service`: application workflow or domain policy
- `Manager`: infrastructure coordinator for external systems
- `Store`: state holder

If a file grows in mixed responsibilities, split it by layer before adding more logic.

## Practical Guidance For This Repo

- Keep generated output in `dist/` and packaged output in `release/` out of manual edits.
- Put new backend behavior behind a route -> application -> infrastructure flow instead of extending route files indefinitely.
- Keep markdown file rules centralized so central and repo-scoped behavior stays consistent.
- Keep session/process lifecycle rules centralized so terminal, API, and future features do not drift.
- Prefer adding typed APIs once in `api/client.ts` rather than scattered fetch calls.
- Keep desktop features optional and safe behind `window.electronAPI`.

## Change Checklist

Before merging architectural changes, ask:

1. Which layer owns this rule?
2. Did I place framework code only in outer layers?
3. Can this logic be tested without spinning up the whole app?
4. Did I duplicate a rule that should live in one shared place?
5. Did I keep Electron thin and secure?
6. Did I avoid editing generated artifacts?

## Default Recommendation

When in doubt:

- put UI behavior in components
- put frontend orchestration in store/hooks
- put business workflows in backend application services
- put core rules in domain modules
- put SQL/filesystem/process/tooling code in infrastructure adapters

This repo will stay healthy if we keep responsibilities narrow, dependencies directional, and side effects at the edges.
