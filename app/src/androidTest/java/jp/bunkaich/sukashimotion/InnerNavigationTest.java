package jp.bunkaich.sukashimotion;
import android.app.Activity;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import java.util.List;
import static org.junit.Assert.*;
public class InnerNavigationTest {
 Activity activity;InnerNavigation nav;int action=-1,task=-1;
 void ui(Runnable task){InstrumentationRegistry.getInstrumentation().runOnMainSync(task);}
 View root()throws Exception{var f=InnerNavigation.class.getDeclaredField("root");f.setAccessible(true);return (View)f.get(nav);}
 View find(View v,String label){if(label.contentEquals(v.getContentDescription()==null?"":v.getContentDescription()))return v;if(v instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++){View found=find(group.getChildAt(i),label);if(found!=null)return found;}return null;}
 @Before public void start(){Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();activity=InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));ui(()->nav=new InnerNavigation(activity.createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null),0,1968,2184,(a,t)->{action=a;task=t;}));}
 @After public void stop(){ui(()->{nav.close();activity.finish();});}
 @Test public void controlsAreImmediatelyAvailableAndSettingsIsDistinct()throws Exception{
  View row=root();assertNotNull(find(row,activity.getString(R.string.nav_back)));assertNotNull(find(row,activity.getString(R.string.nav_home)));assertNotNull(find(row,activity.getString(R.string.nav_recents)));ui(()->find(row,activity.getString(R.string.nav_settings)).performClick());assertEquals(InnerNavigation.SETTINGS,action);
 }
 @Test public void cardSelectsExistingTaskAndClosesOnlyThePanel()throws Exception{
  Bundle app=new Bundle();app.putInt("taskId",27);app.putString("label","電卓");ui(()->nav.showRecent(List.of(app)));View row=root();ui(()->find(row,"電卓").performClick());assertEquals(0,action);assertEquals(27,task);assertFalse(nav.showingRecents());assertNotNull(find(root(),activity.getString(R.string.nav_back)));
 }
 @Test public void backInRecentsDoesNotCloseUnderlyingApp()throws Exception{
  ui(()->nav.showRecent(List.of()));View row=root();ui(()->find(row,activity.getString(R.string.nav_back)).performClick());assertEquals(-1,action);assertFalse(nav.showingRecents());
 }
 @Test public void controlsNeverRequestAppResizingOrKeyboardFocus()throws Exception{
  WindowManager.LayoutParams p=(WindowManager.LayoutParams)root().getLayoutParams();assertTrue((p.flags&WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE)!=0);assertEquals(0,p.getFitInsetsTypes());assertEquals(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,p.type);
 }
 @Test public void latePreviewCannotReopenDismissedPanel()throws Exception{
  ui(()->nav.showRecent(List.of()));View row=root();ui(()->find(row,activity.getString(R.string.nav_back)).performClick());ui(()->nav.setPreview(4,Bitmap.createBitmap(2,2,Bitmap.Config.ARGB_8888)));assertFalse(nav.showingRecents());
 }
 @Test public void closingRemovesTouchableWindow()throws Exception{View before=root();ui(()->nav.close());assertFalse(before.isAttachedToWindow());assertNull(root());}
 @Test public void repeatedHomeAndBackKeepTheSameOverlayWindow()throws Exception{
  View before=root();ui(()->find(before,activity.getString(R.string.nav_home)).performClick());assertSame(before,root());
  ui(()->find(before,activity.getString(R.string.nav_back)).performClick());assertSame(before,root());
 }
 @Test public void recentsButtonTogglesThePanelWithoutReloading()throws Exception{
  ui(()->nav.showRecent(List.of()));View before=root();int revision=nav.revision();
  ui(()->find(before,activity.getString(R.string.nav_recents)).performClick());assertFalse(nav.showingRecents());assertEquals(-1,action);assertTrue(nav.revision()>revision);
 }
}
