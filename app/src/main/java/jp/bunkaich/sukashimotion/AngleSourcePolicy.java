package jp.bunkaich.sukashimotion;
final class AngleSourcePolicy {
    private AngleSourcePolicy() {}
    static boolean suppressWallpaper(int source,long directAt,long wallpaperAt) {
        return source>=2 && wallpaperAt-directAt<=1500;
    }
    static int classify(int type,float resolution) {
        if(!Float.isFinite(resolution)||resolution<=0||resolution>=10)return 0;
        return type==65686?2:type==36?3:0;
    }
}
