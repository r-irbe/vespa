# Feed-client shutdown ownership and observable completion

Status: design for operator approval; no implementation authorized by this document alone.

## Intent and accepted decisions

Fix Candidate 18 in an isolated Vespa worktree. The operator selected atomic
admission with continuous ownership and a shared observable shutdown operation,
then selected a monitor-based lifecycle coordinator. Candidate 24 parsing follows
later. Preserve the other session's checkout and do not copy its uncommitted fix.
The research and decision history are retained in garden PR #1:
https://github.com/r-irbe/vespa-bjoergvin/pull/1

Success means a controlled before/after regression, terminal outcomes for admitted
work, honest cleanup completion, and measured impact. Passing documentation or
model tests alone is not an integrated-client correctness claim.

## Approaches

1. Selected: monitor-based lifecycle coordinator. Atomic state transitions and
   ownership bookkeeping fit the existing synchronous admission path. Effects
   run outside locks. Measure contention and retention.
2. Dedicated lifecycle command executor: clearer serialized command ordering,
   but executor rejection and queued ownership introduce additional failure modes.
3. CAS state/reference counts: potentially less lock contention, but more difficult
   escalation and cleanup proofs without evidence that monitor cost is excessive.

A cleanup worker may execute blocking teardown; it is not a command queue that
serializes every feed operation. The monitor remains the lifecycle authority.

## Scope and constraints

Touch feed-client API, implementation, tests, and directly affected client callers
or test implementations. Preserve existing retry, request deadline and throttling
policy in this PR; introduce no new queue bound or automatic deadline-to-abort
policy. Measure pre-capacity retention rather than claiming it is bounded.
No remote exactly-once guarantee. No arbitrary application deadlock prevention.
No hook, compiler, test, or approval bypass. Keep portable paths and native Maven
verification. Source refresh may change the baseline; pin revisions per experiment.

## Public API proposal (builder call, not separately accepted yet)

Propose default `ShutdownHandle closeAsync(boolean graceful)` and
`ShutdownHandle termination()` methods on FeedClient. Existing implementors retain
compatibility through documented UnsupportedOperationException defaults; the built-in
HttpFeedClient implements them. Java 11 is the client compatibility target.

ShutdownHandle is a read-only interface, not CompletableFuture or CompletionStage.
It provides an immutable snapshot of phase, terminal outcome/failure and outstanding
ownership counts, plus interruptible await() and await(Duration). A successful await
means successful termination; failure propagates the recorded cleanup cause; timeout
throws TimeoutException and changes no lifecycle state. There is no cancel, complete,
obtrude, callback-registration or executor-submission method on the handle.
Repeated requests return the same logical lifecycle observation. termination() does
not initiate shutdown. Publishing terminal state wakes all waiters under the monitor;
waiters read the state independently, without running user continuations there.
Known progress-thread waits fail fast if they would need to wait.

Optional asynchronous composition is caller-owned: documentation shows submitting a
handle wait to an explicitly supplied application executor and completing a private
stage there. This is an example, not a built-in adapter or notification service in
this PR. It consumes a worker while waiting, can queue behind other application work,
and can run inline with a direct executor; the handle's wait guard still applies.
Cancelling the adapter never cancels shutdown. Rejection is visible to the submitter.
No guarantee is made that adapters sharing a blocked executor will progress.
The authoritative handle remains readable independently. A future built-in adapter
requires its own bounded resource, cancellation and rejection contract.

This replaces the earlier CompletionStage API proposal, not the accepted ownership
or outcome-isolation contracts. Additional API surface is the explicit cost of
separating observation from arbitrary user execution.

close(boolean) requests shutdown and awaits the same outcome. A normal return
means successful termination. On a known thread needed for progress, initiate
shutdown, then throw IllegalStateException if waiting is needed. If termination
already completed, return or report its failure immediately. Document migration
from callback close to nonblocking closeAsync. Never silently return early.

A blocking caller's interruption ends its wait, restores interrupt status and
throws a FeedException retaining the cause; shared shutdown continues. Explicit
closeAsync(false) escalates graceful draining to abort. No observer timeout does so.
Cleanup failures are retained, with subsequent failures suppressed in stable
cleanup-stage order. Repeated callers see the same underlying outcome, though
exception wrappers may differ. Feed operation failures remain on their results.

