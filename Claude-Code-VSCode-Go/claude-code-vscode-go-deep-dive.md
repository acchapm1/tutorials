---
title: "Claude Code in VSCode with Go: Deep Dive Reference"
date: 2026-04-10
difficulty: advanced
tags: [claude-code, vscode, go, ai, coding-assistant, prompt-engineering, refactoring, ci-cd]
---

# Claude Code in VSCode with Go: Deep Dive Reference

## 1. Overview

This reference guide covers advanced techniques for using Claude Code with Go projects in VSCode. Building on the foundations of the beginner guide, we explore:

- **Prompt engineering** — How to craft precise, high-signal prompts that yield better results
- **Multi-file refactoring** — Coordinating changes across many files
- **Project context** — Using `CLAUDE.md` and `@terminal` references effectively
- **Testing and iteration** — Systematic approaches to test generation, debugging with Claude, and fixing failures
- **CI/CD integration** — Automating builds, tests, and deployments via Claude Code
- **Advanced Go patterns** — Dependency injection, middleware chains, error handling strategies, and Go-specific idioms
- **Performance optimization** — Profiling, caching, and tuning with Claude's help
- **Architecture decisions** — Database selection, API design patterns, concurrency models

This reference assumes you are comfortable with the basics: installing Claude Code, running your first Go API, and understanding how diffs work. You should also have intermediate Go knowledge (packages, interfaces, goroutines).

---

## 2. Prerequisites

Before diving in, ensure you have:

- **VSCode 1.98.0+** — With Claude Code extension installed and authenticated
- **Go 1.21+** — Proficiency with packages, testing, and the standard library
- **Node.js 18+** — For the Claude Code CLI
- **Intermediate Go skills** — Comfortable with structs, interfaces, error handling, and goroutines
- **Git** — For version control and managing large refactorings
- **Optional tools:** `docker`, `postgresql`, `curl`, `ab` (Apache Bench), `pprof` (Go profiling)
- **A multi-file Go project** — The techniques here are most valuable when managing complexity across many files

---

## 3. Key Concepts

### Prompt Engineering for Better Results

Claude Code performs better with **specific, scoped prompts**. A vague request like "improve the code" yields mediocre results. A precise request like "add a middleware that validates JWT tokens in the Authorization header and returns 401 if invalid" produces targeted, high-quality changes.

**Signal-to-noise ratio:** Every detail you include should reduce ambiguity. Mentioning specific file names, function names, error types, and expected behavior narrows the solution space.

### Architectural Patterns in Go

**Go favors composition over inheritance.** Unlike OOP languages, Go uses small interfaces and embedding to build flexible systems. Claude Code excels at generating:

- **Interface-based handlers** — decoupling HTTP handlers from business logic
- **Middleware chains** — cleanly adding cross-cutting concerns (logging, auth, metrics)
- **Error wrapping** — using `%w` in `fmt.Errorf` to preserve error chains
- **Context propagation** — passing context through function calls for cancellation and timeouts

### Refactoring Strategies

Large refactors (moving files, changing function signatures, adding packages) are risky. Claude Code mitigates this by:

1. **Planning** — You see the plan before changes
2. **Testing** — It generates tests alongside refactors
3. **Reversibility** — You can rewind to any checkpoint
4. **Staged commits** — Breaking big changes into small, reviewable diffs

### Multi-File Synchronization

When Claude changes one file, it may need to update 3-5 others (handlers, models, tests, docs, `CLAUDE.md`). Specify *all* affected files in your prompt to reduce round-trips.

### Terminal Integration

Claude can see your terminal output. When tests fail, use `@terminal` to reference the error:

```
Here's my test output:
@terminal

The handler is returning 200 OK, but it should return 400 when the task title is empty.
Can you fix the validation?
```

Claude will analyze the actual error and fix the root cause rather than guessing.

---

## 4. Step-by-Step Instructions

### 4.1 Using CLAUDE.md for Project Context

Create a `CLAUDE.md` file at the root of your Go project. Claude reads this file on every conversation and uses it as a "style guide" for your project.

