package jp.bunkaich.sukashimotion;
import org.junit.Test;
import static org.junit.Assert.*;

public class HandoffQueueTest {
 @Test public void reversalWaitsForAppToReachDestination(){
  HandoffQueue q=new HandoffQueue();assertTrue(q.request(true));
  assertFalse(q.request(false));assertEquals(Boolean.FALSE,q.complete());
  assertTrue(q.request(false));assertNull(q.complete());
 }
 @Test public void rapidBackAndForthKeepsLatestDirection(){
  HandoffQueue q=new HandoffQueue();assertTrue(q.request(true));
  assertFalse(q.request(false));assertFalse(q.request(true));assertNull(q.complete());
 }
 @Test public void lastReversalWinsWithoutIssuingThreeTransfers(){
  HandoffQueue q=new HandoffQueue();assertTrue(q.request(false));
  assertFalse(q.request(true));assertFalse(q.request(false));assertFalse(q.request(true));
  assertEquals(Boolean.TRUE,q.complete());
 }
 @Test public void cancellationDoesNotReplayQueuedTransfer(){
  HandoffQueue q=new HandoffQueue();q.request(true);q.request(false);q.reset();
  assertTrue(q.request(true));assertNull(q.complete());
 }
}
