package jp.bunkaich.sukashimotion;

import android.app.Activity;
import android.content.*;
import android.os.*;
import android.view.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** The blocked fake binder reproduces slow thumbnail/recents replies without a phone. */
public class NavigationResponseTest {
    final android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    Activity activity;MotionService service;InnerNavigation nav;
    final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),home=new CountDownLatch(1);
    final List<Integer> calls=new CopyOnWriteArrayList<>();int slowAction;
    void set(String name,Object value){try{Field f=MotionService.class.getDeclaredField(name);f.setAccessible(true);f.set(service,value);}catch(Exception e){throw new AssertionError(e);}}
    void invoke(String name,Class<?>[] types,Object... args){try{Method m=MotionService.class.getDeclaredMethod(name,types);m.setAccessible(true);m.invoke(service,args);}catch(Exception e){throw new AssertionError(e);}}
    void navigate(int action,int task){invoke("navigate",new Class<?>[]{int.class,int.class},action,task);}
    @Before public void start(){
        Context context=instrumentation.getTargetContext();MotionSettings.setEnabled(context,false);
        activity=instrumentation.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(()->{
            service=new MotionService();
            nav=new InnerNavigation(activity.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null),1,1080,2340,this::navigate);
            set("navigation",nav);set("bound",new ServiceLifecycleTest.FakeBridge(){
                @Override public Bundle navigate(int display,int action,int task){
                    calls.add(action);
                    if(action==slowAction){entered.countDown();try{assertTrue(release.await(5,TimeUnit.SECONDS));}catch(InterruptedException e){Thread.currentThread().interrupt();}}
                    if(action==KeyEvent.KEYCODE_HOME)home.countDown();
                    Bundle result=new Bundle();result.putBoolean("ok",true);result.putParcelableArrayList("apps",new ArrayList<Bundle>());return result;
                }
            });
        });
    }
    @After public void stop()throws Exception{
        release.countDown();instrumentation.runOnMainSync(()->{set("stopped",true);nav.close();activity.finish();});
        for(String name:new String[]{"controls","jobs","poller"})((ExecutorService)UiOptimizationTest.field(service,name)).shutdownNow();
    }
    @Test public void backAndHomeDoNotWaitForEntirePreviewList()throws Exception{
        slowAction=InnerNavigation.PREVIEW;
        Bundle first=new Bundle();first.putInt("taskId",1);Bundle second=new Bundle();second.putInt("taskId",2);
        instrumentation.runOnMainSync(()->{nav.showRecent(List.of(first,second));invoke("loadRecentPreviews",new Class<?>[]{InnerNavigation.class,List.class,int.class},nav,List.of(first,second),0);});
        assertTrue(entered.await(3,TimeUnit.SECONDS));
        instrumentation.runOnMainSync(()->{nav.close();navigate(KeyEvent.KEYCODE_HOME,-1);});
        release.countDown();assertTrue(home.await(3,TimeUnit.SECONDS));instrumentation.waitForIdleSync();
        ((ExecutorService)UiOptimizationTest.field(service,"controls")).submit(()->{}).get(3,TimeUnit.SECONDS);
        assertEquals(List.of(InnerNavigation.PREVIEW,KeyEvent.KEYCODE_HOME),calls);assertFalse(nav.showingRecents());
    }
    @Test public void lateRecentsReplyCannotReplaceNewerHomeCommand()throws Exception{
        slowAction=KeyEvent.KEYCODE_APP_SWITCH;
        instrumentation.runOnMainSync(()->navigate(KeyEvent.KEYCODE_APP_SWITCH,-1));assertTrue(entered.await(3,TimeUnit.SECONDS));
        instrumentation.runOnMainSync(()->navigate(KeyEvent.KEYCODE_HOME,-1));release.countDown();
        assertTrue(home.await(3,TimeUnit.SECONDS));instrumentation.waitForIdleSync();assertFalse(nav.showingRecents());
    }
}
