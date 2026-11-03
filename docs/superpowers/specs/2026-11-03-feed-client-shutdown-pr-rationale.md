# PR rationale and evidence checklist: feed-client shutdown

Status: prospective PR material. Do not paste unverified claims as results.
Design: 2026-11-03-feed-client-shutdown-design.md.

## Why a change is needed

| Reason | Current source evidence | Demonstration required |
| --- | --- | --- |
| Admission and shutdown can disagree about owned work | HttpFeedClient.send checks closed before building and enqueueing; close sets closed then awaits strategy work | Pause an admitted submit before enqueue; assert shutdown cannot report successful completion while it remains owned |
| Capacity is not complete ownership accounting | HttpRequestStrategy registers by document ID, then acquires a slot; same-ID dependents share sequencing | Saturate capacity, close/abort with a pending admission and same-ID successor; verify terminal results and exactly one slot release |
| Callers need observable, consistent cleanup outcomes | FeedClient exposes close but no separate termination observation | Concurrent closers, late observers and cleanup failures must observe one retained outcome |
| Callback waits can depend on the executing thread | Result processing uses a single-thread executor; destroy awaits executor termination | Initiate shutdown from result callback; prohibited blocking wait fails promptly, async initiation remains usable |
| Existing timeout warnings cover only reached termination waits | Strategy logs after executor awaitTermination timeout | Stall before that wait; verify phase diagnostics with controlled clock, without false success |

These are source-supported motivations, not five independently reproduced bugs.
Only retain defect claims whose original/fixed demonstrations succeed. Distinguish
new contract requirements from regressions in the existing documented API.

## Why the design takes this form

| Choice | Reason | Cost / alternative rejected | Evidence required |
| --- | --- | --- | --- |
| Monitor-based lifecycle | Atomic admission, escalation and ownership transitions with inspectable invariants | Lock contention; CAS adds proof complexity without measured need | Controlled histories, mutation sensitivity, contention/throughput measurements |
| Ownership separate from slots | Pre-capacity and same-ID work must not disappear from shutdown | Additional bookkeeping and retained memory | Saturation and dependent-chain regression; heap/slot accounting |
| One shared shutdown operation | Repeated close does not duplicate cleanup or lose prior failure | Shared state and escalation coordination | Concurrent graceful/abort, repeated close and multiple cleanup failures |
| Read-only shutdown handle | Outcome publication runs no arbitrary observer callback; no mutation/cancellation of shared outcome | New API; less direct stage composition | Blocking adapter cannot impede direct observers; timeout leaves shutdown intact |
| Caller-owned stage composition | Makes scheduler responsibility explicit; no hidden pool/thread-per-observer | Occupies worker while waiting; shared executor can starve | Rejection, direct executor guard, blocked callback and queued adapter controls |
| Known progress-thread wait guard | Avoid self-dependent blocking while preserving normal-return meaning | Callback close behavior changes; migration required | Real callback path plus completed-outcome fast path |
| Cleanup failure retained | Failed teardown must not appear successful or vanish into a log | Error aggregation and partial-cleanup reporting | Each teardown stage throws independently and in combinations |
| Independent, bounded diagnostics | A stalled result/transport thread cannot be required to diagnose itself | Monitoring overhead; logging is best-effort | Fake clock, queue saturation, blocked handler, registration/thread retention |
| Existing retry/capacity/deadline policies retained | Isolate ownership correction from unrelated policy changes | Graceful drain can be long; pre-capacity retention remains a concern | Healthy/impaired HTTP workloads, shutdown latency and retained memory |

## PR presentation at implementation completion

Lead with the smallest demonstrated failure and corrected observable behavior.
List accepted intentional API changes separately. Include original/fixed revisions,
replay commands, red/green output, fault scenarios, impact results, review findings
and remaining limits. Explain rejected alternatives using measured or source-backed
tradeoffs. Do not claim universal deadlock freedom, remote exactly-once delivery,
bounded arbitrary callback execution, guaranteed logging, or a full suite pass
from selected module tests. Include links to the curated garden evidence.

## Deterministic fault-injection matrix

Use test-owned Cluster/RequestStrategy fixtures, barriers, latches, controlled
executors and clocks. No production test toggles. Name the production mutation
that would violate each invariant before writing its test. Timeouts diagnose hangs;
they do not create a race. Always release held work and join fixture threads in
finally blocks. Never exhaust host memory, file descriptors or threads to inject
failure; reject or throw at an owned dependency boundary instead.

