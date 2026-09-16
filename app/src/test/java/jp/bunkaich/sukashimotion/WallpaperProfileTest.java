package jp.bunkaich.sukashimotion;

import org.junit.Test;
import static org.junit.Assert.*;

public class WallpaperProfileTest {
    @Test public void acceptsOnlyObservedPairs() {
        assertEquals("002", WallpaperProfile.variant("video_002.mp4"));
        assertEquals("004", WallpaperProfile.variant("video_004.mp4"));
        assertNull(WallpaperProfile.variant(null));
        assertNull(WallpaperProfile.variant("video_003.mp4"));
        assertNull(WallpaperProfile.variant("../video_004.mp4"));
    }
    @Test public void stockMustMatchVideoAndPackage() {
        String uri = WallpaperProfile.uri("004");
        assertTrue(WallpaperProfile.matchesStock(uri, "004"));
        assertTrue(WallpaperProfile.matchesStock(uri + ".png", "004"));
        assertFalse(WallpaperProfile.matchesStock(uri, "002"));
        assertFalse(WallpaperProfile.matchesStock(uri + "/other", "004"));
        assertFalse(WallpaperProfile.matchesStock(uri.replace("com.samsung", "com.other"), "004"));
        assertFalse(WallpaperProfile.matchesStock(null, "004"));
        assertFalse(WallpaperProfile.matchesStock(uri, null));
        assertEquals("sub_wallpaper_004", WallpaperProfile.resource("004"));
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsUnknownRestoreResource() {
        WallpaperProfile.resource("003");
    }
}
