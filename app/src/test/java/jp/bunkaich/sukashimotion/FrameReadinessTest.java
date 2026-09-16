package jp.bunkaich.sukashimotion;
import org.junit.Test;
import static org.junit.Assert.*;

public class FrameReadinessTest {
 @Test public void oldHomeWithIdenticalGeometryCannotFinishHandoff(){
  FrameReadiness r=new FrameReadiness(31);
  assertFalse(r.accept(true,"frame",8));assertFalse(r.accept(true,"frame",8));
  assertFalse(r.accept(true,"frame",31));assertTrue(r.accept(true,"frame",31));
 }
 @Test public void changingGeometryMustSettleAgain(){
  FrameReadiness r=new FrameReadiness(31);
  assertFalse(r.accept(true,"portrait",31));assertFalse(r.accept(true,"landscape",31));
  assertTrue(r.accept(true,"landscape",31));
 }
 @Test public void missingTaskIdentityNeverQualifies(){
  FrameReadiness r=new FrameReadiness(-1);
  assertFalse(r.accept(true,"frame",-1));assertFalse(r.accept(true,"frame",-1));
 }
 @Test public void unreadyObservationBreaksConsecutiveFrames(){
  FrameReadiness r=new FrameReadiness(31);
  assertFalse(r.accept(true,"frame",31));assertFalse(r.accept(false,"frame",31));
  assertFalse(r.accept(true,"frame",31));assertTrue(r.accept(true,"frame",31));
 }
}
