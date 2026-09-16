package jp.bunkaich.sukashimotion;

import org.junit.Test;
import static org.junit.Assert.*;

public class WindowReadinessTest {
    private static final String DRAWN="""
      Window #0 Window{anonymous}:
        mDisplayId=0 taskId=7
        ty=BASE_APPLICATION
        mViewVisibility=0x0 mHaveFrame=true mObscured=true
        mHasSurface=true isReadyForDisplay()=true
        Frames: parent=[0,0][1968,2184] display=[0,0][1968,2184] frame=[0,0][1968,2184] last=[0,0][1968,2184] insetsChanged=false
        Surface: shown=true mDrawState=HAS_DRAWN mLastHidden=false
        isOnScreen=true
    """;
    @Test public void drawnAppIsReadyEvenBehindFreeze(){assertTrue(WindowReadiness.parse(DRAWN,0).ready());}
    @Test public void appWaitingForBufferIsNotReady(){assertFalse(WindowReadiness.parse(DRAWN.replace("HAS_DRAWN","DRAW_PENDING"),0).ready());}
    @Test public void changingInsetsIsNotReady(){assertFalse(WindowReadiness.parse(DRAWN.replace("insetsChanged=false","insetsChanged=true"),0).ready());}
    @Test public void otherDisplayDoesNotQualify(){assertFalse(WindowReadiness.parse(DRAWN,1).ready());}
    @Test public void overlayDoesNotQualify(){assertFalse(WindowReadiness.parse(DRAWN.replace("BASE_APPLICATION","APPLICATION_OVERLAY"),0).ready());}
    @Test public void onlyGeometryIsReturned(){assertEquals("[0,0][1968,2184]",WindowReadiness.parse(DRAWN,0).geometry());}
    @Test public void exitingWindowIsNotReady(){assertFalse(WindowReadiness.parse(DRAWN+" mAnimatingExit=true",0).ready());}
    @Test public void taskIdentityIsReadFromWindowDump(){assertEquals(7,WindowReadiness.parse(DRAWN,0).taskId());}
    @Test public void missingTaskIsNotGuessedFromRootId(){assertEquals(-1,WindowReadiness.parse(DRAWN.replace("taskId=7","rootTaskId=7"),0).taskId());}
    @Test public void foregroundTaskIsNotReplacedByReadyBackgroundTask(){
        String top=DRAWN.replace("taskId=7","taskId=31").replace("HAS_DRAWN","DRAW_PENDING");
        WindowReadiness.State state=WindowReadiness.parse(top+DRAWN,0);
        assertFalse(state.ready());assertEquals(31,state.taskId());
    }
}