```markdown
# CLAUDE.md — Task API Project Context

## Project Overview
A production-ready REST API for task management, built in Go with the standard library.

## Architecture
- **main.go** — Server startup, routing, middleware setup
- **models.go** — Task struct, persistence layer, validation
- **handlers.go** — HTTP handlers for CRUD operations
- **middleware.go** — Authentication, logging, error handling
- **db.go** — File-based or database persistence
- **cmd/client/** — Example client programs

## Tech Stack
- Go 1.21+
- SQLite3 for persistence (using database/sql)
- Standard library only (no external frameworks)
- Docker for deployment

## Commands
- Run: `go run .`
- Test: `go test -v ./...`
- Coverage: `go test -cover ./...`
- Build: `go build -o task-api`
- Lint: `go vet ./...`
- Format: `gofmt -w .`

## Code Style
- Errors returned in JSON: `{"error": "description"}`
- HTTP status codes: 201 for creation, 400 for bad request, 404 for not found, 500 for server errors
- Function names: CamelCase, exported if part of public API
- Receiver names: Single letter (e.g., `func (h *Handler) GetTasks(...)`)
- Error handling: Wrap errors with context using `fmt.Errorf("operation: %w", err)`
- Concurrency: Use context.Context for cancellation, sync.RWMutex for shared state

## Testing
- Write tests alongside features
- Test coverage target: 80%+
- Use table-driven tests for multiple cases
- Mock time with time.MockClock (or similar)
- Do not use external test frameworks; use standard testing package

## Dependencies
- None (all standard library)
- New dependencies require discussion before adding

## Performance Targets
- API response time: < 50ms for reads, < 100ms for writes
- Memory footprint: < 50MB idle

## Known Limitations
- In-memory store (task loss on restart) — migrate to database for production
- No authentication yet — add JWT or API keys before public deployment
- Single-threaded request handling — safe; Go handles concurrency internally
```

Include this in your project, and Claude will adapt its suggestions to match your conventions, constraints, and goals.

### 4.2 Crafting High-Quality Prompts

**Poor prompt:**

```
Make the error handling better.
```

**Good prompt:**

```
Improve error handling in handlers.go. Ensure all errors are returned as JSON with a consistent format: 
{"error":"message"}. Use fmt.Errorf with %w to wrap errors and preserve stack context. 
Return 400 for validation errors, 404 for not found, and 500 for internal server errors. 
Update the error handling middleware to log errors before returning responses.
```

**Elements of a strong prompt:**

1. **Specific files** — "in handlers.go" (not "in the code")
2. **Desired behavior** — "return JSON errors in this format"
3. **Technical constraints** — "use fmt.Errorf with %w"
4. **Edge cases** — "return 400 for validation, 404 for not found, 500 for internal errors"
5. **Related changes** — "update the error handling middleware"

### 4.3 Multi-File Refactoring: Adding a Database Layer

Suppose you want to migrate from in-memory storage to SQLite. Here is a structured approach:

**Prompt:**

```
I want to migrate from in-memory task storage to SQLite. Here's the plan:

1. Create db.go with a Database struct that wraps sql.DB
2. Add methods on Database: CreateTask, GetTask, GetAllTasks, UpdateTask, DeleteTask
3. Update models.go: Remove the in-memory store, add a db field to TaskManager
4. Update handlers.go: Change all store operations to use db method calls
5. Create db_test.go with tests for database operations
6. Update main.go to open the SQLite file and initialize the database
7. Add schema initialization (CREATE TABLE IF NOT EXISTS)

For SQLite, use package database/sql with the _ "github.com/mattn/go-sqlite3" driver.

Start with the plan. I'll review it before you make changes.
```

Claude will show you the plan, you approve it, and then it executes the refactor across all files at once.

### 4.4 Using @terminal References

When your code fails, instead of describing the error in words, reference the terminal output:

**In your terminal:**

```bash
go run .
# Output:
# 2026-04-10 10:30:45 | [ERROR] handler panic: json: cannot unmarshal bool into Go value of type string
```

