package jp.bunkaich.sukashimotion;

import android.graphics.Bitmap;
import java.util.function.BooleanSupplier;

/** Creates a small, dense Gaussian pyramid once per content revision, off the UI thread. */
final class BlurCache {
    static final float[] LEVELS={1,2,4,12,28,60};
    static Bitmap[] build(Bitmap source,float pixelsPerDp,BooleanSupplier cancelled){
        if(cancelled.getAsBoolean())return null;
        int w=source.getWidth(),h=source.getHeight();int[] pixels=new int[w*h],scratch=new int[w*h];
        source.getPixels(pixels,0,w,0,0,w,h);Bitmap[] result=new Bitmap[LEVELS.length];float previous=0;
        for(int level=0;level<LEVELS.length;level++){
            if(cancelled.getAsBoolean()){recycle(result);return null;}
            float sigma=(float)Math.sqrt(LEVELS[level]*LEVELS[level]-previous*previous)*pixelsPerDp;
            int lower=(int)Math.floor(Math.sqrt(4*sigma*sigma+1));if((lower&1)==0)lower--;lower=Math.max(1,lower);
            int higher=lower+2;int count=Math.round((12*sigma*sigma-3*lower*lower-12*lower-9f)/(-4*lower-4));
            for(int pass=0;pass<3;pass++){
                if(cancelled.getAsBoolean()){recycle(result);return null;}
                int radius=((pass<count?lower:higher)-1)/2;
                horizontal(pixels,scratch,w,h,radius);vertical(scratch,pixels,w,h,radius);
            }
            result[level]=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);result[level].prepareToDraw();previous=LEVELS[level];
        }
        if(cancelled.getAsBoolean()){recycle(result);return null;}
        return result;
    }
    /** Only call on unpublished, privately owned blur levels. Never on a visible frame. */
    static void recycle(Bitmap[] levels){if(levels!=null)for(Bitmap level:levels)if(level!=null)level.recycle();}
    // The captured display is opaque, so alpha stays 255 throughout.
    static void horizontal(int[] in,int[] out,int w,int h,int r){
        int div=2*r+1;
        for(int y=0;y<h;y++){int row=y*w,red=0,green=0,blue=0;
            for(int k=-r;k<=r;k++){int c=in[row+Math.max(0,Math.min(w-1,k))];red+=(c>>16)&255;green+=(c>>8)&255;blue+=c&255;}
            for(int x=0;x<w;x++){out[row+x]=0xff000000|((red+div/2)/div<<16)|((green+div/2)/div<<8)|(blue+div/2)/div;
                int add=in[row+Math.min(w-1,x+r+1)],remove=in[row+Math.max(0,x-r)];red+=((add>>16)&255)-((remove>>16)&255);green+=((add>>8)&255)-((remove>>8)&255);blue+=(add&255)-(remove&255);}
        }
    }
    static void vertical(int[] in,int[] out,int w,int h,int r){
        int div=2*r+1;
        for(int x=0;x<w;x++){int red=0,green=0,blue=0;
            for(int k=-r;k<=r;k++){int c=in[Math.max(0,Math.min(h-1,k))*w+x];red+=(c>>16)&255;green+=(c>>8)&255;blue+=c&255;}
            for(int y=0;y<h;y++){out[y*w+x]=0xff000000|((red+div/2)/div<<16)|((green+div/2)/div<<8)|(blue+div/2)/div;
                int add=in[Math.min(h-1,y+r+1)*w+x],remove=in[Math.max(0,y-r)*w+x];red+=((add>>16)&255)-((remove>>16)&255);green+=((add>>8)&255)-((remove>>8)&255);blue+=(add&255)-(remove&255);}
        }
    }
}
