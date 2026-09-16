package jp.bunkaich.sukashimotion;

/** Keep only the latest requested direction while the real app is being transferred. */
final class HandoffQueue {
    private Boolean inFlight,pending;
    boolean request(boolean opening){
        if(inFlight!=null){pending=opening;return false;}
        inFlight=opening;return true;
    }
    Boolean complete(){
        Boolean next=pending!=null&&!pending.equals(inFlight)?pending:null;
        reset();return next;
    }
    void reset(){inFlight=null;pending=null;}
}
