
## What this branch does not finish

| Open item | Why it matters | Next check |
| --- | --- | --- |
| Idle reset leaves the old delegate open | No later completion may arrive to close it | Add old-generation retirement and a before/after resource test |
| Late completion after callback-executor shutdown | Rejected accounting can leave old resources open | Test an ordered late completion with real transport cleanup |
| Atomic registry, capacity and queue handoffs | Abort checks and subsequent actions are separate | Force abort between check and action, including same-ID successors |
| Shutdown worker cannot start | Admission may close without a worker publishing an outcome | Inject thread-start failure and retain an observable failure |
| Executor timeout or interruption | Current paths can warn and continue without confirming worker exit | Hold a worker through the timeout and check the claimed terminal state |
| Independent stall diagnostics | Early stalls may never reach the existing termination warning | Add bounded diagnostics with controlled time and a blocked logging handler |
| Delegate visibility and wider cleanup combinations | Source inspection leaves concurrency and resource questions | Check stats/reset callers, rejection, partial close and multiple failures |

The separate source experiments reproduced the idle-reset and late-callback resource failures. They are follow-up defects, not fixes supplied by this branch. The full Jetty integration environment is unavailable here, and GitHub Actions is blocked by billing. A Vespa maintainer needs to run the before/after cases with the real transport and check worker, socket and file retention.

Performance measurements remain deferred. The agreed comparison uses distinct-ID and same-ID workloads at low and saturated load, reporting throughput, submission/shutdown latency, allocation and retained resources. A repeatable throughput or p95 submission-latency regression above 5% needs review. No performance acceptance is claimed.

## Review and rerun

Run the affected Maven reactor with the repository’s supported JDK and normal checks:

```sh
mvn -pl vespa-feed-client-api,vespa-feed-client,vespa-feed-client-cli -am test
```

For individual ordering tests, use the method names beside each case. Keep the baseline failure, changed-version result and environment together. Extend the held-dependency cases with real HTTP delays, connection resets, same-ID chains and combined cleanup failures before treating this as ready for production.

The [diagram instructions](shutdown-diagrams/README.md) reproduce the compact PNGs from their p5.js source.
