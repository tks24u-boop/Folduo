package jp.bunkaich.sukashimotion;

import java.util.regex.*;

/** Returns task ID, geometry and draw state; titles, app names and content are discarded. */
final class WindowReadiness {
    private static final Pattern TASK=Pattern.compile("(?:^|\\s)taskId=(\\d+)(?:\\s|$)");
    record State(boolean ready,String geometry,int taskId){}
    static State parse(String dump,int displayId){
        for(String window:dump.split("(?m)^  Window #")){
            if(!Pattern.compile("mDisplayId="+displayId+"(?:\\s|$)").matcher(window).find()||!window.contains("ty=BASE_APPLICATION"))continue;
            if(!window.contains("mViewVisibility=0x0")||!window.contains("isOnScreen=true"))continue;
            Matcher frame=Pattern.compile("Frames:.*?frame=(\\[[^\\n]+?) last=").matcher(window);
            String geometry=frame.find()?frame.group(1):"";
            Matcher task=TASK.matcher(window);int taskId=task.find()?Integer.parseInt(task.group(1)):-1;
            boolean ready=!geometry.isEmpty()&&window.contains("mHasSurface=true")&&window.contains("isReadyForDisplay()=true")
                &&window.contains("shown=true")&&window.contains("mDrawState=HAS_DRAWN")&&window.contains("insetsChanged=false")
                &&!window.contains("mAnimatingExit=true")&&!window.contains("mAppFreezing=true");
            return new State(ready,geometry,taskId);
        }
        return new State(false,"",-1);
    }
}