**In Claude Code:**

```
My server crashed with this error:
@terminal

The Completed field in the JSON request is a boolean, but it's being unmarshalled as a string. 
Can you fix the Task struct definition and the unmarshal logic?
```

Claude will see the exact error, understand the mismatch, and fix it correctly.

### 4.5 Checkpoint and Rewind Strategies

Large refactors carry risk. Use checkpoints:

1. Before asking Claude to make a big change, take a mental checkpoint in the conversation
2. Ask Claude to make the change and show the plan
3. Review the plan carefully
4. Click Approve
5. Review each diff
6. If something looks wrong, click **Rewind** on the message before the change
7. Explain what went wrong and ask Claude to try a different approach

This prevents you from accidentally accepting a breaking change.

### 4.6 Test-Driven Development with Claude

Strong workflow:

1. **Write the test first** (or ask Claude to)
2. **Run the test** — it fails (red)
3. **Ask Claude to implement** the feature to make the test pass
4. **Run the test again** — it passes (green)
5. **Ask Claude to refactor** without changing behavior
6. **Run the test** — still passes (refactor)

Example prompt:

```
Write a table-driven test in handlers_test.go that tests the GetTask handler with these cases:
- Valid task ID returns 200 with the task
- Invalid task ID returns 404
- Empty task ID returns 400

Then implement the handler to pass these tests.
```

Claude will create the tests and implementation together, ensuring they match.

### 4.7 Debugging with Claude's Help

**Scenario:** Your test is failing with an unexpected assertion error.

In Claude:

```
This test is failing:
@terminal

The test expects the task status to be updated, but the database still shows the old value. 
The handler is returning 200 OK, so it looks like the database update is not being persisted. 
Can you debug this?
```

Claude will:

1. Examine the test
2. Examine the handler code
3. Identify the bug (maybe the transaction is not being committed)
4. Fix it
5. Explain what was wrong

### 4.8 Performance Optimization Workflow

**Prompt:**

```
I want to optimize the GetAllTasks handler for performance. Currently, it's loading all tasks 
into memory and filtering them in Go. We should:

1. Add a limit and offset parameter to GetAllTasks
2. Pass them to the database query
3. Add pagination support to the response (include total count)
4. Update the handler tests to cover pagination

Start with the plan.
```

After implementation:

```
Now let's profile the endpoint. I'll run:
go test -bench=BenchmarkGetAllTasks -benchmem ./handlers

Show me the benchmark code you'd generate, and then implement it.
```

Claude can generate benchmarks, and you can iteratively optimize.

### 4.9 Middleware Patterns

**Request logging middleware:**

```
Add a middleware in middleware.go called LoggingMiddleware that:
1. Wraps the next handler
2. Records the start time
3. Calls the next handler
4. Calculates elapsed time
5. Logs: timestamp | method | path | status | duration

Apply this middleware to all routes in main.go. Use slog (standard logging) if available, else log.
```

**Authentication middleware:**

```
Add a JWT authentication middleware called AuthMiddleware:
1. Extract the Authorization header
2. Verify the JWT token (use the standard library crypto/hmac, standard library jwt support, or a simple token validation)
3. If invalid, return 401 Unauthorized
4. If valid, attach the user ID to the request context
5. Call the next handler

Add this middleware only to protected routes (POST, PUT, DELETE).
```

---

## 5. Practical Examples

### Example 1 — Database Migration

**Starting point:** In-memory task store in `models.go`.

**Goal:** Move to SQLite without losing functionality or breaking tests.

**Prompt:**

```
Let's migrate the task store from in-memory to SQLite. Here's what I want:

1. Create db.go with a Store struct that manages the SQLite database
2. Implement these methods on Store:
   - Open(dbPath string) error — opens/creates the SQLite file
   - Close() error
   - CreateTask(title, description string) (*Task, error)
   - GetTask(id int) (*Task, error)
   - GetAllTasks() ([]Task, error)
   - UpdateTask(id int, task *Task) error
   - DeleteTask(id int) error

3. In models.go, replace the in-memory store with a Store instance
4. In main.go, initialize the store with Open("tasks.db")
5. Create db_test.go with tests for all Store methods
6. Don't break existing handler tests — they should still pass

For the schema:
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  completed BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

Show me the plan first.
```