## State, ownership and handoffs

Under a lifecycle monitor: OPEN -> DRAINING or ABORTING; DRAINING -> ABORTING;
finally a terminal shutdown outcome, successful or failed. Failure does not assert
resource release. Publish the outcome only after all feasible teardown stages
have been attempted and outstanding resource obligations are accounted for.

Admission creates responsibility before request construction and strategy entry.
Track pre-registration admission, registered operation results, and protected
transport dispatch separately from throttling slots. Release on synchronous
construction failure or on terminal public outcome, without an untracked gap.
Close and admit are ordered by the same gate; invocation order alone is insufficient.

Strategy registration, same-document chain replacement, slot acquisition/release,
retry offers and destruction must form a consistent handoff protocol. Each acquired
slot releases once; dependents remain owned even when sharing a slot. Abort wakes
capacity waiters, rejects subsequent offers, settles pending results, and prevents
new dispatch after teardown commits. Dispatch already entering the transport is
accounted for until its protected call exits. Do not close resources still in use.

One shutdown owner runs teardown; concurrent callers only observe or request
escalation. Never invoke transport code, user callbacks or future completion under
the lifecycle monitor. Acquire no client/strategy locks in opposite orders.
Use explicit effects collected under locks and performed outside them.

Graceful shutdown waits for admitted work, including pending admissions and public
result publication; then closes owned transport/executors. Abort stops new work,
settles owned operations and performs teardown. Result/dispatch-thread detection
must cover inline completion paths and reentrancy, not thread-name guesses.

## Publication and progress boundary

A public future becoming terminal differs from its completion call returning:
inline user continuations may still be running. Ownership tracking must not rely
solely on a continuation that runs after arbitrary user callbacks. Define and test
this boundary explicitly. Public result terminality is required; completion of
arbitrary user-spawned tasks is not.

No shutdown observer callbacks execute inside the client: the handle supports only
reading and waiting. Publish terminal state and signal waiters without invoking
caller code. Optional caller-owned adapters may run callbacks on their own execution
resources; those are not client-owned cleanup obligations. Existing feed-result
callbacks retain their scheduling semantics and may still delay owned executor exit.

Blocking arbitrary user code on a client-owned executor can delay that executor's
termination. Do not label it cleaned up while it is running, or promise bounded
termination for uncooperative callbacks/transport code. A notification executor's
ownership and lifecycle must be specified before adding it; no hidden immortal
executor or unbounded thread-per-observer workaround.

Worker creation/start failure must close admission, retain an observable failure,
and attempt safe cleanup without blocking a progress thread. Unsupported startup
or resource-exhaustion paths must never leave a success-looking pending handle.

## Stall diagnostics proposal

Warnings diagnose prolonged shutdown, not proven deadlock. Register monitoring only
while shutdown is active; deregister at terminal outcome. Publish a volatile immutable
progress snapshot, so monitoring does not acquire potentially stalled lifecycle locks.
Track phase, phase age, last meaningful progress, pending admissions, unsettled results,
active dispatch calls and owned executor termination. Instrument public-result
completion entry/exit to identify a completion call that has not returned, without
claiming the user callback is necessarily its cause. No request bodies, IDs or secrets.

Proposed builder calls: a configurable positive stall-warning threshold, initially
30 seconds; at most one warning per threshold interval per client; one recovery
record after a previously reported stall clears. These are diagnostics only: they
do not abort, change deadlines or release ownership. Status remains queryable even
when the logger is disabled or fails.

