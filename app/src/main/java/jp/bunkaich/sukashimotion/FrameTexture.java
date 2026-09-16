package jp.bunkaich.sukashimotion;

import android.graphics.*;
import java.util.function.BooleanSupplier;

/** Built off the UI thread; textures stay immutable while the GPU uses them. */
final class FrameTexture {
    final Bitmap sharp;final Bitmap[] levels;final boolean prepared;
    FrameTexture(Bitmap bitmap,Bitmap[] levels,boolean prepared){sharp=bitmap;this.levels=levels;this.prepared=prepared;}
    static FrameTexture sharp(Bitmap input){
        // Hardware bitmaps can be drawn directly; do not wait for CPU blur before covering a swap.
        input.prepareToDraw();Bitmap[] levels=new Bitmap[BlurCache.LEVELS.length];java.util.Arrays.fill(levels,input);return new FrameTexture(input,levels,false);
    }
    static FrameTexture prepare(Bitmap input,float density,BooleanSupplier cancelled){
        if(cancelled.getAsBoolean())return null;
        Bitmap sharp=input.getConfig()==Bitmap.Config.HARDWARE?input.copy(Bitmap.Config.ARGB_8888,false):input;
        if(sharp==null)return null;
        if(cancelled.getAsBoolean()){if(sharp!=input)sharp.recycle();return null;}
        float scale=Math.min(.25f,640f/Math.max(sharp.getWidth(),sharp.getHeight()));
        Bitmap small=Bitmap.createScaledBitmap(sharp,Math.max(1,Math.round(sharp.getWidth()*scale)),Math.max(1,Math.round(sharp.getHeight()*scale)),true);
        Bitmap[] levels=BlurCache.build(small,density*scale,cancelled);
        if(small!=sharp)small.recycle();
        if(levels==null||cancelled.getAsBoolean()){
            BlurCache.recycle(levels);if(sharp!=input)sharp.recycle();return null;
        }
        sharp.prepareToDraw();return new FrameTexture(sharp,levels,true);
    }
    /** Opaque temporary destination made only from the current app. Replace with a real
     * destination capture before handoff. Never use another app or a wallpaper as filler. */
    FrameTexture transfer(boolean sourceInner,int width,int height){
        if(!prepared)throw new IllegalStateException("Frost textures are not ready");
        Bitmap mapped=map(sharp,sourceInner,width,height);Bitmap[] blurred=new Bitmap[levels.length];
        float scale=levels[0].getHeight()/(float)sharp.getHeight();
        for(int i=0;i<levels.length;i++)blurred[i]=map(levels[i],sourceInner,Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
        return new FrameTexture(mapped,blurred,true);
    }
    private static Bitmap map(Bitmap input,boolean sourceInner,int w,int h){
        Bitmap result=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(result);Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);
        if(sourceInner)canvas.drawBitmap(input,new Rect(input.getWidth()/2,0,input.getWidth(),input.getHeight()),new Rect(0,0,w,h),paint);
        else{canvas.drawBitmap(input,null,new Rect(0,0,w/2,h),paint);canvas.drawBitmap(input,null,new Rect(w/2,0,w,h),paint);}
        result.prepareToDraw();return result;
    }
}