Claude will:

1. Show a plan (create db.go, modify models.go, etc.)
2. You approve
3. It creates/modifies 4-5 files
4. Tests pass because the handler logic is unchanged, only the storage backend

### Example 2 — Adding Authentication (JWT)

**Prompt:**

```
Add JWT-based authentication to the API. Here's the design:

1. Add a POST /auth/token endpoint that:
   - Accepts {"username": "user", "password": "pass"}
   - For now, accept any username/password (we'll add a user table later)
   - Generate a JWT token signed with a secret key (use crypto/hmac + base64)
   - Return {"token": "..."}

2. Add AuthMiddleware in middleware.go that:
   - Extracts the Authorization header (format: "Bearer <token>")
   - Validates the JWT signature
   - Returns 401 if invalid
   - Attaches the username to the request context if valid

3. Apply AuthMiddleware to all CRUD endpoints (POST /tasks, PUT /tasks/:id, DELETE /tasks/:id)
   - GET endpoints remain public

4. Update handlers to extract the username from context and store it as the task creator

5. Add tests for valid and invalid tokens

Start with a plan that includes all affected files.
```

Claude will architect the auth system, focusing on simplicity (no external JWT library, just crypto and base64).

### Example 3 — Concurrency and Context Cancellation

**Prompt:**

```
Add context cancellation and timeout support to the API:

1. Add a --timeout flag to the server (default 30s) that applies to all requests
2. Update main.go to create a context with this timeout and pass it to all handlers
3. Update all database operations to respect context.Done()
4. If a request is cancelled, return 408 Request Timeout

For the database:
- In db.go, update all Store methods to accept a context parameter
- Use context.WithTimeout in tests to verify timeout behavior

Add tests that:
- Simulate a slow operation
- Timeout and verify 408 response
- Verify that the operation is cleaned up (not running in the background)

Show the plan first, including all file changes.
```

Claude will add context propagation throughout, teaching you Go's concurrency best practices.

### Example 4 — Error Handling and Recovery

**Prompt:**

```
Improve error handling and add recovery:

1. In main.go, wrap all handlers with a recovery middleware that:
   - Catches panics (using recover())
   - Logs the panic with stack trace
   - Returns 500 Internal Server Error with a safe error message (not the panic details)

2. In handlers.go, improve error responses:
   - All errors return JSON with "error" and "code" fields
   - Code examples: "invalid_input", "not_found", "internal_error"
   - Example: {"error":"Task ID must be a positive integer","code":"invalid_input"}

3. In db.go, wrap database errors with context:
   - "create task: database error: ..." instead of just the raw database error

4. Update error handling middleware to log errors with context before returning

5. Add tests that verify:
   - Panics are caught and return 500
   - Validation errors return 400 with "invalid_input" code
   - Database errors return 500 with "internal_error" code

Show the plan, including main.go, handlers.go, db.go, middleware.go, and handler_test.go.
```

Claude will implement defense-in-depth error handling.

### Example 5 — CI/CD Integration and Docker

**Prompt:**

```
Add Docker support and CI/CD:

1. Create a Dockerfile:
   - Use golang:1.21 as build stage
   - Compile the binary
   - Use a minimal base image (alpine or scratch) as runtime
   - Run the API on port 8080
   - Copy the compiled binary and any config files

2. Create a .github/workflows/test.yml (GitHub Actions):
   - Run on push and pull requests
   - Check out the code
   - Set up Go 1.21
   - Run `go vet ./...` (linting)
   - Run `go test -v ./...` (tests)
   - Run `go build -o task-api` (build check)

3. Create a Makefile:
   - make test — runs tests
   - make build — builds the binary
   - make docker-build — builds the Docker image
   - make docker-run — runs the Docker container
   - make docker-push — pushes to Docker Hub (if configured)

4. Update README.md with Docker and CI/CD instructions

Show the plan, including the Dockerfile, GitHub Actions workflow, and Makefile.
```

