package jp.bunkaich.sukashimotion;

import android.app.LocaleManager;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.view.*;
import android.widget.Button;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import java.io.*;
import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

// Finish lifecycle/cache checks before the explicit display-size override. Window
// configuration restoration is asynchronous and must not invalidate that fixture.
@FixMethodOrder(org.junit.runners.MethodSorters.NAME_ASCENDING)
public class UiOptimizationTest {
    private final android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final Context context=instrumentation.getTargetContext();
    static Object field(Object target,String name){try{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}catch(Exception e){throw new AssertionError(e);}}
    interface Check{boolean ok();}
    private void waitFor(Check condition)throws Exception{
        long end=SystemClock.elapsedRealtime()+5000;
        while(!condition.ok()&&SystemClock.elapsedRealtime()<end)Thread.sleep(20);
        assertTrue("Condition reached before timeout",condition.ok());
    }
    @Before public void setup(){MotionSettings.setEnabled(context,false);MotionSettings.recovery(context,"");}
    @Test public void controlsAreVisibleAndOptionalHomeIsCollapsed()throws Exception{
        try(ActivityScenario<MainActivity> screen=ActivityScenario.launch(MainActivity.class)){
            instrumentation.waitForIdleSync();
            screen.onActivity(a->{
                Rect bounds=new Rect();Button start=a.findViewById(R.id.motion_start);
                assertTrue("Start is available without scrolling",start.getGlobalVisibleRect(bounds));
                assertEquals(start.getHeight(),bounds.height());
                assertEquals(View.GONE,a.findViewById(R.id.launcher_section).getVisibility());
                assertEquals(View.GONE,a.findViewById(R.id.diagnostics_section).getVisibility());
                assertFalse(a.findViewById(R.id.motion_stop).isEnabled());
                ViewGroup section=(ViewGroup)a.findViewById(R.id.launcher_section).getParent();section.getChildAt(0).performClick();
                assertEquals(View.VISIBLE,a.findViewById(R.id.launcher_section).getVisibility());
            });
            screen.recreate();
            screen.onActivity(a->assertEquals(View.VISIBLE,a.findViewById(R.id.launcher_section).getVisibility()));
        }
    }
    @Test public void leavingSettingsCancelsPeriodicUiUpdates(){
        try(ActivityScenario<MainActivity> screen=ActivityScenario.launch(MainActivity.class)){
            AtomicReference<MainActivity> ref=new AtomicReference<>();screen.onActivity(ref::set);
            instrumentation.waitForIdleSync();
            Handler handler=(Handler)field(ref.get(),"handler");Runnable refresh=(Runnable)field(ref.get(),"refresh");
            assertTrue(handler.hasCallbacks(refresh));
            screen.moveToState(Lifecycle.State.CREATED);
            assertFalse("No refresh timer while settings is stopped",handler.hasCallbacks(refresh));
            screen.moveToState(Lifecycle.State.RESUMED);instrumentation.waitForIdleSync();
            assertTrue(handler.hasCallbacks(refresh));
        }
    }
    @Test public void homeReturnUsesCachedCatalogButPackageChangeInvalidatesIt()throws Exception{
        try(ActivityScenario<HomeActivity> screen=ActivityScenario.launch(HomeActivity.class)){
            AtomicReference<HomeActivity> ref=new AtomicReference<>();screen.onActivity(ref::set);
            waitFor(()->{instrumentation.waitForIdleSync();return !(boolean)field(ref.get(),"loadingApps")&&!(boolean)field(ref.get(),"appsDirty");});
            Object cached=field(ref.get(),"apps");
            screen.moveToState(Lifecycle.State.CREATED);screen.moveToState(Lifecycle.State.RESUMED);instrumentation.waitForIdleSync();
            assertSame("Returning home without catalog changes must reuse labels/icons; last invalidation="+field(ref.get(),"lastCatalogInvalidation"),cached,field(ref.get(),"apps"));
            instrumentation.runOnMainSync(()->((BroadcastReceiver)field(ref.get(),"packages")).onReceive(context,new Intent(Intent.ACTION_PACKAGE_CHANGED,android.net.Uri.parse("package:"+context.getPackageName()))));
            instrumentation.waitForIdleSync();assertSame("Own permission/locale changes do not affect launcher entries",cached,field(ref.get(),"apps"));
            AppCatalog.App installed=((java.util.List<AppCatalog.App>)cached).get(0);
            screen.moveToState(Lifecycle.State.CREATED);
            instrumentation.runOnMainSync(()->((BroadcastReceiver)field(ref.get(),"packages")).onReceive(context,new Intent(Intent.ACTION_PACKAGE_CHANGED,android.net.Uri.parse("package:"+installed.component().getPackageName()))));
            screen.moveToState(Lifecycle.State.RESUMED);
            waitFor(()->{instrumentation.waitForIdleSync();return !(boolean)field(ref.get(),"loadingApps");});
            assertNotSame("A package change must reload the catalog",cached,field(ref.get(),"apps"));
        }
    }
    @Test public void cancelledTexturesKeepCallerBitmapUsable(){
        Bitmap input=Bitmap.createBitmap(160,200,Bitmap.Config.ARGB_8888);input.eraseColor(Color.GREEN);
        try{
            assertNull(FrameTexture.prepare(input,1,()->true));assertFalse(input.isRecycled());
            int[] calls={0};assertNull(FrameTexture.prepare(input,1,()->++calls[0]>10));
            assertFalse(input.isRecycled());assertEquals(Color.GREEN,input.getPixel(10,10));
            FrameTexture result=FrameTexture.prepare(input,1,()->false);assertNotNull(result);assertSame(input,result.sharp);
            for(Bitmap level:result.levels)assertEquals(Color.GREEN,level.getPixel(0,0));
            BlurCache.recycle(result.levels);
        }finally{input.recycle();}
    }
    @Test public void japaneseDashboardFitsCoverAndInnerWidths()throws Exception{
        LocaleManager locales=context.getSystemService(LocaleManager.class);LocaleList original=locales.getApplicationLocales();
        try{
            locales.setApplicationLocales(LocaleList.forLanguageTags("ja"));
            for(String panel:new String[]{"cover","inner"}){
                shell("wm size "+(panel.equals("cover")?"1080x2340":"1968x2184"));shell("wm density 420");
                try(ActivityScenario<MainActivity> screen=ActivityScenario.launch(MainActivity.class)){
                    instrumentation.waitForIdleSync();
                    screen.onActivity(a->{
                        assertEquals("ja",a.getResources().getConfiguration().getLocales().get(0).getLanguage());
                        Rect bounds=new Rect();View start=a.findViewById(R.id.motion_start);
                        assertTrue(start.getGlobalVisibleRect(bounds));assertEquals(start.getHeight(),bounds.height());
                    });
                    // Save only the synthetic emulator UI for visual review.
                    Thread.sleep(250);Bitmap shot=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(shot);
                    Bitmap small=Bitmap.createScaledBitmap(shot,Math.min(900,shot.getWidth()),Math.round(shot.getHeight()*Math.min(1,900f/shot.getWidth())),true);
                    try(FileOutputStream out=new FileOutputStream(new File(context.getExternalFilesDir(null),"dashboard-"+panel+".jpg"))){assertTrue(small.compress(Bitmap.CompressFormat.JPEG,85,out));}
                    if(small!=shot)small.recycle();shot.recycle();
                }
            }
        }finally{locales.setApplicationLocales(original);shell("wm size reset");shell("wm density reset");}
    }
    private void shell(String command)throws Exception{
        try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation().executeShellCommand(command))){in.readAllBytes();}
    }
}
