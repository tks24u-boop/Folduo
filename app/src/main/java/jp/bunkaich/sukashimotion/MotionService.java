package jp.bunkaich.sukashimotion;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.hardware.display.DisplayManager;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import java.util.*;
import java.util.concurrent.*;
import java.io.FileDescriptor;
import java.io.PrintWriter;

/** Keeps the user-enabled monitor alive; capture is suspended while locked. */
public final class MotionService extends Service implements DisplayManager.DisplayListener,Choreographer.FrameCallback {
    static volatile boolean running;static volatile UiText status=UiText.of(R.string.stopped);
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService jobs=Executors.newSingleThreadExecutor();
    private final ExecutorService controls=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService poller=Executors.newSingleThreadScheduledExecutor();
    private final List<Panel> panels=new ArrayList<>();private final List<Layer> layers=new ArrayList<>();
    private final Map<Boolean,FrameTexture> frozen=new HashMap<>();
    private volatile List<Anchor> anchors=List.of();
    private volatile int generation,sessionSerial,navigationRequest;private volatile boolean stopped,fastPolling;private boolean paused=true,busy,frameScheduled,blockedUntilEndpoint,finishing;private String panelSignature="";
    private long angleStartedAt,angleSession,retryAt;private int recoveries;private UiText lastRecovery=UiText.raw("");private String notificationText="";
    private boolean layoutPrepared,layoutPreparing,layoutRecovering,fixedPrimaryInner;
    private final HandoffQueue directionQueue=new HandoffQueue();private int expectedTaskId=-1;
    private IShellBridge bound;private FoldPolicy policy;private float target=Float.NaN,smoothed=Float.NaN;
    private LocaleList uiLocales;private volatile InnerNavigation navigation;private String navigationError="";
    private long measuredAt,lastFrame;private int source=-1;private DisplayManager displays;
    private final ArrayDeque<String> angleHistory=new ArrayDeque<>();
    private long layerSerial;private long acceptedAngles;private String anchorError="",stage="idle";
    private final ArrayDeque<String> handoffs=new ArrayDeque<>();
    private final BroadcastReceiver power=new BroadcastReceiver(){public void onReceive(Context c,Intent intent){
        if(Intent.ACTION_SCREEN_OFF.equals(intent.getAction())){if(!unlocked())pause();}
        else if(Intent.ACTION_USER_PRESENT.equals(intent.getAction()))resume();
    }};
    private record Panel(Display display,boolean inner,int w,int h,int rotation){}
    private record Anchor(WindowManager wm,View view,WallpaperManager wallpaper){}
    private static final class Layer {
        final WindowManager wm;final SnapshotView view;final SnapshotSurface root;final int displayId;final long serial;boolean committed;
        Layer(WindowManager wm,SnapshotView view,SnapshotSurface root,int displayId,long serial){this.wm=wm;this.view=view;this.root=root;this.displayId=displayId;this.serial=serial;}
    }
    private void trace(String message){stage=message;if(handoffs.size()>=32)handoffs.removeFirst();handoffs.addLast(SystemClock.elapsedRealtime()+":"+message);}
    private SurfaceControl[] excluded(){return layers.stream().map(l->l.root.getSurfaceControl()).filter(c->c!=null&&c.isValid()).toArray(SurfaceControl[]::new);}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){
        super.onCreate();uiLocales=getResources().getConfiguration().getLocales();running=true;status=UiText.of(R.string.preparing);
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("motion",getString(R.string.notification_channel),NotificationManager.IMPORTANCE_LOW));
        startForeground(7,notification(getString(R.string.starting)));
        displays=getSystemService(DisplayManager.class);displays.registerDisplayListener(this,main);
        IntentFilter filter=new IntentFilter(Intent.ACTION_SCREEN_OFF);filter.addAction(Intent.ACTION_USER_PRESENT);registerReceiver(power,filter,Context.RECEIVER_NOT_EXPORTED);
        BridgeConnection.init(this);
        poller.execute(this::pollAngles);
        main.post(health);
    }
    private void pollAngles(){
        if(stopped)return;
        List<Anchor> current=anchors;
        for(Anchor a:current)try{IBinder token=a.view.getWindowToken();if(token!=null)a.wallpaper.sendWallpaperCommand(token,BuildConfig.APPLICATION_ID+".READ_ANGLE",0,0,0,null);}catch(Exception ignored){}
        // Keep transition sampling unchanged; avoid 60 wake-ups/sec while idle or locked.
        if(!stopped)try{poller.schedule(this::pollAngles,current.isEmpty()?250:fastPolling?16:33,TimeUnit.MILLISECONDS);}catch(RejectedExecutionException ignored){}
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration config){
        super.onConfigurationChanged(config);
        if(config.getLocales().equals(uiLocales))return;
        uiLocales=config.getLocales();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("motion",getString(R.string.notification_channel),NotificationManager.IMPORTANCE_LOW));
        notificationText="";updateNotification();
        removeNavigation();updateNavigation();
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?"restore":intent.getAction();
        if("stop".equals(action)){MotionSettings.setEnabled(this,false);stopSelf();return START_NOT_STICKY;}
        if("restore".equals(action)&&!MotionSettings.enabled(this)){stopSelf();return START_NOT_STICKY;}
        MotionSettings.setEnabled(this,true);MotionSettings.recovery(this,"");
        if("restart".equals(action)){pause();recordRecovery(UiText.of(R.string.manual_restart));}
        resume();return START_STICKY;
    }
    private Notification notification(String text){
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,MotionService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent open=PendingIntent.getActivity(this,2,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent restart=PendingIntent.getService(this,3,new Intent(this,MotionService.class).setAction("restart"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"motion").setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle(getString(R.string.app_name)).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setOnlyAlertOnce(true).setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,getString(R.string.resume),restart).build()).addAction(new Notification.Action.Builder(null,getString(R.string.stop),stop).build()).build();
    }
    private void updateNotification(){
        String text=(status.is(R.string.angle_status)?UiText.of(layoutPrepared?R.string.active:R.string.close_fully_to_prepare):status).resolve(this);
        if(!text.equals(notificationText)){notificationText=text;getSystemService(NotificationManager.class).notify(7,notification(text));}
    }
    private void recordRecovery(UiText reason){recoveries++;lastRecovery=reason;MotionSettings.recovery(this,reason);}
    private boolean unlocked(){return getSystemService(PowerManager.class).isInteractive()&&!getSystemService(KeyguardManager.class).isKeyguardLocked();}
    private void resume(){
        if(stopped||!unlocked()) {paused=true;status=UiText.of(R.string.waiting_unlock);return;}
        if(!paused)return;
        paused=false;++sessionSerial;layoutPrepared=layoutPreparing=layoutRecovering=false;blockedUntilEndpoint=false;rebuildPanels();Panel primary=panelById(0);fixedPrimaryInner=primary!=null&&primary.inner;policy=new FoldPolicy(fixedPrimaryInner);target=smoothed=Float.NaN;source=-1;measuredAt=lastFrame=0;status=UiText.of(R.string.preparing_connection);
    }
    private void pause(){paused=true;++angleSession;cancelSession();removeAnchors();IShellBridge b=bound;bound=null;if(b!=null)controls.execute(()->{try{b.stopAngles();b.release();}catch(Exception ignored){}});status=UiText.of(R.string.waiting_unlock);}
    private final Runnable health=new Runnable(){public void run(){
        if(stopped)return;
        if(!paused&&!unlocked())pause();
        // Fold display changes can send SCREEN_OFF without a lock/unlock broadcast pair.
        if(paused&&unlocked())resume();
        if(!paused)BridgeConnection.connect(MotionService.this);
        IShellBridge available=BridgeConnection.bridge;
        if(!paused&&bound!=available){
            if(bound!=null){cancelSession();IShellBridge old=bound;controls.execute(()->{try{old.stopAngles();}catch(Exception ignored){}});recordRecovery(UiText.of(R.string.helper_recovery));}
            bound=available;++angleSession;source=-1;target=smoothed=Float.NaN;measuredAt=0;
            if(available!=null)startAngles(available);
        }
        if(available==null&&!paused)status=BridgeConnection.status;
        long now=SystemClock.elapsedRealtime();
        // Wallpaper reports are continuous; a dead log reader or heartbeat expiry can
        // stop them while the binder itself remains alive. Re-register, not just wait.
        if(!paused&&bound!=null&&now-angleStartedAt>5000&&((source==1&&now-measuredAt>1500)||source<1)){
            cancelSession();source=-1;target=smoothed=Float.NaN;measuredAt=0;blockedUntilEndpoint=false;
            removeAnchors();rebuildPanels();recordRecovery(UiText.of(R.string.angle_recovery));status=UiText.of(R.string.angle_retry);startAngles(bound);
        }
        if(!paused&&layoutPrepared)recoverLayoutIfNeeded();
        // Wallpaper reports are continuous. Only actual measurements can confirm
        // endpoint dwell; repeatedly replaying a stale report invented completion.
        // Fine direct sensors may be on-change, so a recent sample may be held briefly.
        if(!paused&&layoutPrepared&&source>=2&&now-measuredAt<=250&&policy!=null&&policy.active&&Float.isFinite(target))handle(policy.update(target,now));
        fastPolling=!paused&&(busy||finishing||policy!=null&&policy.active);
        updateNavigation();updateNotification();main.postDelayed(this,100);
    }};
    private void startAngles(IShellBridge bridge){
        angleStartedAt=SystemClock.elapsedRealtime();long session=++angleSession;
        IAngleSink sink=new IAngleSink.Stub(){public void angle(float value,long at,int kind){main.post(()->{if(session==angleSession&&bound==bridge)accept(value,at,kind);});}};
        // Serialize with pause/stop. Otherwise a late stopAngles from screen-off can
        // run AFTER wake-up's startAngles and silently leave a live binder with no sink.
        controls.execute(()->{try{bridge.startAngles(sink);}catch(Exception e){main.post(()->{if(!stopped&&bound==bridge){recordRecovery(UiText.of(R.string.angle_start_failed));status=UiText.of(R.string.angle_retry_error,UiText.error(e));}});}});
    }
    private void accept(float value,long at,int kind){
        if(stopped||paused||bound==null||!Float.isFinite(value)||value<0||value>180||at>SystemClock.elapsedRealtime()+50||SystemClock.elapsedRealtime()-at>600)return;
        if(kind==0){if(source<1)status=UiText.of(R.string.coarse_angles);return;}
        // Direct fine sensors take priority while active; wallpaper is the fallback.
        if(kind==1&&AngleSourcePolicy.suppressWallpaper(source,measuredAt,at))return;
        if(at<measuredAt)return;
        source=kind;measuredAt=at;target=value;
        acceptedAngles++;
        synchronized(angleHistory){if(angleHistory.size()>=160)angleHistory.removeFirst();angleHistory.addLast(at+":"+value+":"+kind);}
        if(blockedUntilEndpoint){if(SystemClock.elapsedRealtime()<retryAt||value>3&&value<177)return;blockedUntilEndpoint=false;policy=new FoldPolicy(value>=177);}if(!Float.isFinite(smoothed))smoothed=value;
        status=UiText.of(R.string.angle_status,Math.round(value),UiText.of(kind==1?R.string.source_wallpaper:kind==2?R.string.source_samsung:R.string.source_standard));
        if(!layoutPrepared){
            Panel primary=panelById(0);
            // Samsung cancels INNER_DEFAULT on complete closure. Arm OUTER_DEFAULT only
            // once the normal closed layout is present, avoiding a primary-panel swap.
            if(primary==null||primary.inner||primary.display.getState()!=Display.STATE_ON||value>3){status=UiText.of(R.string.close_to_prepare);return;}
            if(!layoutPreparing){fixedPrimaryInner=false;prepareLayout();}return;
        }
        if(policy!=null)handle(policy.update(value,at));scheduleFrame();
    }
    private void prepareLayout(){
        int ticket=++generation;layoutPreparing=true;trace("prepare-stable-panels");IShellBridge bridge=bound;
        // Retain the currently active physical mapping. Adding the other panel does not swap
        // logical display IDs, which otherwise forces Samsung's mapper through DISPLAY_OFF.
        controls.execute(()->{try{
            if(ticket!=generation||stopped||bridge==null)return;
            Bundle result=bridge.hold(fixedPrimaryInner,MotionSettings.ownerPid(this));if(!result.getBoolean("ok"))throw new IllegalStateException(result.getString("error"));MotionSettings.ownerPid(this,result.getInt("ownerPid"));
            main.post(()->awaitLayout(ticket,0));
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.prepare_failed,UiText.error(e)));});}});
    }
    private void awaitLayout(int ticket,int attempt){
        if(stopped||ticket!=generation)return;rebuildPanels();Panel primary=panelById(0);
        if(findPanel(true,true)==null||findPanel(false,true)==null||primary==null||primary.inner!=fixedPrimaryInner){
            if(attempt>=35){fail(UiText.of(R.string.prepare_unconfirmed));return;}
            main.postDelayed(()->awaitLayout(ticket,attempt+1),40);return;
        }
        layoutPrepared=true;layoutPreparing=false;policy=new FoldPolicy(Float.isFinite(target)?target>=90:fixedPrimaryInner);trace("stable-panels-ready");
    }
    private void recoverLayoutIfNeeded(){
        if(stopped||paused||!layoutPrepared||layoutRecovering||bound==null)return;
        if(findPanel(true,true)!=null&&findPanel(false,true)!=null)return;
        Panel primary=panelById(0);
        // Full closure cancels even OUTER_DEFAULT on this firmware. Re-add the inner
        // panel while the cover still owns display 0; never swap a lit primary panel.
        if(primary==null||primary.inner||primary.display.getState()!=Display.STATE_ON)return;
        layoutRecovering=true;int session=sessionSerial;IShellBridge bridge=bound;trace("rearming-after-display-release");
        controls.execute(()->{try{
            if(stopped||session!=sessionSerial)return;
            Bundle result=bridge.hold(false,MotionSettings.ownerPid(this));if(!result.getBoolean("ok"))throw new IllegalStateException(result.getString("error"));MotionSettings.ownerPid(this,result.getInt("ownerPid"));
            main.post(()->awaitRecoveredLayout(session,0));
        }catch(Exception e){main.post(()->{if(session==sessionSerial&&!stopped){layoutRecovering=false;fail(UiText.of(R.string.reprepare_failed,UiText.error(e)));}});}});
    }
    private void awaitRecoveredLayout(int session,int attempt){
        if(stopped||session!=sessionSerial)return;rebuildPanels();Panel primary=panelById(0);
        if(primary!=null&&!primary.inner&&findPanel(true,true)!=null&&findPanel(false,true)!=null){layoutRecovering=false;trace("display-request-rearmed");return;}
        if(attempt>=35){layoutRecovering=false;fail(UiText.of(R.string.relight_unconfirmed));return;}
        main.postDelayed(()->awaitRecoveredLayout(session,attempt+1),40);
    }
    private void handle(FoldPolicy.Change change){
        fastPolling=busy||finishing||policy!=null&&policy.active;
        switch(change){case OPEN -> transition(true);case CLOSE -> transition(false);case FINISH_OPEN,FINISH_CLOSED -> finish();default -> {}}
    }
    private void transition(boolean opening){
        removeNavigation();
        // Finish the already-issued transfer before reversing it. Otherwise an
        // opposite-direction callback could transfer the other panel's unrelated app.
        if(!directionQueue.request(opening))return;
        int ticket=++generation;busy=true;finishing=false;for(Layer layer:layers){layer.root.animate().cancel();layer.root.setAlpha(1);}
        trace(opening?"opening-capture":"closing-capture");
        // Hide only icons (not inset sources), before taking the frozen image. A pair of
        // frames lets both SystemUI and the dismissed controls leave composition.
        IShellBridge bridge=bound;
        controls.execute(()->{try{
            if(stopped||ticket!=generation||bridge==null)return;
            Bundle result=bridge.statusIcons(true);
            if(!result.getBoolean("ok"))throw new IllegalStateException(result.getString("error"));
            main.post(()->main.postDelayed(()->captureSource(ticket,opening),34));
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.status_icons_failed,UiText.error(e)));});}});
    }
    private void captureSource(int ticket,boolean opening){
        if(stopped||ticket!=generation)return;
        boolean outgoingInner=!opening;Panel outgoing=findPanel(outgoingInner,false);FrameTexture cached=frozen.get(outgoingInner);
        if(outgoing==null){fail(UiText.of(R.string.source_missing));return;}
        IShellBridge bridge=bound;if(bridge==null){fail(UiText.of(R.string.bridge_missing));return;}
        int displayId=outgoing.display.getDisplayId();SurfaceControl[] exclude=excluded();float density=getResources().getDisplayMetrics().density;
        jobs.execute(()->{
            try{
                if(stopped||ticket!=generation)return;
                FrameTexture frame=cached;
                if(frame==null){Bundle result=bridge.captureBehind(displayId,exclude);Bitmap bitmap=result.getParcelable("frame",Bitmap.class);if(bitmap==null)throw new IllegalStateException(result.getString("error","@folduo/capture_failed"));frame=FrameTexture.sharp(bitmap);}
                FrameTexture ready=frame;
                if(!frame.prepared)main.post(()->{
                    if(ticket!=generation||stopped)return;
                    addLayer(outgoing,ready,true,ticket,()->trace("source-frame-committed"));
                });
                FrameTexture texture=frame.prepared?frame:FrameTexture.prepare(frame.sharp,density,()->stopped||ticket!=generation);
                main.post(()->{
                    if(ticket!=generation||stopped||texture==null)return;frozen.put(outgoingInner,texture);
                    // The source starts deforming only after real blur levels are available.
                    controls.execute(()->{try{
                        if(ticket!=generation||stopped)return;
                        Bundle hidden=bridge.statusIcons(true);if(!hidden.getBoolean("ok"))throw new IllegalStateException(hidden.getString("error"));
                        main.post(()->{if(ticket==generation&&!stopped)addLayer(outgoing,texture,false,ticket,()->{trace("source-frost-committed");requestDisplays(ticket,opening);});});
                    }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.status_icons_failed,UiText.error(e)));});}});
                });
            }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.transition_cancelled,UiText.error(e)));});}
        });
    }
    private void requestDisplays(int ticket,boolean opening){requestDisplays(ticket,opening,0);}
    private void requestDisplays(int ticket,boolean opening,int attempt){
        if(ticket!=generation||stopped)return;IShellBridge bridge=bound;trace("source-covered-move-app");
        Panel source=findPanel(!opening,true),destination=findPanel(opening,true);
        if(source==null||destination==null){
            recoverLayoutIfNeeded();
            if(attempt>=35){fail(UiText.of(R.string.reprepare_timeout));return;}
            main.postDelayed(()->requestDisplays(ticket,opening,attempt+1),40);return;
        }
        FrameTexture cached=frozen.get(opening),outgoing=frozen.get(!opening);
        if(outgoing==null||!outgoing.prepared){fail(UiText.of(R.string.blur_unconfirmed));return;}
        // Cover the destination BEFORE moving the real app. Never expose its sharp
        // resized layout during capture/blur preparation, even for a single frame.
        jobs.execute(()->{try{
            if(ticket!=generation||stopped)return;
            FrameTexture cover=cached!=null?cached:outgoing.transfer(!opening,destination.w,destination.h);
            main.post(()->{
                if(ticket!=generation||stopped)return;
                addLayer(destination,cover,false,ticket,()->{
                    trace("destination-covered-move-app");moveCoveredApp(ticket,opening,source,destination);
                });
            });
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.cover_failed,UiText.error(e)));});}});
    }
    private void moveCoveredApp(int ticket,boolean opening,Panel source,Panel destination){
        IShellBridge bridge=bound;
        controls.execute(()->{try{
            if(ticket!=generation||stopped||bridge==null)return;
            Bundle result=bridge.moveApp(source.display.getDisplayId(),destination.display.getDisplayId(),false);
            if(!result.getBoolean("ok"))throw new IllegalStateException(result.getString("error"));
            main.post(()->{if(ticket==generation){expectedTaskId=result.getInt("taskId",-1);trace("app-moved-without-display-swap task="+expectedTaskId);awaitPanels(ticket,opening,0);}});
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.handoff_failed,UiText.error(e)));});}});
    }
    private void awaitPanels(int ticket,boolean opening,int attempt){
        if(stopped||ticket!=generation)return;
        rebuildPanels();Panel outgoing=findPanel(!opening,true),incoming=findPanel(opening,true);Panel primary=panelById(0);
        if(outgoing==null||incoming==null||primary==null||primary.inner!=fixedPrimaryInner){
            if(attempt>=35){fail(UiText.of(R.string.displays_unconfirmed));return;}
            main.postDelayed(()->awaitPanels(ticket,opening,attempt+1),40);return;
        }
        trace("both-panels-ready");
        // Both panels already have an opaque, frosted cover. Capture excludes those
        // owned surfaces without hiding them. A reversal can reuse the session's frame.
        if(frozen.get(opening)!=null){awaitApp(ticket,incoming,this::pairedFramesReady);return;}
        awaitApp(ticket,incoming,()->captureDestination(ticket,opening));
    }
    private void pairedFramesReady(){
        linkFrames();busy=false;trace("paired-frames-ready");
        Boolean next=directionQueue.complete();
        if(next!=null){transition(next);return;}
        scheduleFrame();
        if(policy!=null&&!policy.active)finish();
    }
    private void awaitApp(int ticket,Panel panel,Runnable ready){
        IShellBridge bridge=bound;int expectedTask=expectedTaskId;
        jobs.execute(()->{try{
            long deadline=SystemClock.elapsedRealtime()+1800;FrameReadiness readiness=new FrameReadiness(expectedTask);
            while(!stopped&&ticket==generation&&SystemClock.elapsedRealtime()<deadline){
                Bundle state=bridge.windowState(panel.display.getDisplayId());String geometry=state.getString("geometry","");
                if(readiness.accept(state.getBoolean("ready"),geometry,state.getInt("taskId",-1))){main.post(()->{if(ticket==generation&&!stopped){trace("app-frame-ready task="+expectedTask);ready.run();}});return;}
                Thread.sleep(32);
            }
            main.post(()->{if(ticket==generation)fail(UiText.of(R.string.app_ready_timeout));});
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.readiness_failed,UiText.error(e)));});}});
    }
    private void captureDestination(int ticket,boolean opening){
        Panel incoming=findPanel(opening,true);if(incoming==null){fail(UiText.of(R.string.destination_missing));return;}
        int id=incoming.display.getDisplayId();IShellBridge bridge=bound;SurfaceControl[] exclude=excluded();float density=getResources().getDisplayMetrics().density;
        jobs.execute(()->{try{
            if(stopped||ticket!=generation)return;
            // Our freeze stays visible. Exclude its owned surfaces from this capture only.
            Bundle result=bridge.captureBehind(id,exclude);Bitmap bitmap=result.getParcelable("frame",Bitmap.class);
            if(bitmap==null)throw new IllegalStateException(result.getString("error","@folduo/destination_capture_failed"));
            if(bitmap.getWidth()!=incoming.w||bitmap.getHeight()!=incoming.h)throw new IllegalStateException("@folduo/destination_resizing");
            FrameTexture texture=FrameTexture.prepare(bitmap,density,()->ticket!=generation||stopped);
            main.post(()->{if(ticket!=generation||stopped||texture==null)return;frozen.put(opening,texture);Panel destination=findPanel(opening,true);if(destination!=null)addLayer(destination,texture,false,ticket,this::pairedFramesReady);});
        }catch(Exception e){main.post(()->{if(ticket==generation)fail(UiText.of(R.string.destination_failed,UiText.error(e)));});}});
    }
    private void addLayer(Panel panel,FrameTexture frame,boolean sharpHold,int ticket,Runnable ready){
        if(frame==null)return;
        try{
            Context context=createDisplayContext(panel.display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null);
            WindowManager wm=context.getSystemService(WindowManager.class);
            SnapshotView view=new SnapshotView(context,frame,panel.inner,false);view.logicalWidth=panel.w;view.setSharpHold(sharpHold);
            if(!panel.inner)view.setRearFrame(frozen.get(true),false);
            Layer[] created=new Layer[1];SnapshotSurface root=new SnapshotSurface(context,view,()->main.post(()->{
                Layer layer=created[0];if(ticket!=generation||stopped||!layers.contains(layer))return;
                // A late callback from an older frame must not remove its successor.
                if(layers.stream().anyMatch(l->l.displayId==layer.displayId&&l.serial>layer.serial&&l.committed)){removeLayer(layer);return;}
                layer.committed=true;
                for(Layer old:new ArrayList<>(layers))if(old.displayId==layer.displayId&&old.serial<layer.serial)removeLayer(old);
                ready.run();
            }));
            WindowManager.LayoutParams lp=snapshotLayout();
            Layer layer=new Layer(wm,view,root,panel.display.getDisplayId(),++layerSerial);created[0]=layer;layers.add(layer);
            wm.addView(root,lp);view.setAngle(Float.isFinite(smoothed)?smoothed:target);
            // A missing frame callback must never leave a permanent frozen screen.
            main.postDelayed(()->{if(ticket==generation&&layers.contains(layer)&&!layer.committed)fail(UiText.of(R.string.frozen_draw_failed));},1400);
        }catch(Exception e){fail(UiText.of(R.string.overlay_failed,UiText.error(e)));}
    }
    private void linkFrames(){
        FrameTexture inner=frozen.get(true);
        if(inner!=null)for(Layer layer:layers)if(!layer.view.inner)layer.view.setRearFrame(inner,true);
    }
    static WindowManager.LayoutParams snapshotLayout(){
        WindowManager.LayoutParams lp=layout(WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.MATCH_PARENT);
        // Android caps non-touchable APPLICATION_OVERLAY windows to alpha 0.8. A
        // frozen image must instead consume touches until removal, keeping alpha 1.
        // The angle-only anchors remain non-touchable and transparent below.
        lp.alpha=1;lp.setTitle("Folduo fold snapshot");lp.preferredRefreshRate=120;lp.windowAnimations=0;return lp;
    }
    private static WindowManager.LayoutParams layout(int w,int h){
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams(w,h,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN|WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,PixelFormat.TRANSLUCENT);
        lp.gravity=Gravity.TOP|Gravity.LEFT;lp.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;lp.setFitInsetsTypes(0);return lp;
    }
    private void scheduleFrame(){if(!frameScheduled&&!stopped&&!paused){frameScheduled=true;Choreographer.getInstance().postFrameCallback(this);}}
    @Override public void doFrame(long nanos){
        frameScheduled=false;if(stopped||paused||finishing||!Float.isFinite(target))return;
        float dt=lastFrame==0?1/80f:(nanos-lastFrame)/1e9f;lastFrame=nanos;
        smoothed=FoldPolicy.smooth(smoothed,target,dt);if(Math.abs(smoothed-target)<.015f)smoothed=target;
        for(Layer layer:layers)layer.view.setAngle(smoothed);
        if(smoothed!=target)scheduleFrame();
    }
    private void finish(){finishWhenReady(generation,0);}
    private void finishWhenReady(int expected,int attempt){
        if(stopped||expected!=generation||finishing)return;
        if(busy){if(attempt>=100){fail(UiText.of(R.string.move_timeout));return;}main.postDelayed(()->finishWhenReady(expected,attempt+1),40);return;}
        int ticket=++generation;busy=false;finishing=true;boolean inner=policy.open;float endpoint=inner?180:0;
        trace("endpoint-covering");
        for(Layer layer:layers){layer.view.setSharpHold(false);layer.view.setAngle(endpoint);}
        Layer cover=layers.stream().filter(l->l.committed&&l.view.inner==inner).findFirst().orElse(null);
        java.util.concurrent.atomic.AtomicBoolean revealed=new java.util.concurrent.atomic.AtomicBoolean();
        Runnable reveal=()->{if(!revealed.compareAndSet(false,true))return;awaitFinal(ticket,inner,0);};
        if(cover!=null)cover.view.afterFrame(()->main.post(()->{if(ticket==generation){trace("endpoint-frame-committed");reveal.run();}}));
        else reveal.run();
        main.postDelayed(()->{if(ticket==generation)reveal.run();},500);
    }
    private void awaitFinal(int ticket,boolean inner,int attempt){
        if(stopped||ticket!=generation)return;rebuildPanels();Panel destination=findPanel(inner,true);
        if(destination==null){if(attempt>=35){fail(UiText.of(R.string.app_destination_unconfirmed));return;}main.postDelayed(()->awaitFinal(ticket,inner,attempt+1),40);return;}
        awaitApp(ticket,destination,()->{
            trace("handoff-with-stable-panels");
            for(Layer layer:layers)layer.root.animate().alpha(0).setDuration(180).setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator()).start();
            main.postDelayed(()->{if(ticket!=generation)return;removeLayers();frozen.clear();finishing=false;smoothed=target;restoreStatusIcons();trace("idle");updateNavigation();},200);
        });
    }
    private void cancelSession(){
        ++generation;++sessionSerial;busy=false;finishing=false;directionQueue.reset();expectedTaskId=-1;layoutPrepared=layoutPreparing=layoutRecovering=false;removeNavigation();removeLayers();frozen.clear();
        if(policy!=null)policy.active=false;
        IShellBridge bridge=bound;if(bridge!=null)controls.execute(()->{try{bridge.release();}catch(Exception ignored){}});
    }
    private void restoreStatusIcons(){IShellBridge bridge=bound;if(bridge!=null)controls.execute(()->{try{bridge.statusIcons(false);}catch(Exception ignored){}});}
    private void updateNavigation(){
        Panel inner=findPanel(true,true);
        boolean show=!stopped&&!paused&&layoutPrepared&&!busy&&!finishing&&policy!=null&&!policy.active&&target>=176&&inner!=null&&inner.display.getDisplayId()==1;
        if(!show){removeNavigation();return;}
        if(navigation!=null&&navigation.width==inner.w&&navigation.height==inner.h)return;
        removeNavigation();
        try{
            Context context=createDisplayContext(inner.display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null);
            navigation=new InnerNavigation(context,1,inner.w,inner.h,this::navigate);
        }catch(Exception e){navigationError=ShellBridge.message(e);}
    }
    private void navigate(int action,int taskId){
        IShellBridge bridge=bound;InnerNavigation owner=navigation;int session=sessionSerial,ticket=generation,request=++navigationRequest;
        if(bridge==null||owner==null||busy||finishing)return;
        controls.execute(()->{try{
            if(stopped||session!=sessionSerial||ticket!=generation||action==KeyEvent.KEYCODE_APP_SWITCH&&request!=navigationRequest)return;
            Bundle result=bridge.navigate(owner.displayId,action,taskId);
            main.post(()->{
                if(stopped||session!=sessionSerial||ticket!=generation||navigation!=owner||request!=navigationRequest)return;
                if(!result.getBoolean("ok")){navigationError=result.getString("error");android.widget.Toast.makeText(this,getString(R.string.navigation_failed,UiText.raw(navigationError).resolve(this)),android.widget.Toast.LENGTH_SHORT).show();return;}
                navigationError="";
                if(action==KeyEvent.KEYCODE_APP_SWITCH){
                    ArrayList<Bundle> apps=result.getParcelableArrayList("apps",Bundle.class);
                    owner.showRecent(apps==null?List.of():apps);
                    if(apps!=null)loadRecentPreviews(owner,apps,session);
                }
            });
        }catch(Exception e){main.post(()->{if(session==sessionSerial&&ticket==generation&&navigation==owner&&request==navigationRequest)navigationError=ShellBridge.message(e);});}});
    }
    private void loadRecentPreviews(InnerNavigation owner,List<Bundle> apps,int session){
        loadRecentPreview(owner,apps,session,owner.revision(),0);
    }
    private boolean previewCurrent(InnerNavigation owner,int session,int revision){
        return !stopped&&session==sessionSerial&&navigation==owner&&owner.showingRecents()&&owner.revision()==revision;
    }
    private void loadRecentPreview(InnerNavigation owner,List<Bundle> apps,int session,int revision,int index){
        if(index>=apps.size()||!previewCurrent(owner,session,revision))return;
        IShellBridge bridge=bound;
        // Enqueue one thumbnail at a time. HOME/BACK and display transfers queued
        // during a capture run before the next thumbnail, without a second binder race.
        controls.execute(()->{
            if(!previewCurrent(owner,session,revision))return;
            Bitmap image=null;int task=apps.get(index).getInt("taskId",-1);
            try{image=bridge.navigate(owner.displayId,InnerNavigation.PREVIEW,task).getParcelable("preview",Bitmap.class);}
            catch(Exception ignored){} // Protected/unavailable previews retain the icon.
            Bitmap ready=image;
            main.post(()->{
                if(!previewCurrent(owner,session,revision))return;
                if(ready!=null)owner.setPreview(task,ready);
                loadRecentPreview(owner,apps,session,revision,index+1);
            });
        });
    }
    private void removeNavigation(){if(navigation!=null){try{navigation.close();}catch(Exception ignored){}navigation=null;}}
    private void fail(UiText reason){trace("cancelled: "+reason.resolve(this));cancelSession();blockedUntilEndpoint=true;retryAt=SystemClock.elapsedRealtime()+2000;recordRecovery(reason);status=UiText.of(R.string.failure_retry,reason);}
    private Panel panelById(int id){for(Panel p:panels)if(p.display.getDisplayId()==id)return p;return null;}
    private Panel findPanel(boolean inner,boolean on){for(Panel p:panels)if(p.inner==inner&&(!on||p.display.getState()==Display.STATE_ON))return p;return null;}
    private void rebuildPanels(){
        if(stopped||paused)return;
        List<Panel> discovered=new ArrayList<>();StringBuilder signature=new StringBuilder();
        for(Display display:displays.getDisplays()){
            if(display.getDisplayId()>1)continue; // Fold7 built-in logical displays only.
            // getRealSize can inherit the process activity's max bounds after that activity
            // moves to the secondary panel. Mode dimensions remain tied to this display.
            Display.Mode mode=display.getMode();int rotation=display.getRotation();
            boolean rotated=rotation==Surface.ROTATION_90||rotation==Surface.ROTATION_270;
            Point size=new Point(rotated?mode.getPhysicalHeight():mode.getPhysicalWidth(),rotated?mode.getPhysicalWidth():mode.getPhysicalHeight());if(size.x<=0||size.y<=0)continue;
            boolean inner=Math.min(size.x,size.y)/(float)Math.max(size.x,size.y)>.7f;
            discovered.add(new Panel(display,inner,size.x,size.y,rotation));signature.append(display.getDisplayId()).append(':').append(size.x).append(':').append(size.y).append(':').append(rotation).append(':').append(display.getState()).append(';');
        }
        boolean geometryChanged=discovered.stream().anyMatch(next->panels.stream().anyMatch(previous->
            previous.display.getDisplayId()==next.display.getDisplayId()&&(previous.inner!=next.inner||previous.w!=next.w||previous.h!=next.h||previous.rotation!=next.rotation)));
        panels.clear();panels.addAll(discovered);
        if(geometryChanged&&(busy||finishing||!layers.isEmpty()))fail(UiText.of(R.string.display_geometry_changed));
        if(panelSignature.equals(signature.toString())&&!anchors.isEmpty())return;
        panelSignature=signature.toString();
        // Window contexts may stay attached to logical display IDs across a physical swap.
        removeAnchors();List<Anchor> next=new ArrayList<>();
        if(Settings.canDrawOverlays(this))for(Panel panel:panels){
            if(panel.display.getState()!=Display.STATE_ON)continue;
            try{
                Context context=createDisplayContext(panel.display).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,null);
                WindowManager wm=context.getSystemService(WindowManager.class);View view=new View(context);view.setBackgroundColor(Color.TRANSPARENT);
                WindowManager.LayoutParams lp=layout(WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.MATCH_PARENT);lp.flags|=WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE|WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER;lp.alpha=.01f;lp.setTitle("Folduo angle anchor");
                wm.addView(view,lp);next.add(new Anchor(wm,view,WallpaperManager.getInstance(context)));
            }catch(Exception e){anchorError=ShellBridge.message(e);}
        }
        anchors=List.copyOf(next);
    }
    private void removeAnchors(){List<Anchor> previous=anchors;anchors=List.of();for(Anchor a:previous)try{a.wm.removeViewImmediate(a.view);}catch(Exception ignored){}}
    private void removeLayer(Layer layer){layers.remove(layer);layer.root.animate().cancel();try{layer.wm.removeViewImmediate(layer.root);}catch(Exception ignored){}}
    private void removeLayers(){for(Layer layer:new ArrayList<>(layers))removeLayer(layer);}
    @Override protected void dump(FileDescriptor fd,PrintWriter out,String[] args){
        out.println("running="+running+" paused="+paused+" unlocked="+unlocked()+" status="+status.resolve(this));
        out.println("enabled="+MotionSettings.enabled(this)+" recoveries="+recoveries+" lastRecovery="+lastRecovery.resolve(this));
        out.println("source="+source+" target="+target+" smoothed="+smoothed+" ageMs="+(SystemClock.elapsedRealtime()-measuredAt)+" accepted="+acceptedAngles);
        out.println("busy="+busy+" blocked="+blockedUntilEndpoint+" panels="+panelSignature+" anchors="+anchors.size()+" layers="+layers.size()+" anchorError="+anchorError);
        out.println("fixedPrimaryInner="+fixedPrimaryInner+" layoutPrepared="+layoutPrepared+" layoutPreparing="+layoutPreparing+" layoutRecovering="+layoutRecovering);
        out.println("innerNavigation="+(navigation!=null)+" navigationError="+navigationError);
        out.println("version="+BuildConfig.VERSION_NAME+" expectedTask="+expectedTaskId);
        out.println("stage="+stage+" history="+String.join(",",handoffs));
        synchronized(angleHistory){out.println("angles="+String.join(",",angleHistory));}
        IShellBridge bridge=bound;if(bridge!=null)try{Bundle report=bridge.inspect();out.println("statusIconsHidden="+report.getBoolean("statusIconsHidden"));out.println(MainActivity.formatReport(this,report));}catch(Exception e){out.println(ShellBridge.message(e));}
    }
    public void onDisplayAdded(int id){rebuildPanels();recoverLayoutIfNeeded();}public void onDisplayRemoved(int id){rebuildPanels();recoverLayoutIfNeeded();}public void onDisplayChanged(int id){rebuildPanels();recoverLayoutIfNeeded();}
    @Override public void onDestroy(){
        stopped=true;running=false;status=UiText.of(R.string.stopped);main.removeCallbacksAndMessages(null);Choreographer.getInstance().removeFrameCallback(this);
        displays.unregisterDisplayListener(this);unregisterReceiver(power);cancelSession();removeAnchors();poller.shutdownNow();
        IShellBridge bridge=bound;bound=null;controls.execute(()->{try{if(bridge!=null){bridge.stopAngles();bridge.release();}}catch(Exception ignored){}});jobs.shutdown();controls.shutdown();BridgeConnection.disconnect();super.onDestroy();
    }
}