Claude will set up professional build and deployment infrastructure.

---

## 6. Hands-On Exercises

### Exercise 1 — Refactor Handlers to Use Interfaces

Create an interface for the task store:

```
In models.go, define a TaskStore interface with methods: CreateTask, GetTask, GetAllTasks, 
UpdateTask, DeleteTask. Make both the in-memory store and the database store implement this 
interface. Update handlers.go to depend on TaskStore instead of a concrete type. This makes 
it easy to swap implementations.

Show the plan, then implement.
```

### Exercise 2 — Add Logging Levels

Extend the logging middleware:

```
Add a LogLevel configuration (debug, info, warn, error) and only log messages at or above 
that level. Use environment variables to configure it (TASK_API_LOG_LEVEL=debug). Add 
structured logging with fields (method, path, status, duration, user_id).

Show the plan.
```

### Exercise 3 — Implement Batch Operations

Add bulk endpoints:

```
Add POST /tasks/batch endpoint that accepts an array of tasks and creates them all in a 
transaction. If any task is invalid, return 400 and roll back all changes. Also add a 
DELETE /tasks/batch endpoint that deletes multiple tasks by ID.

Start with the test (table-driven, covering success and rollback scenarios).
```

### Exercise 4 — Add Request/Response Validation

Use Go's encoding/json tags for validation:

```
In models.go, add struct tags to Task: json:"title,omitempty" validate:"required,min=1,max=255"

Create a validation middleware that:
1. Unmarshals the request body
2. Calls a Validate() method on the request struct
3. Returns 400 with detailed field errors if validation fails
4. Example response: {"errors":{"title":"required","description":"too_long"}}

Apply this to POST and PUT handlers.

Show the plan.
```

### Exercise 5 — Performance Test and Optimize

```
Create a benchmark in handlers_test.go that:
1. Creates 10,000 tasks
2. Runs GetAllTasks with pagination (limit=100, offset=0..100)
3. Measures time and memory

Run it: go test -bench=. -benchmem

Identify the bottleneck (probably N+1 queries or inefficient sorting). Ask me to optimize it.
```

---

## 7. Troubleshooting

### Claude suggests breaking changes without warning

**Cause:** Your prompt was ambiguous about which files to update.

**Fix:** Explicitly list all affected files in your prompt. Example: "Update handlers.go, models.go, db.go, and handlers_test.go..."

### Tests fail after Claude's refactor

**Cause:** Claude changed function signatures but missed updating some tests.

**Fix:** Run `go test -v ./...` in the terminal, copy the output to Claude:

```
Here are the failing tests:
@terminal

The handlers are now using a Store interface, but some tests are still using the old concrete type. 
Can you fix the test setup?
```

### Inline diffs show too many changes at once, making review hard

**Cause:** Claude is making a large refactor in one step.

**Fix:** Ask Claude to break it into smaller steps:

```
That's a lot of changes at once. Can you break this refactor into 3-4 smaller diffs?
For example:
1. First diff: Add the Store interface to models.go
2. Second diff: Update handlers.go to use Store interface
3. Third diff: Update in-memory store to implement Store
4. Fourth diff: Update tests
```

### Claude misunderstands your architecture

**Cause:** CLAUDE.md is missing or unclear.

**Fix:** Update `CLAUDE.md` with clear architecture docs:

```markdown
## Architecture

The API follows a layered architecture:

- **handlers.go** — HTTP layer, unmarshals requests, calls business logic, marshals responses
- **models.go** — Business logic, validation, task operations
- **db.go** — Data access layer, abstracts storage (SQLite, in-memory, or mock)
- **middleware.go** — Cross-cutting concerns (logging, auth, recovery)

Handlers should NOT access the database directly. They should call methods on a Store interface.
```

Then reference CLAUDE.md in your prompt: "See CLAUDE.md for architecture. Maintain this layering."

