#!/usr/bin/env node
/* CDP 高速截帧：单 Chrome 进程，逐帧 evaluate render(t) + captureScreenshot，约快 20 倍。
   用法：node render-trailer.mjs            # 截帧 + 合成
        node render-trailer.mjs --video      # 只合成 MP4（需先有帧）
*/
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=9223;
const URL='file:///Users/hello/Downloads/uno/index-trailer.html';
const DIR='/tmp/uno_frames';
const MP4='/Users/hello/Downloads/uno/uno-trailer.mp4';
const FPS=30, TOTAL=30, W=1920, H=1080;

async function capture(){
  fs.rmSync(DIR,{recursive:true,force:true});
  fs.mkdirSync(DIR,{recursive:true});

  const chrome=spawn(CHROME,[
    '--headless=new','--disable-gpu','--hide-scrollbars',
    `--window-size=${W},${H}`,'--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/uno_cdp`,
    URL
  ],{stdio:'ignore'});

  let wsUrl=null;
  for(let i=0;i<60;i++){
    try{
      const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page=list.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
      if(page){wsUrl=page.webSocketDebuggerUrl;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  if(!wsUrl){ console.error('CDP target not found'); chrome.kill(); process.exit(1); }

  const ws=new WebSocket(wsUrl);
  let msgId=0; const pending=new Map();
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(res=>{
    const id=++msgId; pending.set(id,res);
    ws.send(JSON.stringify({id,method,params}));
  });

  await send('Runtime.evaluate',{expression:'window.__stopLoop=true'});
  /* 强制 1920×1080 布局视口（--window-size 在 CDP 下不准，会把底部裁掉） */
  await send('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
  await new Promise(r=>setTimeout(r,700)); // 等首帧排版 / 字体

  const frames=TOTAL*FPS;
  for(let i=0;i<frames;i++){
    const t=(i/FPS).toFixed(4);
    await send('Runtime.evaluate',{expression:`render(${t})`});
    const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
    if(shot.result&&shot.result.data){
      fs.writeFileSync(`${DIR}/f_${String(i).padStart(4,'0')}.png`,Buffer.from(shot.result.data,'base64'));
    }else{
      console.error('shot failed at frame',i); process.exit(1);
    }
    if(i%60===0)console.error(`captured ${i}/${frames}`);
  }
  ws.close(); chrome.kill();
  console.error(`ALL_FRAMES_DONE frames=${frames}`);
}

function video(){
  /* libx264 在本机 ffmpeg 构建中初始化失败，改用 Apple 硬件编码器 */
  const r=spawnSync('ffmpeg',[
    '-y','-framerate',String(FPS),
    '-i',`${DIR}/f_%04d.png`,
    '-c:v','h264_videotoolbox','-pix_fmt','yuv420p','-b:v','10000k',
    '-movflags','+faststart',MP4
  ],{stdio:'inherit'});
  if(r.status!==0){ console.error('ffmpeg failed'); process.exit(1); }
  console.error('VIDEO_DONE '+MP4);
}

const mode=process.argv[2];
if(mode==='--video'){ video(); }
else{
  await capture();
  video();
}
