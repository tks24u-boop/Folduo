package jp.bunkaich.sukashimotion;
/** Candidate device policy; runtime capability checks are still required. */
public final class DeviceProfile {
    private DeviceProfile() {}
    public static boolean supports(String maker,String model,int sdk) {
        return "samsung".equalsIgnoreCase(maker) && sdk==36
            && ("SM-F966Z".equals(model)||"SM-F966Q".equals(model));
    }
}