| Fault / negative scenario | Injection point | Required observable invariant |
| --- | --- | --- |
| Request construction throws | Existing request/clock/header supplier seam where actually invoked | Admission responsibility discharged; subsequent shutdown terminates |
| Admitted submit pauses | Between admission and strategy registration | Graceful shutdown does not pass it; abort settles/rejects it consistently |
| Capacity unavailable | Hold real slot with controlled response; submit distinct ID | No lost waiter; abort wakes it; no slot underflow/double release |
| Same-ID predecessor delayed/fails | Controlled first response with successor registered | Preserve sequence and successor ownership through close/abort |
| Dispatch paused inside transport | Cluster.dispatch barrier | Cleanup cannot close resources still inside protected dispatch |
| Transport throws or connection resets | Cluster boundary; companion local HTTP reset script | Terminal result or permitted retry; no lost ownership or duplicate cleanup |
| 429/503 retry and timeout | Controlled HTTP response and clock | Respect existing retry/deadline policy while shutdown tracks work |
| Result callback blocks/reenters | Latch inside actual returned operation future continuation | No callback under lifecycle lock; honest executor termination; wait guard enforced |
| Shutdown worker start rejected | Inject owned worker factory/start dependency | Admission remains closed; observable failure; safe cleanup attempted |
| Result executor rejects work | Controlled executor at submission boundary | No permanently orphaned operation; failure visible, teardown continues |
| Each cleanup stage throws | Transport/executor cleanup fixture, singly and combined | Attempt remaining safe stages; retain primary/suppressed errors; never claim success |
| Concurrent graceful then abort | Barrier-controlled two callers | Monotonic escalation, one shutdown outcome, each owned result terminal |
| Waiting observer interrupted/times out | Interrupt dedicated waiting thread / controlled timeout | Shared shutdown unchanged; interruption preserved by blocking-close wrapper |
| Caller adapter cancelled/rejected | Caller-owned executor and private stage | Handle and independent waiters unaffected; rejection visible |
| Caller adapter callback never returns until released | Dedicated caller executor latch | Direct handle read/wait succeeds; queued adapter limitation remains visible |
| No progress past warning threshold | Controlled monotonic clock and unchanged snapshot | Rate-limited warning identifies phase, not proven deadlock; state unaffected |
| Progress resumes after warning | Advance counters/phase, then finish | Recovery record and removal of monitoring registration |
| Logging handler blocks/throws | Test handler with latch/exception | Shutdown and monitor snapshots remain usable; no lifecycle lock held |
| Diagnostic queue saturated | Bounded queue filled with controlled consumer pause | Bounded retention, observable dropped count, no shutdown backpressure |

## Discovery, controls and impact

Use generated operation/fault histories to explore combinations beyond the table;
retain seed plus actual schedule and minimized failing history. Mutation checks
remove admission tracking, release ownership early, double-release capacity, erase
cleanup failure or accidentally couple observer cancellation to shutdown. Tests
must detect meaningful mutants; equivalent mutants need explanation.

Add real HTTP companion cases for resets, delayed responses and saturation, keeping
causal deterministic tests alongside timing-variable integration evidence. Assess
JVM memory-order stress, heap/thread/socket retention and latency/throughput impact
with the agreed per-PR applicability process. Fault injection is not a substitute
for those strategies, and no omission is approved by this document.

## Implementation evidence so far

These are incremental module results, not a completed implementation or a full
Vespa validation claim. The latest serial API/client/CLI reactor run passed 52
tests with no skipped tests. Existing JVM incubator-module warnings remain.

| Demonstrated failure | Change and reason |
| --- | --- |
| Graceful close destroyed the strategy during admitted request construction | Order admission against close and retain construction responsibility. Reproduced on the captured baseline and recorded upstream revision. |
| Mapping outlived strategy completion | Track ownership through public result publication, independently from capacity. |
| A result callback, cleanup owner, dispatcher or result-policy callback could wait on its own shutdown | Reject progress-owner waits by actual thread identity and publication context while allowing independent observation. |
| Abort could certify termination while admitted construction remained held | Start abort cleanup promptly, then retain responsibility until admitted work resolves. |
| Graceful strategy waiting ignored escalation | Make the drain wait observe the shared graceful/abort state. |
| Reset accounting needed a monitor held by executor teardown waiting | Wait for executor termination outside that monitor. |
| Concurrent destroy returned before the first caller finished cleanup | Share the strategy cleanup outcome among callers. |
| A transport-close exception left result or reset-accounting workers alive | Attempt remaining executor cleanup even when transport close throws. |
| Successful shutdown could be reported while the dispatcher still ran | Join the dispatcher after shared resource cleanup, avoiding self-join. |
| A registered capacity waiter acquired a slot after abort cleanup | Stop capacity acquisition on abort and discharge the unacquired registration. Atomic registry/slot handoffs still require further validation. |
| The inner dispatcher loop sent queued work after abort | Check abort before selecting the next queued request. |
| Public snapshots accepted contradictory outcomes and counts | Validate failure/phase consistency and ownership invariants at construction. |

Confirmation tests cover observer interruption, synchronous construction failure,
and caller cancellation without erasing underlying transport ownership. An isolated
mutation removing the internal-resolution condition from ownership pruning was
caught by the cancellation test; the original source was restored and the reactor
passed again. A second mutation permitting abort-to-graceful reversal was caught
by both the focused escalation test and generated state-machine histories. All
mutants were restored before normal verification. The generated test runs 64
fixed seeds with 100 commands each and reports the complete command/index history
on failure. This is sequential component evidence, not concurrent/JVM stress or a
mutation-score claim.

The operator approved serial verification on the saturated shared host and deferred
performance measurements. The retained impact protocol compares distinct-ID and
same-ID workloads at low and saturated load, reporting throughput, submission and
shutdown latency, allocation, and retained resources. A repeatable throughput or
p95 submission-latency regression above 5% requires operator review. No performance
acceptance conclusion has been drawn.

Still required: remaining strategy handoffs and cleanup-failure combinations,
independent bounded diagnostics, broader generated/mutation and resource evidence,
full-project validation, final independent review, and garden evidence curation.
