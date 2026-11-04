# Vespa feed-client shutdown: failure modes and changes

This document accompanies the Java feed-client shutdown contribution. It describes the implementation through `f96c9e24790`, compared with baseline `a6384ff4a54`. The affected code is `HttpFeedClient`, `HttpRequestStrategy`, the new `ShutdownLifecycle`, and the public `ShutdownHandle` API.

The client now tracks accepted operations from request construction through public result publication. Callers share one shutdown outcome, can escalate a graceful close to abort, and can observe completion without owning cleanup. The table below covers the changed paths and new API controls. Some handoff races and resource-release issues remain open; they are listed at the end.

## Why the PR is needed

A request can belong to the client before it has a strategy slot. It can also remain unfinished after its transport response arrives. Closing based only on strategy counters misses those intervals. Separately, starting cleanup is different from finishing it: concurrent callers need the same retained outcome, and a throwing transport must not skip the remaining worker cleanup.

## Design decisions

| Choice | Why | Tradeoff |
| --- | --- | --- |
| One monitor for admission and lifecycle transitions | Admission and shutdown agree on which work the client owns | Adds bookkeeping and synchronization; impact measurements are pending |
| Track operations separately from strategy slots | Construction, result mapping and cancelled public results remain accounted for | Operations remain retained until their internal work resolves |
| Reuse existing retry, throttling and per-document sequencing | Keep this change focused on ownership and shutdown | Existing policy and handoff limitations still need integration testing |
| One cleanup worker and shared outcome | Repeated callers do not start cleanup twice or lose its failure | Worker-start failure handling is still unfinished |
| A read-only shutdown handle | Waiting, timing out or being interrupted does not cancel shared shutdown | Existing callback code that blocks in close must use closeAsync and wait elsewhere |
| Identify known progress threads | Prevent a thread from waiting for shutdown that needs that thread | This does not detect arbitrary user dependency cycles |
| Use finally for remaining cleanup | One transport failure must not skip executor shutdown | FAILED records an unsuccessful cleanup, not complete resource release |

## Reading the examples and tests

Snippets are shortened Java excerpts or API examples. Comments omit surrounding code; they are not standalone programs. Each case links to the test source and names the relevant methods. Latches and controlled dependencies force the important ordering. Timeouts bound waits and detect hangs; timing-sensitive checks still need reruns on the maintainer’s environment.

The implementation record reports 52 passing API/client/CLI module tests and two detected mutations: dropping internal-resolution ownership, and allowing abort to revert to graceful drain. The generated lifecycle test uses 64 fixed seeds with 100 commands each and prints the history on failure. Those are recorded component results, not new executions for this documentation update or a full Vespa validation result.

## Failure-mode table
