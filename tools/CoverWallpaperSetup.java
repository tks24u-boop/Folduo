import jp.bunkaich.sukashimotion.WallpaperProfile;
import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.app.wallpaper.WallpaperDescription;
import android.content.ComponentName;
import android.content.Context;
import android.os.*;
import java.io.*;
import java.lang.reflect.Method;

/** Optional, explicit ADB setup for the tested Fold7; changes front HOME only. */
public final class CoverWallpaperSetup {
    private static final int COVER_HOME = 17;
    private static final String RESOURCE_PACKAGE = "com.samsung.android.wallpaper.res";
    private static final ComponentName LIVE = new ComponentName("com.samsung.android.wallpaper.live",
            "com.samsung.android.wallpaper.live.fold.FoldInteractive");

    public static void main(String[] args) {
        try { run(args); System.exit(0); }
        catch (Throwable error) { error.printStackTrace(); System.exit(1); }
    }

    private static String video(Bundle extras) {
        Bundle settings = extras == null ? null : extras.getBundle("serviceSettings");
        return settings == null ? null : settings.getString("filename");
    }

    private static Method exactApply(Class<?> api) {
        try {
            return api.getMethod("setWallpaperComponentChecked", WallpaperDescription.class,
                    String.class, int.class, int.class, Bundle.class);
        } catch (NoSuchMethodException unavailable) { return null; }
    }
    private static Method exactRestore(Class<?> api) {
        try {
            Method method = api.getMethod("setWallpaper", String.class, String.class, WallpaperDescription.class,
                    boolean.class, Bundle.class, int.class, Class.forName("android.app.IWallpaperManagerCallback"),
                    int.class, int.class, boolean.class, Bundle.class);
            return method.getReturnType() == ParcelFileDescriptor.class ? method : null;
        } catch (ReflectiveOperationException unavailable) { return null; }
    }
    private static void run(String[] args) throws Exception {
        String action = args.length == 0 ? "status" : args[0];
        if (!action.equals("status") && !action.equals("apply") && !action.equals("restore-stock"))
            throw new IllegalArgumentException("Use status, apply, or restore-stock");
        if (android.os.Process.myUid() != 2000 || !jp.bunkaich.sukashimotion.DeviceProfile.supports(Build.MANUFACTURER,Build.MODEL,Build.VERSION.SDK_INT))
            throw new IllegalStateException("Requires ADB shell on Samsung SM-F966Z or experimental SM-F966Q, Android 16");
        Looper.prepareMainLooper();
        Class<?> at = Class.forName("android.app.ActivityThread");
        Object thread = at.getMethod("systemMain").invoke(null);
        Context system = (Context) at.getMethod("getSystemContext").invoke(thread);
        Context context = system.createPackageContext("com.android.shell", 0);
        WallpaperManager manager = WallpaperManager.getInstance(context);
        Method getExtras = WallpaperManager.class.getMethod("getWallpaperExtras", int.class, int.class);
        Object uri = WallpaperManager.class.getMethod("semGetUri", int.class).invoke(manager, COVER_HOME);
        WallpaperInfo info = (WallpaperInfo) WallpaperManager.class.getMethod("getWallpaperInfo", int.class, int.class)
                .invoke(manager, COVER_HOME, 0);
        WallpaperInfo innerInfo = (WallpaperInfo) WallpaperManager.class.getMethod("getWallpaperInfo", int.class, int.class)
                .invoke(manager, 5, 0);
        Bundle innerExtras = (Bundle) getExtras.invoke(manager, 5, 0);
        String innerVideo = video(innerExtras);
        String innerVariant = innerInfo != null && LIVE.equals(innerInfo.getComponent())
                ? WallpaperProfile.variant(innerVideo) : null;
        String coverVideo = video((Bundle) getExtras.invoke(manager, COVER_HOME, 0));
        String coverVariant = info != null && LIVE.equals(info.getComponent())
                ? WallpaperProfile.variant(coverVideo) : null;
        boolean innerReady = innerVariant != null;
        boolean live = coverVariant != null;
        // Restore follows the current cover video even if the user changed the inner wallpaper.
        String selectedVariant = action.equals("restore-stock") && live ? coverVariant : innerVariant;
        boolean stock = WallpaperProfile.matchesStock(String.valueOf(uri), selectedVariant) && (info == null ||
                "com.android.systemui.wallpapers.ImageWallpaper".equals(info.getComponent().getClassName()));
        System.out.println("Helper version: q2 (stock pairs 002 / 004)");
        System.out.println("Cover home: " + (live ? "angle-aware stock video" : stock ? "original stock image" : "other wallpaper"));
        System.out.println("Cover URI: " + uri + " / video: " + coverVideo);
        System.out.println("Device: " + Build.MODEL + " / SDK " + Build.VERSION.SDK_INT + " / " + Build.DISPLAY);
        System.out.println("Inner component: " + (innerInfo == null ? "none" : innerInfo.getComponent()));
        System.out.println("Inner video: " + innerVideo + " / selected pair: " + selectedVariant);
        Class<?> preflightApi = Class.forName("android.app.IWallpaperManager");
        Method applyMethod = exactApply(preflightApi), restoreMethod = exactRestore(preflightApi);
        int stockResource = 0;
        try {
            Context stockContext = context.createPackageContext(RESOURCE_PACKAGE, 0);
            stockResource = selectedVariant == null ? 0 : stockContext.getResources().getIdentifier(WallpaperProfile.resource(selectedVariant), "drawable", RESOURCE_PACKAGE);
        } catch (android.content.pm.PackageManager.NameNotFoundException missing) { }
        System.out.println("Inner angle wallpaper: " + innerReady);
        System.out.println("Stock image resource: " + (stockResource != 0));
        System.out.println("Exact apply API: " + (applyMethod != null) + " / restore API: " + (restoreMethod != null));
        System.out.println("Wallpaper diagnostics only; Q hardware validation is pending.");
        if (action.equals("status")) return;
        if (action.equals("apply") && !innerReady)
            throw new IllegalStateException("Expected inner FoldInteractive video_002.mp4 or video_004.mp4; no change made");
        if (action.equals("apply") && live && !coverVariant.equals(innerVariant))
            throw new IllegalStateException("Inner and cover video differ; restore the cover before changing pairs");
        if ((!stock && !live)) throw new IllegalStateException("Wallpaper changed since setup; refusing to overwrite it");
        if (action.equals("apply") && live || action.equals("restore-stock") && stock) {
            System.out.println("Already configured; no change made"); return;
        }
        Context resources = context.createPackageContext(RESOURCE_PACKAGE, 0);
        int id = resources.getResources().getIdentifier(WallpaperProfile.resource(selectedVariant), "drawable", RESOURCE_PACKAGE);
        if (id == 0) throw new IllegalStateException("Original stock image unavailable; no change made");
        byte[] bytes;
        try (InputStream input = resources.getResources().openRawResource(id)) { bytes = input.readAllBytes(); }
        IBinder binder = (IBinder) Class.forName("android.os.ServiceManager").getMethod("getService", String.class)
                .invoke(null, "wallpaper");
        Object remote = Class.forName("android.app.IWallpaperManager$Stub").getMethod("asInterface", IBinder.class)
                .invoke(null, binder);
        Class<?> api = Class.forName("android.app.IWallpaperManager");
        // Samsung's public wrappers clear wallpaper snapshot history for shell callers.
        // Call the existing setter directly so unrelated wallpaper history is retained.
        if (action.equals("apply")) {
            Bundle inner = (Bundle) getExtras.invoke(manager, 5, 0);
            if (!innerReady) throw new IllegalStateException("Expected inner angle-aware wallpaper unavailable");
            if (restoreMethod == null || bytes.length == 0)
                throw new IllegalStateException("Restore capability unavailable; no change made");
            WallpaperDescription.Builder builder = new WallpaperDescription.Builder();
            builder.getClass().getMethod("setComponent", ComponentName.class).invoke(builder, LIVE);
            Method setter = applyMethod;
            if (setter == null) throw new IllegalStateException("Expected wallpaper setter unavailable");
            setter.invoke(remote, builder.build(), context.getPackageName(), COVER_HOME, 0, inner);
            System.out.println("Applied angle-aware stock video to front HOME only");
        } else {
            Method setter = restoreMethod;
            if (setter == null) throw new IllegalStateException("Expected wallpaper restore setter unavailable");
            Bundle extras = new Bundle(); extras.putString("uri", WallpaperProfile.uri(selectedVariant)); extras.putBoolean("isPreloaded", true);
            ParcelFileDescriptor file = (ParcelFileDescriptor) setter.invoke(remote, null, context.getPackageName(),
                    new WallpaperDescription.Builder().build(), false, new Bundle(), COVER_HOME, null, 0, 0, true, extras);
            if (file == null) throw new IllegalStateException("Wallpaper restore did not return a writable file");
            try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(file)) { output.write(bytes); }
            System.out.println("Restored original stock image to front HOME only");
        }
        SystemClock.sleep(1000);
    }
}
