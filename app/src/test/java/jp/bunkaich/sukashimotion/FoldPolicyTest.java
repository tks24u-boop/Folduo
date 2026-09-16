package jp.bunkaich.sukashimotion;
import org.junit.Test;
import static org.junit.Assert.*;
import static jp.bunkaich.sukashimotion.FoldPolicy.Change.*;
public class FoldPolicyTest {
 @Test public void oppositeEndpointCannotReuseDwellTime(){
  FoldPolicy p=new FoldPolicy(false);p.update(20,0);p.update(180,10);
  assertEquals(CLOSE,p.update(0,140));assertTrue(p.active);
  assertEquals(NONE,p.update(0,200));assertEquals(FINISH_CLOSED,p.update(0,260));
 }
 @Test public void duplicateMeasurementTimeDoesNotCompleteFold(){
  FoldPolicy p=new FoldPolicy(false);p.update(20,0);p.update(180,10);
  for(int i=0;i<100;i++)assertEquals(NONE,p.update(180,10));assertTrue(p.active);
 }
 @Test public void openingAndEndpointDwell(){FoldPolicy p=new FoldPolicy(false);assertEquals(NONE,p.update(0,0));assertEquals(OPEN,p.update(7,10));assertEquals(NONE,p.update(90,20));assertEquals(NONE,p.update(179,30));assertEquals(NONE,p.update(180,130));assertEquals(FINISH_OPEN,p.update(180,150));assertFalse(p.active);}
 @Test public void closingAndEndpointDwell(){FoldPolicy p=new FoldPolicy(true);assertEquals(CLOSE,p.update(172,0));assertEquals(NONE,p.update(0,40));assertEquals(FINISH_CLOSED,p.update(0,160));}
 @Test public void jitterNeverReverses(){FoldPolicy p=new FoldPolicy(false);p.update(20,0);for(int i=0;i<10;i++){assertEquals(NONE,p.update(25,10));assertEquals(NONE,p.update(18,20));}assertTrue(p.open);}
 @Test public void reversalUsesHysteresisInBothDirections(){FoldPolicy p=new FoldPolicy(false);p.update(20,0);p.update(100,10);assertEquals(CLOSE,p.update(85,20));p.update(60,30);assertEquals(OPEN,p.update(75,40));}
 @Test public void invalidSamplesCannotStartMotion(){FoldPolicy p=new FoldPolicy(false);for(float value:new float[]{Float.NaN,Float.POSITIVE_INFINITY,-1,181})assertEquals(NONE,p.update(value,0));assertFalse(p.active);}
 @Test public void skippedMotionDoesNotInventAnimation(){FoldPolicy p=new FoldPolicy(false);assertEquals(NONE,p.update(180,0));assertTrue(p.open);assertFalse(p.active);assertEquals(CLOSE,p.update(160,10));}
 @Test public void leavingEndpointResetsDwell(){FoldPolicy p=new FoldPolicy(false);p.update(30,0);p.update(180,10);p.update(170,100);p.update(180,120);assertEquals(NONE,p.update(180,200));assertEquals(FINISH_OPEN,p.update(180,240));}
 @Test public void equalFrameTimeHasEqualSmoothing(){float a=0,b=0;for(int i=0;i<80;i++)a=FoldPolicy.smooth(a,120,1/80f);for(int i=0;i<120;i++)b=FoldPolicy.smooth(b,120,1/120f);assertEquals(a,b,.001f);}
 @Test public void smoothHasNoOvershoot(){float value=0;for(int i=0;i<100;i++){float next=FoldPolicy.smooth(value,35,.0125f);assertTrue(next>=value);assertTrue(next<=35);value=next;}assertEquals(35,value,.001f);}
 @Test public void blurGrowsInOppositeDirections(){assertEquals(0,FoldPolicy.blur(180,true),0);assertEquals(1,FoldPolicy.blur(90,true),0);assertEquals(0,FoldPolicy.blur(0,false),0);assertEquals(1,FoldPolicy.blur(90,false),0);assertTrue(FoldPolicy.blur(150,true)<FoldPolicy.blur(120,true));}
 @Test public void equalHingeTravelHasEqualBlurChange(){
  for(boolean inner:new boolean[]{false,true}){
   float delta=FoldPolicy.blur(46,inner)-FoldPolicy.blur(45,inner);
   if(inner)delta=FoldPolicy.blur(136,true)-FoldPolicy.blur(135,true);
   for(float angle=inner?90:2;angle<(inner?175:89);angle+=.5f)
    assertEquals("No accelerated section at "+angle+" inner="+inner,delta*.5f,FoldPolicy.blur(angle+.5f,inner)-FoldPolicy.blur(angle,inner),.000002f);
  }
 }
 @Test public void blurHasNoStepAtVisibleEndpoints(){
  for(boolean inner:new boolean[]{false,true})for(float edge:inner?new float[]{90,176}:new float[]{1.5f,90})
   assertTrue(Math.abs(FoldPolicy.blur(edge+.001f,inner)-FoldPolicy.blur(edge-.001f,inner))<.00003f);
 }
}
