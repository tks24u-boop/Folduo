package jp.bunkaich.sukashimotion;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;

/** Interactive home; MotionService alone owns folding and display control. */
public final class HomeActivity extends Activity implements HomeScene.Actions {
    static final float FRAME_RATE = 60f;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService launches = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private HomeScene scene;
    private List<AppCatalog.App> apps = List.of();
    private AlertDialog drawer;
    private boolean started, launching, appsDirty=true, loadingApps;
    private int batteryLevel=-1, iconDensity;
    private String lastCatalogInvalidation="initial";
    private Runnable updateDrawer;
    private final BroadcastReceiver packages=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            String pkg=intent.getData()==null?null:intent.getData().getSchemeSpecificPart();
            // Own permission/locale changes and background-only packages do not
            // alter this catalog (Folduo itself is excluded by AppCatalog.load).
            if(pkg==null||pkg.equals(getPackageName()))return;
            boolean listed=apps.stream().anyMatch(app->app.component().getPackageName().equals(pkg));
            Intent query=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(pkg);
            if(!loadingApps&&!listed&&getPackageManager().queryIntentActivities(query,0).isEmpty())return;
            lastCatalogInvalidation=intent.getAction()+":"+pkg;
            appsDirty=true;if(started)refreshApps();
        }
    };
    private final BroadcastReceiver timeAndBattery=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){
            if(Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())){
                int level=intent.getIntExtra(BatteryManager.EXTRA_LEVEL,-1);
                int scale=intent.getIntExtra(BatteryManager.EXTRA_SCALE,100);
                batteryLevel=level<0?-1:Math.round(level*100f/Math.max(1,scale));
            }
            main.removeCallbacks(clock);if(started)main.post(clock);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("launcher", MODE_PRIVATE);
        iconDensity=getResources().getConfiguration().densityDpi;
        IntentFilter packageFilter=new IntentFilter(Intent.ACTION_PACKAGE_ADDED);
        packageFilter.addAction(Intent.ACTION_PACKAGE_REMOVED);packageFilter.addAction(Intent.ACTION_PACKAGE_CHANGED);packageFilter.addDataScheme("package");
        registerReceiver(packages,packageFilter,Context.RECEIVER_NOT_EXPORTED);
        BridgeConnection.init(this);
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        FrameLayout root = new FrameLayout(this);
        scene = new HomeScene(this, this);
        root.addView(scene, new FrameLayout.LayoutParams(-1, -1));
        Button settings = new Button(this);
        settings.setText(R.string.app_name);
        settings.setAllCaps(false);
        settings.setContentDescription(getString(R.string.nav_settings));
        settings.setTextColor(Color.WHITE);
        settings.setBackground(HomeScene.round(0x551d334b, dp(24)));
        settings.setOnClickListener(v -> settings());
        FrameLayout.LayoutParams button = new FrameLayout.LayoutParams(dp(92), dp(48), Gravity.BOTTOM | Gravity.END);
        button.setMargins(dp(16), 0, dp(16), dp(16));
        root.addView(settings, button);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.navigationBars() | WindowInsets.Type.displayCutout());
            root.setPadding(safe.left, 0, safe.right, safe.bottom);
            return insets;
        });
        setContentView(root);
        root.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> updatePanel());
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
            if (drawer != null) drawer.dismiss();
        });
    }

    @Override protected void onStart() {
        super.onStart(); started = true;
        refreshApps();
        IntentFilter filter=new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        filter.addAction(Intent.ACTION_TIME_CHANGED);filter.addAction(Intent.ACTION_TIMEZONE_CHANGED);
        registerReceiver(timeAndBattery,filter,Context.RECEIVER_NOT_EXPORTED);
        main.removeCallbacks(clock);main.post(clock);
    }
    @Override protected void onResume() {
        super.onResume();
        getWindow().getInsetsController().hide(WindowInsets.Type.statusBars());
        getWindow().getInsetsController().setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (MotionSettings.enabled(this)) BridgeConnection.connect(this);
        updatePanel();
    }
    @Override protected void onStop() { started = false; main.removeCallbacks(clock); unregisterReceiver(timeAndBattery); super.onStop(); }
    @Override protected void onDestroy() { unregisterReceiver(packages); if(drawer!=null)drawer.dismiss(); worker.shutdownNow(); launches.shutdownNow(); super.onDestroy(); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (drawer != null) drawer.dismiss(); }
    @Override public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);updatePanel();
        if(iconDensity!=c.densityDpi){lastCatalogInvalidation="density:"+iconDensity+"->"+c.densityDpi;iconDensity=c.densityDpi;appsDirty=true;if(started)refreshApps();}
    }

    private void updatePanel() {
        Display display = getDisplay();
        if (display == null) return;
        Display.Mode mode = display.getMode();
        float ratio = Math.min(mode.getPhysicalWidth(), mode.getPhysicalHeight()) / (float)Math.max(mode.getPhysicalWidth(), mode.getPhysicalHeight());
        scene.setFold(ratio > .68f && !isInMultiWindowMode(), 0, false);
    }
    private void refreshApps() {
        if(!appsDirty||loadingApps||isDestroyed())return;
        appsDirty=false;loadingApps=true;
        worker.execute(() -> {
            List<AppCatalog.App> loaded;
            try{loaded=AppCatalog.load(this);}catch(RuntimeException e){loaded=null;}
            final List<AppCatalog.App> result=loaded;
            main.post(() -> {
                loadingApps=false;if(isDestroyed())return;
                if(result==null){appsDirty=true;if(updateDrawer!=null)updateDrawer.run();return;}
                // A package/configuration change during loading invalidates that result.
                if(appsDirty){if(started)refreshApps();return;}
                apps=result;scene.updateApps(AppCatalog.favorites(apps,prefs));
                if(updateDrawer!=null)updateDrawer.run();
            });
        });
    }
    private final Runnable clock = new Runnable() {
        public void run() {
            if (!started) return;
            scene.tick(batteryLevel,prefs.getString("note", ""));
            main.postDelayed(this,60000-System.currentTimeMillis()%60000);
        }
    };

    @Override public void launch(AppCatalog.App app) { launchComponent(app.component()); }
    private void launchComponent(ComponentName component) {
        if (launching) return;
        launching = true;
        int display = getDisplay().getDisplayId();
        IShellBridge bridge = BridgeConnection.bridge;
        // Starting an app must never wait behind icon/catalog loading.
        launches.execute(() -> {
            boolean handled = false;
            String failure = null;
            try {
                if (display == 1 && MotionSettings.enabled(this)) {
                    if (bridge == null) throw new IllegalStateException(getString(R.string.bridge_missing));
                    Bundle result = bridge.launchApp(display, component.flattenToString());
                    if (!result.getBoolean("ok")) throw new IllegalStateException(result.getString("error"));
                    handled = result.getBoolean("handled");
                }
            } catch (Exception e) { failure = UiText.error(e).resolve(this); }
            boolean routed = handled;
            String error = failure;
            main.post(() -> {
                launching = false;
                if (isDestroyed()) return;
                if (error != null) { showLaunchError(error); return; }
                if (routed || !started) return;
                try {
                    startActivity(TaskDisplayRouter.launchIntent(component));
                } catch (ActivityNotFoundException | SecurityException e) { showLaunchError(e.getLocalizedMessage()); }
            });
        });
    }
    private void showLaunchError(String message) { Toast.makeText(this, getString(R.string.home_launch_failed, message), Toast.LENGTH_LONG).show(); }
    @Override public void choose(int slot) { showApps(slot); }
    @Override public void drawer() { showApps(-1); }
    @Override public void settings() { launchComponent(new ComponentName(this, MainActivity.class)); }
    private void showApps(int slot) {
        if (drawer != null && drawer.isShowing()) return;
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(dp(16), dp(8), dp(16), 0);
        EditText search = new EditText(this); search.setSingleLine(); search.setHint(R.string.home_search); panel.addView(search);
        ListView list = new ListView(this); panel.addView(list, new LinearLayout.LayoutParams(-1, dp(360)));
        List<AppCatalog.App> filtered = new ArrayList<>(apps);
        BaseAdapter adapter = new BaseAdapter() {
            public int getCount() { return filtered.size(); }
            public Object getItem(int position) { return filtered.get(position); }
            public long getItemId(int position) { return position; }
            public View getView(int position, View recycled, ViewGroup parent) {
                AppCatalog.App app = filtered.get(position);
                LinearLayout row;
                if(recycled instanceof LinearLayout existing)row=existing;
                else {
                    row=new LinearLayout(HomeActivity.this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(8),dp(8),dp(8),dp(8));
                    ImageView icon=new ImageView(HomeActivity.this);row.addView(icon,new LinearLayout.LayoutParams(dp(40),dp(40)));
                    TextView label=new TextView(HomeActivity.this);label.setTextSize(16);label.setPadding(dp(16),0,0,0);label.setSingleLine();label.setEllipsize(TextUtils.TruncateAt.END);row.addView(label,new LinearLayout.LayoutParams(0,-2,1));
                }
                ((ImageView)row.getChildAt(0)).setImageDrawable(app.icon());
                ((TextView)row.getChildAt(1)).setText(app.label());
                return row;
            }
        };
        list.setAdapter(adapter);
        TextView empty=new TextView(this);empty.setPadding(dp(8),dp(24),dp(8),dp(24));panel.addView(empty);list.setEmptyView(empty);
        Locale locale=getResources().getConfiguration().getLocales().get(0);
        Map<AppCatalog.App,String> names=new HashMap<>();
        updateDrawer=()->{
            String query=search.getText().toString().toLowerCase(locale);
            filtered.clear();
            for(AppCatalog.App app:apps)if(names.computeIfAbsent(app,a->a.label().toLowerCase(locale)).contains(query))filtered.add(app);
            empty.setText(loadingApps?R.string.home_loading:R.string.home_no_matches);adapter.notifyDataSetChanged();
        };
        updateDrawer.run();
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s,int start,int count,int after) {}
            public void afterTextChanged(Editable e) {}
            public void onTextChanged(CharSequence s,int start,int before,int count) {
                if(updateDrawer!=null)updateDrawer.run();
            }
        });
        drawer = new AlertDialog.Builder(this).setTitle(slot < 0 ? R.string.home_drawer_title : R.string.home_choose).setView(panel).setNegativeButton(R.string.close, null).create();
        list.setOnItemClickListener((p,v,index,id) -> {
            AppCatalog.App app = filtered.get(index); drawer.dismiss();
            if (slot < 0) launch(app);
            else { prefs.edit().putString("slot_" + slot, app.component().flattenToString()).apply(); scene.updateApps(AppCatalog.favorites(apps, prefs)); }
        });
        drawer.setOnDismissListener(d->updateDrawer=null);
        drawer.show(); drawer.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    }
    @Override public void note() {
        EditText entry = new EditText(this); entry.setText(prefs.getString("note", "")); entry.setHint(R.string.home_note_hint); entry.setMinLines(4);
        new AlertDialog.Builder(this).setTitle(R.string.home_note_title).setView(entry).setPositiveButton(R.string.home_save, (d,w) -> {
            prefs.edit().putString("note", entry.getText().toString()).apply(); main.removeCallbacks(clock); main.post(clock);
        }).setNegativeButton(R.string.close, null).show();
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
