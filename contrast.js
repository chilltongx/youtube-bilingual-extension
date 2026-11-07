(() => {
  const SHADOW='0 1px 2px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.85), 1px 1px 1px rgba(0,0,0,.75)';
  class AdaptiveContrast {
    constructor(){this.canvas=document.createElement('canvas');this.canvas.width=128;this.canvas.height=72;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.last=0;this.darkSince=null;this.active=false;this.source=null;this.blockedUntil=0;}
    clear(player){this.active=false;this.darkSince=null;player?.style.removeProperty('--ct-subtitle-shadow');if(player)player.dataset.ctContrast='off';}
    update(player,video,elements,enabled,now=performance.now()){
      if(!enabled){this.clear(player);return;}
      if(video!==this.source || video?.currentSrc!==this.src){this.clear(player);this.source=video;this.src=video?.currentSrc;this.last=-Infinity;this.blockedUntil=0;this.canvas.width=128;}
      if(!video || video.readyState<2 || !video.videoWidth || !this.ctx || now-this.last<250 || now<this.blockedUntil)return;
      this.last=now;
      const vr=video.getBoundingClientRect();if(!vr.width||!vr.height)return;
      // Map subtitle screen rectangles onto the actual video image, excluding letterboxing.
      const fit=getComputedStyle(video).objectFit;
      const scale=(fit==='cover'?Math.max:Math.min)(vr.width/video.videoWidth,vr.height/video.videoHeight);
      const width=fit==='fill'?vr.width:video.videoWidth*scale,height=fit==='fill'?vr.height:video.videoHeight*scale;
      const left=vr.left+(vr.width-width)/2,top=vr.top+(vr.height-height)/2;
      const regions=elements.filter(e=>e?.textContent?.trim()&&e.getClientRects().length).map(e=>e.getBoundingClientRect()).map(r=>({x:Math.max(0,(r.left-left)/width*128),y:Math.max(0,(r.top-top)/height*72),right:Math.min(128,(r.right-left)/width*128),bottom:Math.min(72,(r.bottom-top)/height*72)})).filter(r=>r.right>r.x&&r.bottom>r.y);
      if(!regions.length){this.clear(player);return;}
      try{
        this.ctx.drawImage(video,0,0,128,72);
        const pixels=this.ctx.getImageData(0,0,128,72).data;
        let bright=false,definitelyDark=true;
        for(const r of regions){
          let sum=0,lit=0,count=0;
          for(let y=Math.floor(r.y);y<Math.ceil(r.bottom);y++)for(let x=Math.floor(r.x);x<Math.ceil(r.right);x++){
            const i=(y*128+x)*4,l=(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])/255;
            sum+=l;lit+=l>.65?1:0;count++;
          }
          const mean=sum/count,fraction=lit/count;
          bright ||= mean>=.62 || fraction>=.28;
          definitelyDark &&= mean<.48 && fraction<.14;
        }
        if(bright){this.active=true;this.darkSince=null;}
        else if(this.active&&definitelyDark){if(this.darkSince===null)this.darkSince=now;if(now-this.darkSince>=650)this.active=false;}
        else this.darkSince=null;
        player.style.setProperty('--ct-subtitle-shadow',this.active?SHADOW:'none');
        player.dataset.ctContrast=this.active?'bright':'dark';
      }catch(error){
        // Do not change playback/CORS settings or request screen-capture permissions.
        this.clear(player);player.dataset.ctContrast='unavailable';this.blockedUntil=now+5000;this.canvas.width=128;
      }
    }
  }
  globalThis.ChillTongAdaptiveContrast=AdaptiveContrast;
})();
