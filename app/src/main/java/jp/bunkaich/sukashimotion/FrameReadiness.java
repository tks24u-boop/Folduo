package jp.bunkaich.sukashimotion;

/** Two stable observations of the intended task, never a different home underneath. */
final class FrameReadiness {
    private final int expectedTask;
    private String previous="";
    private int consecutive;
    FrameReadiness(int expectedTask){this.expectedTask=expectedTask;}
    boolean accept(boolean ready,String geometry,int taskId){
        if(!ready||expectedTask<0||taskId!=expectedTask||geometry==null||geometry.isEmpty()){
            previous="";consecutive=0;return false;
        }
        consecutive=geometry.equals(previous)?consecutive+1:1;
        previous=geometry;return consecutive>=2;
    }
}