### Performance is degrading as the project grows

**Cause:** Code structure is becoming messy, or database queries are inefficient.

**Fix:** Ask Claude to profile and optimize:

```
Run this benchmark:
go test -bench=BenchmarkGetAllTasks -benchmem -cpuprofile=cpu.prof

The memory and CPU usage are growing unexpectedly. Can you:
1. Identify the bottleneck
2. Optimize the query or the Go code
3. Re-run the benchmark to verify improvement

Use pprof if needed.
```

### Accidental breaking change was merged

**Cause:** You accepted a diff that had subtle implications.

**Fix:** Use Git to revert:

```bash
git log --oneline
git revert <commit-hash>
```

Or use Claude Code's rewind feature on the conversation.

---

## 8. References

- **Claude Code Documentation:** [docs.claude.com/en/docs/claude-code/overview](https://docs.claude.com/en/docs/claude-code/overview)
- **Go Official Documentation:** [golang.org](https://golang.org)
- **Go Standard Library:** [pkg.go.dev/std](https://pkg.go.dev/std)
- **Effective Go:** [golang.org/doc/effective_go](https://golang.org/doc/effective_go)
- **Go Code Review Comments:** [golang.org/wiki/CodeReviewComments](https://golang.org/wiki/CodeReviewComments)
- **Go Testing Best Practices:** [golang.org/doc/tutorial/add-a-test](https://golang.org/doc/tutorial/add-a-test)
- **Database/sql Package:** [pkg.go.dev/database/sql](https://pkg.go.dev/database/sql)
- **Concurrency in Go:** [golang.org/doc/effective_go#concurrency](https://golang.org/doc/effective_go#concurrency)
- **Context Package:** [pkg.go.dev/context](https://pkg.go.dev/context)
- **Docker Best Practices:** [docs.docker.com/develop/dev-best-practices](https://docs.docker.com/develop/dev-best-practices)
- **GitHub Actions for Go:** [github.com/actions/setup-go](https://github.com/actions/setup-go)

---

## 9. Summary

**Key takeaways:**

- **Prompt quality determines output quality.** Be specific: mention file names, function names, constraints, and edge cases.
- **CLAUDE.md is essential.** It communicates your project's style, architecture, conventions, and constraints to Claude.
- **Use @terminal references** to help Claude understand actual errors and failures.
- **Break big refactors into small steps.** Use checkpoints and rewind if something goes wrong.
- **Test-driven development works well with Claude.** Write tests first, then ask Claude to implement.
- **Leverage Go's strengths:** composition, interfaces, concurrency, and the standard library.
- **Build defensively:** error handling, context cancellation, recovery, and logging are essential from the start.
- **Profile and measure.** Benchmarks and pprof help Claude optimize effectively.
- **CI/CD from day one.** Automate testing, linting, and building so you catch problems early.

**Advanced next steps:**

- Add GraphQL support alongside REST
- Implement real user authentication with bcrypt and JWTs
- Add message queue support (Kafka, RabbitMQ) for async processing
- Implement caching (Redis) for hot data
- Add comprehensive observability (metrics, tracing, logging)
- Build a web UI client (React, Vue, Svelte) that consumes your API
- Deploy to Kubernetes with Helm charts
- Set up canary deployments and blue-green deployments
- Explore Go's generics (Go 1.18+) for type-safe, reusable components

---

## Related Tutorials

- [[git-worktrees-worktrunk-beginner-guide|Git Worktrees with Worktrunk]] — Manage parallel feature branches with ease
- [Claude Code Beginner Guide](./claude-code-vscode-go-beginner-guide.md) — Getting started with Claude Code and your first REST API
- [Linux Permissions Deep Dive](../Linux-Permissions/linux-permissions-deep-dive.md) — Hardening your deployed API with proper file permissions and security attributes
# Related Tutorials

- [[gh-cli-beginner-guide|GitHub CLI Beginner Guide]] — GitHub CLI for repo management
- [[gh-cli-deep-dive|GitHub CLI Deep Dive]] — scripting and automation with `gh api`
