package jp.bunkaich.sukashimotion;

/** Explicitly supported Samsung stock pairs; never accepts arbitrary wallpaper URIs. */
public final class WallpaperProfile {
    private WallpaperProfile() {}
    public static String variant(String video) {
        if ("video_002.mp4".equals(video)) return "002";
        if ("video_004.mp4".equals(video)) return "004";
        return null;
    }
    public static String resource(String variant) {
        if (!"002".equals(variant) && !"004".equals(variant))
            throw new IllegalArgumentException("Unsupported wallpaper variant");
        return "sub_wallpaper_" + variant;
    }
    public static String uri(String variant) {
        return "android.resource://com.samsung.android.wallpaper.res/drawable/" + resource(variant);
    }
    public static boolean matchesStock(String uri, String variant) {
        if (variant == null) return false;
        String expected = uri(variant);
        return expected.equals(uri) || (expected + ".png").equals(uri);
    }
}
