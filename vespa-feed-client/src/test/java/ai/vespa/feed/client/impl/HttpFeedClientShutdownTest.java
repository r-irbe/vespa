// Copyright Vespa.ai. Licensed under the terms of the Apache 2.0 license. See LICENSE in the project root.
package ai.vespa.feed.client.impl;

import ai.vespa.feed.client.DocumentId;
import ai.vespa.feed.client.FeedClient;
import ai.vespa.feed.client.HttpResponse;
import ai.vespa.feed.client.OperationParameters;
import ai.vespa.feed.client.OperationStats;
import ai.vespa.feed.client.Result;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpFeedClientShutdownTest {
    @Test
    void gracefulCloseWaitsForAdmittedConstruction() throws Exception {
        // Removing admission ownership must permit close to destroy the strategy too early.
        CountDownLatch constructing = new CountDownLatch(1);
        CountDownLatch resumeConstruction = new CountDownLatch(1);
        AtomicReference<Thread> submittingThread = new AtomicReference<>();
        AtomicBoolean pause = new AtomicBoolean(true);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        ImmediateStrategy strategy = new ImmediateStrategy();
        FeedClientBuilderImpl builder = new FeedClientBuilderImpl(List.of(URI.create("https://dummy:123")))
                .setNanoClock(() -> {
                    if (Thread.currentThread() == submittingThread.get() && pause.compareAndSet(true, false)) {
                        constructing.countDown();
                        await(resumeConstruction);
                    }
                    return 0;
                });
        FeedClient client = new HttpFeedClient(builder, DryrunCluster::new, strategy);
        AtomicReference<CompletableFuture<Result>> result = new AtomicReference<>();
        Thread sender = new Thread(() -> {
            submittingThread.set(Thread.currentThread());
            try { result.set(client.remove(DocumentId.of("ns", "type", "1"), OperationParameters.empty())); }
            catch (Throwable t) { failure.set(t); }
        });
        Thread closer = new Thread(() -> {
            try { client.close(); }
            catch (Throwable t) { failure.set(t); }
        });
        boolean destroyedBeforeAdmissionFinished;
        sender.start();
        try {
            assertTrue(constructing.await(10, TimeUnit.SECONDS), "submission reached construction");
            closer.start();
            // The fixture never blocks close itself. Wait for close either to finish (the bug)
            // or to suspend waiting for client-owned work. The clock latch creates the race;
            // this bound only detects a broken fixture or a stalled test process.
            long limit = System.nanoTime() + Duration.ofSeconds(10).toNanos();
            while (closer.isAlive() && closer.getState() != Thread.State.WAITING &&
                   closer.getState() != Thread.State.TIMED_WAITING && System.nanoTime() < limit)
                Thread.yield();
            assertTrue(!closer.isAlive() || closer.getState() == Thread.State.WAITING ||
                       closer.getState() == Thread.State.TIMED_WAITING, "close reached a stable wait or returned");
            destroyedBeforeAdmissionFinished = strategy.destroyed.get();
        } finally {
            resumeConstruction.countDown();
            sender.join(10000);
            if (closer.getState() != Thread.State.NEW) closer.join(10000);
        }
        assertFalse(sender.isAlive(), "sender stopped");
        assertFalse(closer.isAlive(), "closer stopped");
        assertFalse(destroyedBeforeAdmissionFinished, "graceful close destroyed strategy before admitted construction finished");
        assertNull(failure.get());
        assertEquals(Result.Type.success, result.get().get(10, TimeUnit.SECONDS).type());
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) throw new AssertionError("construction was not released");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    private static class ImmediateStrategy implements RequestStrategy {
        private final AtomicBoolean destroyed = new AtomicBoolean();
        @Override public void await() { }
        @Override public void destroy() { destroyed.set(true); }
        @Override public OperationStats stats() { throw new UnsupportedOperationException(); }
        @Override public void resetStats() { }
        @Override public FeedClient.CircuitBreaker.State circuitBreakerState() { return FeedClient.CircuitBreaker.State.CLOSED; }
        @Override public CompletableFuture<HttpResponse> enqueue(DocumentId id, HttpRequest request) {
            if (destroyed.get()) return CompletableFuture.failedFuture(new IllegalStateException("strategy destroyed"));
            return CompletableFuture.completedFuture(HttpResponse.of(200, "{\"message\":\"accepted\"}".getBytes(UTF_8)));
        }
    }
}
