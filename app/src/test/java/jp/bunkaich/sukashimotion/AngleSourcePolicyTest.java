package jp.bunkaich.sukashimotion;
import org.junit.Test;
import static org.junit.Assert.*;
public final class AngleSourcePolicyTest {
    @Test public void directSourceExpiresAtBoundary() {
        for(int source:new int[]{2,3}) {
            assertTrue(AngleSourcePolicy.suppressWallpaper(source,10000,11500));
            assertFalse(AngleSourcePolicy.suppressWallpaper(source,10000,11501));
            assertTrue(AngleSourcePolicy.suppressWallpaper(source,10000,9990));
        }
    }
    @Test public void wallpaperDoesNotSuppressItself() {
        for(int source:new int[]{-1,0,1})assertFalse(AngleSourcePolicy.suppressWallpaper(source,10000,10001));
    }
    @Test public void invalidOrCoarseResolutionIsNotFine() {
        for(int type:new int[]{36,65686})
            for(float r:new float[]{0,-1,10,90,Float.NaN,Float.POSITIVE_INFINITY})
                assertEquals(0,AngleSourcePolicy.classify(type,r));
    }
    @Test public void fineSourcesAreDistinguished() {
        assertEquals(3,AngleSourcePolicy.classify(36,0.1f));
        assertEquals(2,AngleSourcePolicy.classify(65686,1f));
        assertEquals(0,AngleSourcePolicy.classify(4,0.1f));
    }
}