Use one shared daemon monitoring service with registrations proportional to active
shutdowns, not a new monitoring thread per operation/observer. Remove registrations
on terminal success/failure; stop the monitoring scheduler when no registrations
remain and allow safe restart. The logging worker has a separate lifetime: at most
one shared daemon logger worker may be alive, including a worker stuck inside an
application logging handler. Never replace that worker while it is alive. When idle
and not blocked, it may exit; restart must atomically preserve the one-worker bound.
Clear queued per-client records at deregistration; an executing blocked handler may
retain its one immutable diagnostic record. This shared diagnostic infrastructure
is excluded from individual-client termination obligations; owned transport/result
threads are not. Expose logging backlog/drops in diagnostic status, and document
that one blocked handler can suppress subsequent logs without blocking shutdown. Schedule checks independently of result/transport executors. Send
bounded diagnostic records to a separate bounded logging queue; when full, retain
an observable dropped-record count rather than blocking shutdown or spawning threads.
A blocked logging handler may stall that logging worker: logs are best-effort,
never a guarantee under resource exhaustion or broken logging. Do not shut down
application-owned logging facilities. Test service lifecycle and retained registrations.
This bounds service threads/queue, not the number of simultaneous closing clients.

Only owned shutdown work is instrumented. Arbitrary tasks on application executors
are outside this logging scope; caller-owned adapter queue/callback timing can be
instrumented by the caller. The PR must not claim every blocked callback is logged.

## Bounded mechanism exploration

A throwaway Java probe compiled with --release 11 and executed on JDK 26.0.1
showed (1) a future and copied view can be terminal while an inline callback holds
up the completing call, and (2) a monitor-based handle can be read/awaited while
an adapter callback blocks a caller-owned single-thread executor. The same probe
confirmed a queued task on that executor remained delayed. Latches controlled the
schedule; five-second waits only diagnosed stalls; threads were released and joined.
This is mechanism feasibility, not Java 11 runtime validation, a Vespa regression,
a performance claim or a diagnostic-monitor implementation. The probe remains
throwaway and is not production implementation to adapt.

## Validation and TDD

Read writing-good-tests.md before test changes. Each production behavior follows
an observed assertion failure, minimal correction and green verification. Start
with a controlled check-to-registration race using existing construction seams;
keep test-only scheduling mechanisms in tests. Build errors are not red evidence.

Required causal cases: admitted construction pause, registration/capacity wait,
same-ID chaining and tail replacement, dispatch/abort race, result publication,
callback initiation and prohibited wait, concurrent closers, escalation, late
observers, handle timeout and adapter cancellation isolation, interrupted blocking wait,
transport/cleanup failures and adapter/executor rejection. Also use controlled clocks
for threshold, rate limiting and recovery diagnostics; block logging handlers, saturate
the diagnostic queue, and verify monitoring cleanup and dropped-record visibility.

Retain exact original and corrected revisions, commands, environment, logs,
seeds, minimized histories and controlled schedules. Test against captured local
and recorded current upstream; fix verification targets the proposed PR base.

Assess all strategies: deterministic regression; generated state-machine/property
histories; sequence/input fuzzing; meaningful isolated mutants; replayable fault
injection; real HTTP/reset/saturation companion; JVM memory-order stress; retained
heap/thread/socket analysis; throughput/admission/shutdown latency comparisons.
No omissions or applicable evidence carry-forward without operator approval.
Fix workload metrics, comparison limits and stopping budgets before interpreting
impact. Budget exhaustion or missing environment is not success or not-applicable.

Run native module suites and affected API/CLI integration tests, then the project's
normal test command. Report every failure by name, including pre-existing ones;
no full-project pass claim from selected modules. A whole Vespa build may require
platform dependencies; retain blocked evidence and consult the operator if repair
cannot complete.

## Review and gardening

A fresh builder checks this design before operator approval. After approval invoke
writing-plans. Implementation receives a separate read-only review-agent review
of the complete merge-base diff, using review-lenses for ownership, atomicity,
compatibility, failure containment and evidence scope. Review findings require
code-backed scenarios; accepted behavior changes are not accidental regressions.
Fix actionable defects with failing tests and repeat the affected validation.

Update the garden with design/plan links, observed red/green evidence, impact,
review findings and unresolved limitations. Keep research acceptance distinct
from runtime verification and maturity promotion. No automatic deployment.

## Builder discretion

Internal class names, counter versus registry representation, test fixture layout,
cleanup worker mechanics and precise exception messages may be chosen to meet the
contract. Do not silently expand the public API, change callback scheduling for
feed results, alter capacity/deadline policy, or weaken successful termination.
If the public API proposal or publication/progress contract cannot compose with
existing consumers, return the concrete conflict before implementation.
