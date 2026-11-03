# Feed-client Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admitted feed operations continuous ownership and callers an honest, independently observable shutdown outcome.

**Architecture:** Extend the existing client and strategy with a monitor-based lifecycle. Reuse retry, per-document sequencing, throttling, request deadlines and transport cleanup. A read-only shutdown handle observes state without executing callbacks; independent bounded diagnostics report prolonged phases.

**Tech Stack:** Java 11-compatible client API/implementation, existing Maven/JUnit/Mockito infrastructure, java.util.logging.

**Spec:** `docs/superpowers/specs/2026-11-03-feed-client-shutdown-design.md`
**Rationale and fault matrix:** `docs/superpowers/specs/2026-11-03-feed-client-shutdown-pr-rationale.md`

## Global Constraints

- User approved monitor-based coordinator and exploration of read-only handle; proceed authorizes the revised design on 2026-11-03.
- No hook, compiler, test, or approval bypass.
- No new queue bound or automatic deadline-to-abort policy.
- No remote exactly-once guarantee. No arbitrary application deadlock prevention.
- Preserve the other session's checkout and do not copy its uncommitted fix.
- Every behavior change requires an observed assertion failure before production changes.
- No testing-method omission or applicable evidence carry-forward without operator approval.
- Logs are best-effort; diagnostic threshold initially 30 seconds, configurable and positive.
- One shared diagnostic logging worker at most, even while a handler is stuck; no replacement until it exits.
- Independent reviewer uses review-agent and review-lenses after implementation.

## Review Focus

- A result becomes terminal before its completion call returns: task 3 tests blocked inline callbacks and resource ownership separately.
- A reused transport waits for tasks needing its monitor: task 3 tests close against queued reset-accounting callbacks.
- Multiple cleanup failures: task 3 tests remaining stages execute and all failures remain observable.
- Interrupted or saturated application adapters: task 2 tests handle isolation; adapters remain documented caller-owned examples.
- Diagnostics outlive their last client: task 4 tests unregister/restart with a blocked handler and bounded worker count.

## File responsibilities and reuse

- `vespa-feed-client-api/.../FeedClient.java`: additive lifecycle entry points with documented unsupported defaults for external implementations.
- New `vespa-feed-client-api/src/main/java/ai/vespa/feed/client/ShutdownHandle.java`: read-only phase/outcome snapshots and waits; no mutation or callback API.
- New `vespa-feed-client/src/main/java/ai/vespa/feed/client/impl/ShutdownLifecycle.java`: domain transitions, ownership registry and immutable outcome publication; no transport policy.
- `HttpFeedClient.java`: admission and public result ownership; close delegates to the single lifecycle.
- `RequestStrategy.java`, `HttpRequestStrategy.java`: strategy-owned chain, slot and dispatch handoffs; retain existing retry decisions and RetriableFuture.
- `JettyCluster.java`, `BenchmarkingCluster.java`: modify only if teardown tests show missing cleanup/error propagation; reuse existing aggregation.
- New `ShutdownDiagnostics.java`: shared monitoring and bounded logging delivery; existing java.util.logging sink and clock abstraction.
- `FeedClientBuilder.java`, `FeedClientBuilderImpl.java`: positive diagnostic interval configuration, default 30 seconds.
- Matching tests under existing API/implementation test directories; fixture-only helpers stay in test sources.

## Task 1: Pin baseline and reproduce admission/close ordering

- [ ] Record local baseline `a6384ff4a547a1cef245c6a0dbb81a942d70504f`, recorded current upstream and proposed PR base; preserve experiment revisions.
- [ ] Repair native build prerequisites using repository instructions: generated `dist/vtag.map` is currently absent. Do not fabricate release metadata or skip generators/checks.
- [ ] Run `mvn -pl vespa-feed-client-api,vespa-feed-client,vespa-feed-client-cli -am test`; retain complete log and test counts before edits.
- [ ] In `HttpFeedClientTest`, add `gracefulCloseWaitsForAdmittedConstruction`: use the injected clock to hold request construction after admission while a close thread runs; assert close cannot complete before the admitted operation reaches a terminal result. Release all barriers and join threads in finally.
- [ ] Establish deterministic control points from existing seams; do not treat a short sleep/noncompletion observation as proof of ordering. Add a controlled strategy fixture only where needed to observe actual lifecycle calls.
- [ ] Run the regression with the owning module suite and observe the expected premature-close assertion failure, not compilation/setup failure.
- [ ] Retain test and RED evidence before task 2 production changes.

## Task 2: Domain lifecycle and read-only observation

**Interfaces:** FeedClient gains `ShutdownHandle closeAsync(boolean graceful)` and `ShutdownHandle termination()`. ShutdownHandle exposes `Snapshot snapshot()`, `void await() throws InterruptedException`, and `void await(Duration timeout) throws InterruptedException, TimeoutException`. Snapshot exposes Phase (OPEN, DRAINING, ABORTING, TERMINATED, FAILED), optional failure and ownership counts. Cleanup failure from await uses FeedException with retained cause; direct await follows normal InterruptedException semantics.

