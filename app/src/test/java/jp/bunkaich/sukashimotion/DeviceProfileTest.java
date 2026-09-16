package jp.bunkaich.sukashimotion;
import org.junit.Test;
import static org.junit.Assert.*;
public final class DeviceProfileTest {
    @Test public void supportedCandidates() {
        assertTrue(DeviceProfile.supports("samsung","SM-F966Q",36));
        assertTrue(DeviceProfile.supports("SAMSUNG","SM-F966Z",36));
    }
    @Test public void rejectOtherDevicesAndUnreviewedOs() {
        for(String model:new String[]{"SM-F966B","SM-F966U","SM-F966Q-extra","SM-F956Q","",null})
            assertFalse(DeviceProfile.supports("samsung",model,36));
        assertFalse(DeviceProfile.supports("other","SM-F966Q",36));
        assertFalse(DeviceProfile.supports(null,"SM-F966Q",36));
        for(int sdk:new int[]{33,35,37})assertFalse(DeviceProfile.supports("samsung","SM-F966Q",sdk));
    }
}
