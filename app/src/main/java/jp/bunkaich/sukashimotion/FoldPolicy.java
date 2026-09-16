package jp.bunkaich.sukashimotion;

/** Pure state machine. Direction hysteresis prevents tiny sensor jitter swapping screens. */
final class FoldPolicy {
    enum Change { NONE, OPEN, CLOSE, FINISH_OPEN, FINISH_CLOSED }
    boolean open,active;float extreme;long endpointSince=-1;
    private int endpoint=-1;
    FoldPolicy(boolean initiallyInner){open=initiallyInner;extreme=initiallyInner?180:0;}
    Change update(float angle,long now){
        if(!Float.isFinite(angle)||angle<0||angle>180)return Change.NONE;
        if(!active){
            if(!open&&angle>3&&angle<174){active=true;open=true;extreme=angle;return Change.OPEN;}
            if(open&&angle<174&&angle>3){active=true;open=false;extreme=angle;return Change.CLOSE;}
            // Public state may have skipped the entire motion. Do not synthesize an animation.
            if(angle>=176)open=true;if(angle<=3)open=false;return Change.NONE;
        }
        int nextEndpoint=angle>=176?1:angle<=1?0:-1;
        if(nextEndpoint>=0){
            // A quick full reversal must dwell at its OWN endpoint. Time spent at
            // the opposite endpoint must never count towards completing this fold.
            if(endpointSince<0||endpoint!=nextEndpoint||now<endpointSince)endpointSince=now;
            endpoint=nextEndpoint;
            if(now-endpointSince>=120){active=false;open=nextEndpoint==1;endpointSince=-1;endpoint=-1;return open?Change.FINISH_OPEN:Change.FINISH_CLOSED;}
        }else {endpointSince=-1;endpoint=-1;}
        if(open){extreme=Math.max(extreme,angle);if(extreme-angle>=12){open=false;extreme=angle;return Change.CLOSE;}}
        else{extreme=Math.min(extreme,angle);if(angle-extreme>=12){open=true;extreme=angle;return Change.OPEN;}}
        return Change.NONE;
    }
    static float blur(float angle,boolean inner){
        float x=inner?(176-angle)/86:(angle-1.5f)/88.5f;
        // Optical strength follows hinge travel, independently of image handoff.
        // Easing this value accelerates the blur in the middle of a slow fold.
        return Math.max(0,Math.min(1,x));
    }
    static float smooth(float value,float target,float seconds){return target+(value-target)*(float)Math.exp(-Math.min(.1,Math.max(0,seconds))/.024);}
}