- [ ] Add behavior tests for graceful/abort monotonicity, late observation, timeout isolation, independent waiters and retained cleanup failure. New API may need declaration-only scaffolding to compile; no behavior body before an observed assertion failure.
- [ ] Add a test that fails when a blocked caller-owned stage callback prevents a direct handle waiter observing published termination; keep executor and stage in test code.
- [ ] Implement the minimal ShutdownHandle and ShutdownLifecycle behaviors for those tests; immutable snapshots prevent invalid phase/outcome combinations.
- [ ] Add admission registration/discharge to HttpFeedClient and make task 1 regression pass. Reuse request mapping and deadline policy.
- [ ] Test synchronous construction failure discharges ownership; caller mutation/cancellation of an operation future must not erase internal transport responsibility.
- [ ] Run owning API/implementation/CLI suites; commit only tested behavior with RED/GREEN logs referenced in work record.

## Task 3: Strategy handoffs, teardown and callback safety

**Interfaces:** Existing enqueue, await and destroy contracts remain strategy-owned. Internal signatures may be extended for a progress-thread query and nonblocking abort request only where tests require them; no second retry or throttling abstraction.

- [ ] Write separate failing tests in HttpRequestStrategyTest for blocked capacity, same-ID predecessor/successor, dispatch held inside Cluster, retry during abort, and duplicate slot release.
- [ ] Repair handoffs with one ownership protocol; hold monitors only for state changes, collect effects then execute outside locks.
- [ ] Write failing tests for close from result and dispatcher contexts: initiate shutdown, reject only a wait that requires progress from that context, allow already-terminal observation.
- [ ] Separate requesting abort from waiting for worker teardown so escalation can release graceful waiters without self-joining.
- [ ] Write failing tests for ResettableCluster close with queued monitor-dependent accounting; repair lock ordering without changing transport reset policy.
- [ ] Inject failures into each cleanup stage and combinations; verify remaining safe cleanup attempts and stable suppressed-error aggregation.
- [ ] Verify worker creation/rejection is observable and never leaves a success-looking pending outcome; retain best-effort cleanup limits explicitly.
- [ ] Run all owning suites and commit; no claim of full Vespa validation from these module runs.

## Task 4: Independent bounded diagnostics

**Interfaces:** Builder `setShutdownWarningInterval(Duration)` requires positive duration; default 30 seconds. ShutdownDiagnostics consumes immutable snapshots and monotonic time, produces rate-limited java.util.logging records and queryable dropped-record count. Registration ends at terminal outcome.

- [ ] Write failing fake-clock tests at just-before, exactly-at and after threshold; assert warning describes stalled phase, rate limiting and recovery rather than exact message text.
- [ ] Implement threshold decisions independently of scheduling/logging effects; reuse LongSupplier clock convention.
- [ ] Inject blocked/throwing logging handlers and full queue; assert shutdown publication stays usable, retention bounded and dropped count observable.
- [ ] Test last-client unregister and new registration while old handler is blocked: monitoring restarts, logging worker is not duplicated, queued old-client records cleared.
- [ ] Implement shared scheduler/logger lifecycle and small bounded queue; choose and document queue capacity in implementation rationale before impact tests.
- [ ] Test repeated client construction/shutdown releases registrations; run suites and commit.

## Task 5: Fault exploration and impact evidence

- [ ] Execute every applicable row of the rationale document's 20-scenario matrix; each production fix has its own RED/GREEN cycle.
- [ ] Generate state-machine operation/fault sequences; record seed plus schedule and minimized histories, not seed-only reproducibility claims.
- [ ] Execute isolated meaningful mutants: lost admission, early ownership release, double slot release, erased failure and coupled observer cancellation. Restore every mutant before normal verification.
- [ ] Add a real local HTTP companion for delayed/reset connections, retry and saturation; preserve deterministic causal regressions alongside it.
- [ ] Assess JVM memory-order testing, heap/thread/socket retention and performance with explicit method applicability; seek operator decision for any omission or unavailable environment.
- [ ] Before benchmarking agree workloads, sample budgets and acceptance bounds for throughput, submission/shutdown latency, allocation and retained resources; do not invent passing thresholds after measurement.
- [ ] Run normal project `mvn test` plus native owning suites; repair failures/dependencies, report all failures by name and any blocked coverage honestly.

## Task 6: Review, rationale and garden

- [ ] Invoke fresh read-only review-agent on the complete merge-base diff, applying review-lenses for ownership, compatibility, atomicity, failure containment and evidence scope.
- [ ] Address actionable defects with failing tests before corrections and appropriate suite reruns; preserve review findings and dispositions.
- [ ] Rewrite PR rationale around actual final behavior: demonstrated original failure, corrected result, intentional compatibility changes, measured cost and limitations.
- [ ] Curate evidence and links in the isolated garden branch/PR without promoting unverified claims or deploying the site.
- [ ] Verify clean diff, preserved checks and portable files; prepare the implementation PR only after required evidence obligations are met or explicit operator dispositions recorded.

## Execution and remaining operator decisions

Recommended execution is native in this session with a fresh whole-branch reviewer:
these tasks share lifecycle/strategy interfaces, so serial ownership reduces churn.
The previously accepted test-omission and benchmark-acceptance decisions remain
operator-owned; this plan does not grant permission to drop checks or select
acceptance thresholds after seeing results.
