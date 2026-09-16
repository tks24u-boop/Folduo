package jp.bunkaich.sukashimotion;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.util.ArrayList;
import rikka.shizuku.Shizuku;

public final class MainActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private TextView state,diagnostic,requirements;
    private Button startButton,stopButton;
    private boolean probing,foreground;
    private String lastState="",lastRequirements="";
    private final java.util.Map<String,Boolean> expanded=new java.util.HashMap<>();
    private final Shizuku.OnRequestPermissionResultListener permission=(code,result)->{if(result==0)BridgeConnection.connect(this);};
    private final IAngleSink diagnosticSink=new IAngleSink.Stub(){public void angle(float a,long t,int kind){}};
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);BridgeConnection.init(this);Shizuku.addRequestPermissionResultListener(permission);
        if(saved!=null)for(String key:new String[]{"setup","help","launcher","diagnostics"})if(saved.containsKey(key))expanded.put(key,saved.getBoolean(key));
        getWindow().setNavigationBarColor(0xff101714);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xff101714);
        android.widget.FrameLayout holder=new android.widget.FrameLayout(this);scroll.addView(holder);
        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(20),dp(20),dp(20),dp(32));
        android.widget.FrameLayout.LayoutParams content=new android.widget.FrameLayout.LayoutParams(-1,-2,Gravity.TOP|Gravity.CENTER_HORIZONTAL);holder.addView(page,content);
        holder.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{int width=Math.min(r-l,dp(720));if(page.getLayoutParams().width!=width){page.getLayoutParams().width=width;page.requestLayout();}});
        scroll.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);return insets;});
        label(page,getString(R.string.app_name),30,Color.WHITE);
        label(page,getString(R.string.dashboard_subtitle),14,0xffb5c9bf);
        LinearLayout statusCard=card(page);
        label(statusCard,getString(R.string.dashboard_status),13,0xff9acbb3);
        state=label(statusCard,"",19,Color.WHITE);state.setId(R.id.dashboard_status);
        label(statusCard,getString(R.string.dashboard_privacy),13,0xffc5d3cd);
        LinearLayout actions=new LinearLayout(this);statusCard.addView(actions);
        startButton=button(actions,getString(R.string.dashboard_start),this::startMotion);startButton.setId(R.id.motion_start);
        startButton.setTextColor(0xff10251b);startButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xffa7e5c4));
        stopButton=button(actions,getString(R.string.stop),this::stopMotion);stopButton.setId(R.id.motion_stop);
        LinearLayout.LayoutParams first=new LinearLayout.LayoutParams(0,-2,1);first.setMargins(0,0,dp(8),0);startButton.setLayoutParams(first);stopButton.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        label(statusCard,getString(R.string.dashboard_one_ui),13,0xffc5d3cd);
        LinearLayout setup=section(page,"setup",R.string.setup_title,!BridgeConnection.permitted()||!Settings.canDrawOverlays(this),R.id.setup_section);
        requirements=label(setup,"",14,0xffc5d3cd);
        button(setup,getString(R.string.connect_shizuku),this::connectShizuku);
        button(setup,getString(R.string.open_shizuku),()->{Intent launch=getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api");if(launch!=null)startActivity(launch);else startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://shizuku.rikka.app/guide/setup/")));});
        button(setup,getString(R.string.allow_overlay),()->startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName()))));
        LinearLayout help=section(page,"help",R.string.dashboard_help,false,R.id.help_section);
        label(help,getString(R.string.screen_access_body),14,0xffc5d3cd);
        label(help,getString(R.string.setup_body),14,0xffc5d3cd);
        label(help,getString(R.string.inner_controls_body),14,0xffc5d3cd);
        label(help,getString(R.string.recovery_body),14,0xffc5d3cd);
        label(help,getString(R.string.power_body),14,0xffc5d3cd);
        label(help,getString(R.string.battery_body),14,0xffc5d3cd);
        button(help,getString(R.string.battery_settings),()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));
        LinearLayout launcher=section(page,"launcher",R.string.dashboard_optional_home,false,R.id.launcher_section);
        label(launcher,getString(R.string.dashboard_optional_body),14,0xffc5d3cd);
        button(launcher,getString(R.string.home_open),this::openHome);
        button(launcher,getString(R.string.home_default),()->{
            android.app.role.RoleManager roles=getSystemService(android.app.role.RoleManager.class);
            if(roles.isRoleHeld(android.app.role.RoleManager.ROLE_HOME))openHome();
            else startActivityForResult(roles.createRequestRoleIntent(android.app.role.RoleManager.ROLE_HOME),9);
        });
        button(launcher,getString(R.string.preview),()->startActivity(new Intent(this,PreviewActivity.class)));
        LinearLayout diagnostics=section(page,"diagnostics",R.string.sensors_title,false,R.id.diagnostics_section);
        label(diagnostics,getString(R.string.sensors_body),14,0xffc5d3cd);
        button(diagnostics,getString(R.string.probe_sensors),()->probe(0));
        diagnostic=label(diagnostics,getString(R.string.not_measured),13,0xffd0dbd5);diagnostic.setTextIsSelectable(true);
        Button language=button(page,getString(R.string.language_current,languageName()),this::chooseLanguage);language.setId(R.id.language_button);
        label(page,BuildConfig.VERSION_NAME+" · "+getString(R.string.device_note),12,0xff90a298);
        setContentView(scroll);
    }
    private void connectShizuku(){
        if(!Shizuku.pingBinder()){new AlertDialog.Builder(this).setMessage(R.string.shizuku_not_running).setPositiveButton(R.string.open_shizuku,(d,w)->{Intent launch=getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api");if(launch!=null)startActivity(launch);else startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://shizuku.rikka.app/guide/setup/")));}).setNegativeButton(R.string.close,null).show();return;}
        if(BridgeConnection.permitted())BridgeConnection.connect(this);else Shizuku.requestPermission(7);
    }
    private void stopMotion(){
        MotionSettings.setEnabled(this,false);stopService(new Intent(this,MotionService.class));
        if(!MotionService.running)BridgeConnection.disconnect();refreshState();
    }
    private LinearLayout card(LinearLayout page){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(16),dp(8),dp(16),dp(12));box.setBackground(HomeScene.round(0xff1c2a23,dp(20)));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(12);page.addView(box,p);return box;
    }
    private LinearLayout section(LinearLayout page,String key,int title,boolean initial,int id){
        LinearLayout box=card(page),body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setId(id);
        boolean open=expanded.getOrDefault(key,initial);expanded.put(key,open);body.setVisibility(open?View.VISIBLE:View.GONE);
        Button toggle=button(box,getString(title)+(open?"  −":"  +"),()->{});toggle.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);toggle.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff1c2a23));toggle.setTextColor(Color.WHITE);
        toggle.setStateDescription(getString(open?R.string.section_expanded:R.string.section_collapsed));
        toggle.setOnClickListener(v->{boolean show=body.getVisibility()!=View.VISIBLE;expanded.put(key,show);body.setVisibility(show?View.VISIBLE:View.GONE);toggle.setText(getString(title)+(show?"  −":"  +"));toggle.setStateDescription(getString(show?R.string.section_expanded:R.string.section_collapsed));});
        box.addView(body);return body;
    }
    private void startMotion(){
        if(!Settings.canDrawOverlays(this)){Toast.makeText(this,getString(R.string.need_overlay),Toast.LENGTH_LONG).show();return;}
        if(!BridgeConnection.permitted()){Toast.makeText(this,getString(R.string.need_shizuku),Toast.LENGTH_LONG).show();return;}
        if(!DeviceProfile.supports(Build.MANUFACTURER,Build.MODEL,Build.VERSION.SDK_INT)){Toast.makeText(this,getString(R.string.unsupported_device),Toast.LENGTH_LONG).show();return;}
        if(checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},8);
        BridgeConnection.connect(this);MotionSettings.setEnabled(this,true);startForegroundService(new Intent(this,MotionService.class).setAction(MotionService.running?"restart":"start"));
        Toast.makeText(this,getString(R.string.close_to_prepare),Toast.LENGTH_LONG).show();finish();
    }
    private void probe(int attempt){
        if(probing||!foreground||isDestroyed())return;
        BridgeConnection.connect(this);IShellBridge bridge=BridgeConnection.bridge;
        if(bridge==null){diagnostic.setText(BridgeConnection.status.resolve(this));if(attempt<30&&BridgeConnection.permitted())handler.postDelayed(()->probe(attempt+1),300);return;}
        probing=true;diagnostic.setText(getString(R.string.probe_running));
        boolean alreadyRunning=MotionService.running;
        BridgeConnection.work.execute(()->{try{
            if(!alreadyRunning)bridge.startAngles(diagnosticSink);
            handler.postDelayed(()->BridgeConnection.work.execute(()->{try{
                Bundle report=bridge.inspect();
                if(!alreadyRunning&&!MotionService.running)bridge.stopAngles();
                String formatted=formatReport(this,report);handler.post(()->{probing=false;if(!isDestroyed())diagnostic.setText(formatted);});
            }catch(Exception e){handler.post(()->{probing=false;if(!isDestroyed())diagnostic.setText(UiText.error(e).resolve(this));});}}),5000);
        }catch(Exception e){handler.post(()->{probing=false;if(!isDestroyed())diagnostic.setText(UiText.error(e).resolve(this));});}});
    }
    static String formatReport(Context c,Bundle b){
        StringBuilder text=new StringBuilder(c.getString(R.string.device_report,b.getString("model","?"),b.getInt("sdk"),b.getString("build","?")));
        text.append('\n').append(c.getString(R.string.probe_permissions,b.getInt("uid"),c.getString(b.getBoolean("samsungPermission")?R.string.yes:R.string.no)));
        ArrayList<Bundle> rows=b.getParcelableArrayList("sensors",Bundle.class);boolean gyro=false,sub=false;
        if(rows!=null)for(Bundle r:rows){
            long count=r.getLong("events");int type=r.getInt("type");
            if(type==4&&count>0)gyro=true;if((type==65689||type==65690)&&count>0)sub=true;
            text.append('\n').append(c.getString(R.string.probe_row,r.getString("name"),type,c.getString(r.getBoolean("registered")?R.string.success:R.string.unavailable),count));
            if(type==36||type==65686)text.append(c.getString(R.string.resolution,java.text.NumberFormat.getNumberInstance(c.getResources().getConfiguration().getLocales().get(0)).format(r.getFloat("resolution"))));
            if(r.containsKey("error"))text.append('\n').append(UiText.raw(r.getString("error")).resolve(c));text.append('\n');
        }
        text.append('\n').append(c.getString(R.string.gyro_result,c.getString(gyro&&sub?R.string.both_gyros:R.string.missing_gyro)));
        text.append("\n\n").append(c.getString(R.string.display_result,UiText.raw(b.getString("display")).resolve(c)));
        if(!b.getString("error","").isEmpty())text.append('\n').append(UiText.raw(b.getString("error")).resolve(c));return text.toString();
    }
    void openHome(){
        if(getDisplay().getDisplayId()==1&&MotionSettings.enabled(this)&&getSystemService(android.app.role.RoleManager.class).isRoleHeld(android.app.role.RoleManager.ROLE_HOME)){
            IShellBridge bridge=BridgeConnection.bridge;
            BridgeConnection.work.execute(()->{
                try{
                    if(bridge==null)throw new IllegalStateException(getString(R.string.bridge_missing));
                    Bundle result=bridge.navigate(1,KeyEvent.KEYCODE_HOME,-1);
                    if(!result.getBoolean("ok"))throw new IllegalStateException(result.getString("error"));
                }catch(Exception error){handler.post(()->{if(!isDestroyed())Toast.makeText(this,UiText.error(error).resolve(this),Toast.LENGTH_LONG).show();});}
            });
        }else startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setComponent(new ComponentName(this,HomeActivity.class)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private String languageName(){
        LocaleList locales=getSystemService(LocaleManager.class).getApplicationLocales();
        if(locales.isEmpty())return getString(R.string.language_system);
        return getString("ja".equals(locales.get(0).getLanguage())?R.string.language_japanese:R.string.language_english);
    }
    private void chooseLanguage(){
        LocaleManager manager=getSystemService(LocaleManager.class);LocaleList locales=manager.getApplicationLocales();
        int selected=locales.isEmpty()?0:("ja".equals(locales.get(0).getLanguage())?2:1);
        String[] names={getString(R.string.language_system),getString(R.string.language_english),getString(R.string.language_japanese)};
        new AlertDialog.Builder(this).setTitle(R.string.language_title).setSingleChoiceItems(names,selected,(dialog,index)->{
            dialog.dismiss();String tags=new String[]{"","en","ja"}[index];
            if(!manager.getApplicationLocales().toLanguageTags().equals(tags))manager.setApplicationLocales(LocaleList.forLanguageTags(tags));
        }).setNegativeButton(R.string.close,null).show();
    }
    private void refreshState(){
        String recovery=MotionSettings.recovery(this);
        String text=MotionService.running?MotionService.status.resolve(this):getString(R.string.stopped);
        if(!recovery.isEmpty())text+="\n"+getString(R.string.last_recovery,recovery);
        if(!text.equals(lastState)){state.setText(text);lastState=text;}
        String ready=getString(R.string.dashboard_requirements,
            getString(BridgeConnection.permitted()?R.string.dashboard_ready:R.string.dashboard_needed),
            getString(Settings.canDrawOverlays(this)?R.string.dashboard_ready:R.string.dashboard_needed));
        if(!ready.equals(lastRequirements)){requirements.setText(ready);lastRequirements=ready;}
        String start=getString(MotionService.running?R.string.dashboard_restart:R.string.dashboard_start);
        if(!android.text.TextUtils.equals(startButton.getText(),start))startButton.setText(start);
        stopButton.setEnabled(MotionService.running||MotionSettings.enabled(this));
    }
    private final Runnable refresh=new Runnable(){public void run(){if(!foreground)return;refreshState();handler.postDelayed(this,1000);}};
    @Override protected void onResume(){super.onResume();foreground=true;handler.removeCallbacks(refresh);handler.post(refresh);if(MotionSettings.enabled(this)&&!MotionService.running&&Settings.canDrawOverlays(this))startForegroundService(new Intent(this,MotionService.class).setAction("restore"));}
    @Override protected void onPause(){foreground=false;handler.removeCallbacks(refresh);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);for(var entry:expanded.entrySet())out.putBoolean(entry.getKey(),entry.getValue());}
    private int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
    private TextView label(LinearLayout parent,String text,int size,int color){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setTextColor(color);v.setPadding(0,dp(10),0,dp(10));v.setLineSpacing(dp(3),1);parent.addView(v);return v;}
    private Button button(LinearLayout parent,String title,Runnable action){Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setOnClickListener(v->action.run());b.setMinHeight(dp(48));parent.addView(b,new LinearLayout.LayoutParams(-1,-2));return b;}
    @Override protected void onDestroy(){handler.removeCallbacks(refresh);Shizuku.removeRequestPermissionResultListener(permission);super.onDestroy();}
}
