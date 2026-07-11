// solo.js — the original evasion game (echoes, mirrors, dormant hunter),
// now with a second hunter type (Warden) whose persistence scales per depth,
// and a player color driven by profile customization. Independent of sim.js.
window.SoloGame = (() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const el = {
    depthNum: document.getElementById('depthNum'),
    levelName: document.getElementById('levelName'),
    echoCount: document.getElementById('echoCount'),
    agitationRow: document.getElementById('agitationRow'),
    agitationVal: document.getElementById('agitationVal'),
    cdRing: document.getElementById('cdRing'),
    intro: document.getElementById('introOverlay'),
    win: document.getElementById('winOverlay'),
    winTitle: document.getElementById('winTitle'),
    winBody: document.getElementById('winBody'),
    lose: document.getElementById('loseOverlay'),
    notice: document.getElementById('noticeOverlay'),
    startBtn: document.getElementById('startBtn'),
    nextBtn: document.getElementById('nextBtn'),
    retryBtn: document.getElementById('retryBtn'),
    noticeBtn: document.getElementById('noticeBtn'),
    leaveBtn: document.getElementById('soloLeaveBtn'),
  };

  // ---------------- sound (unchanged from original) ----------------
  const Sound = (() => {
    let actx = null, master = null, ambientNodes = null, lastHeartbeatAt = 0;
    function ensure(){
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
    }
    function resume(){ ensure(); if (actx.state === 'suspended') actx.resume(); }
    function tone(freq, dur, {type='sine', gain=0.3, glideTo=null, delay=0}={}){
      if (!actx) return;
      const t0 = actx.currentTime + delay;
      const osc = actx.createOscillator(), g = actx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0+dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0+Math.min(0.02, dur*0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0+dur+0.02);
    }
    function noiseBurst(dur, {gain=0.2, delay=0, filterFreq=800}={}){
      if (!actx) return;
      const t0 = actx.currentTime + delay;
      const bufferSize = Math.floor(actx.sampleRate*dur);
      const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * (1-i/bufferSize);
      const src = actx.createBufferSource(); src.buffer = buffer;
      const filt = actx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=filterFreq;
      const g = actx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      src.connect(filt); filt.connect(g); g.connect(master); src.start(t0);
    }
    function playPing(){ tone(760,0.28,{gain:0.32,glideTo:280}); tone(1140,0.16,{gain:0.10,glideTo:600,delay:0.02}); }
    function playBounce(){ tone(1500,0.10,{type:'triangle',gain:0.16,glideTo:1900}); tone(2200,0.08,{type:'triangle',gain:0.08,glideTo:2600,delay:0.03}); }
    function playHunterPing(){ tone(90,0.5,{gain:0.28,glideTo:55}); noiseBurst(0.18,{gain:0.06,filterFreq:300}); }
    function playWardenPing(){ tone(70,0.6,{type:'sawtooth',gain:0.22,glideTo:40}); noiseBurst(0.22,{gain:0.08,filterFreq:220}); }
    function playWin(){ [392,494,587,784].forEach((f,i)=>tone(f,0.55,{gain:0.22,delay:i*0.12})); }
    function playLose(){ tone(180,0.8,{type:'sawtooth',gain:0.20,glideTo:60}); tone(196,0.8,{type:'sawtooth',gain:0.16,glideTo:64,delay:0.02}); noiseBurst(0.5,{gain:0.18,filterFreq:1200}); }
    function startAmbient(){
      ensure(); if (ambientNodes) return;
      const drone=actx.createOscillator(); drone.type='sine'; drone.frequency.value=62;
      const droneGain=actx.createGain(); droneGain.gain.value=0.05;
      const drone2=actx.createOscillator(); drone2.type='triangle'; drone2.frequency.value=93;
      const drone2Gain=actx.createGain(); drone2Gain.gain.value=0.02;
      const lfo=actx.createOscillator(); lfo.type='sine'; lfo.frequency.value=0.08;
      const lfoGain=actx.createGain(); lfoGain.gain.value=8;
      lfo.connect(lfoGain); lfoGain.connect(drone.frequency);
      drone.connect(droneGain); droneGain.connect(master);
      drone2.connect(drone2Gain); drone2Gain.connect(master);
      drone.start(); drone2.start(); lfo.start();
      ambientNodes = {drone,drone2,lfo,droneGain,drone2Gain};
    }
    function stopAmbient(){
      if (!ambientNodes) return;
      const t0=actx.currentTime;
      ambientNodes.droneGain.gain.exponentialRampToValueAtTime(0.0001,t0+0.4);
      ambientNodes.drone2Gain.gain.exponentialRampToValueAtTime(0.0001,t0+0.4);
      const nodes = ambientNodes;
      setTimeout(()=>{ try{ nodes.drone.stop(); nodes.drone2.stop(); nodes.lfo.stop(); }catch(e){} },500);
      ambientNodes = null;
    }
    function updateTension(nearestHunterDist, dtNow){
      if (!actx) return;
      const near=60,far=480, clamped=Math.max(near,Math.min(far,nearestHunterDist));
      const closeness = 1-(clamped-near)/(far-near);
      const interval = 2200-closeness*1750;
      if (dtNow-lastHeartbeatAt > interval){ lastHeartbeatAt=dtNow; tone(58,0.22,{gain:0.06+closeness*0.16,glideTo:40}); }
    }
    return { resume, playPing, playBounce, playHunterPing, playWardenPing, playWin, playLose, startAmbient, stopAmbient, updateTension };
  })();

  const ROMAN = ['I','II','III','IV','V','VI','VII'];
  function seg(x1,y1,x2,y2,mirror){ return {x1,y1,x2,y2,mirror:!!mirror}; }

  // ---------------- Level data (unchanged geometry) + wardens (new) ----------------
  const LEVELS = [
    { name:'Shelf Reach', player:{x:60,y:470}, exit:{x:800,y:70},
      hunters:[{x:770,y:450,speed:46}], wardens:[],
      cooldown:950, wallFade:4200,
      walls:[seg(420,10,420,340,false),seg(420,340,560,420,true),seg(620,10,620,220,false),seg(620,220,760,220,false)] },
    { name:'Twin Vents', player:{x:50,y:50}, exit:{x:800,y:480},
      hunters:[{x:430,y:270,speed:62}], wardens:[{x:700,y:120,speed:50}],
      cooldown:950, wallFade:4000,
      walls:[seg(200,10,200,380,false),seg(200,380,340,460,true),seg(460,140,460,530,false),seg(460,140,630,60,true),seg(660,10,660,320,false)] },
    { name:'The Narrows', player:{x:430,y:500}, exit:{x:430,y:35},
      hunters:[{x:100,y:100,speed:76}], wardens:[{x:700,y:450,speed:58}],
      cooldown:1000, wallFade:3800,
      walls:[seg(150,340,380,340,false),seg(480,340,710,340,false),seg(380,340,380,430,true),seg(480,340,480,430,true),seg(250,120,400,120,false),seg(460,120,610,120,false),seg(400,120,400,200,true)] },
    { name:'Cold Fold', player:{x:60,y:270}, exit:{x:800,y:270},
      hunters:[{x:430,y:270,speed:85}], wardens:[{x:760,y:450,speed:64}],
      cooldown:1000, wallFade:3600,
      walls:[seg(180,10,180,340,false),seg(180,340,320,410,true),seg(460,140,460,530,false),seg(460,140,610,70,true),seg(680,10,680,380,false)] },
    { name:'The Vein', player:{x:430,y:500}, exit:{x:760,y:60},
      hunters:[{x:200,y:150,speed:95}], wardens:[{x:100,y:450,speed:70}],
      cooldown:1050, wallFade:3400,
      walls:[seg(300,300,300,530,false),seg(300,300,520,300,false),seg(300,300,400,370,true),seg(560,10,560,260,false),seg(680,180,780,180,false),seg(620,260,680,180,true)] },
    { name:'Twin Depths', player:{x:50,y:500}, exit:{x:800,y:40},
      hunters:[{x:400,y:150,speed:80},{x:700,y:460,speed:78}], wardens:[{x:500,y:250,speed:76}],
      cooldown:1050, wallFade:3200,
      walls:[seg(220,150,220,530,false),seg(220,150,360,90,true),seg(460,10,460,340,false),seg(640,150,640,530,false)] },
    { name:'The Hollow Below', player:{x:430,y:510}, exit:{x:430,y:38},
      hunters:[{x:200,y:270,speed:100},{x:660,y:270,speed:105}], wardens:[{x:700,y:270,speed:82}],
      cooldown:1100, wallFade:3000,
      walls:[seg(150,360,340,360,false),seg(520,360,710,360,false),seg(340,360,340,440,true),seg(520,360,520,440,true),seg(250,140,380,140,false),seg(480,140,610,140,false),seg(380,140,380,220,true)] }
  ];

  const PULSE_SPEED=340, HUNTER_FADE=1500, MAX_BOUNCE_DEPTH=2;
  const PLAYER_R=8, HUNTER_R=11, WARDEN_R=13, EXIT_R=22, HEARING_RADIUS=480;
  const AGITATION_START_DEPTH=3, AGITATION_PER_CAST=0.05, AGITATION_CAP=0.75;
  const WALL_RAMP_MS=180, HUNTER_SOUND_COOLDOWN=450, STUCK_THRESHOLD=0.6;
  // persistence: how long a Warden keeps actively searching after losing the player,
  // before falling back to idle wandering — grows with depth.
  const WARDEN_SEARCH_BASE_MS=2200, WARDEN_SEARCH_STEP_MS=700, WARDEN_SEARCH_CAP_MS=6500;

  let levelIndex=0, game=null, keys={}, lastTime=performance.now(), running=false;
  let playerColor = '#57e8d4', playerGlow = '#57e8d4';
  let onExitCb = null, loopStarted = false;

  function boundarySegs(){
    return [seg(10,10,850,10,false),seg(850,10,850,530,false),seg(850,530,10,530,false),seg(10,530,10,10,false)];
  }

  function buildLevel(idx){
    const def = LEVELS[idx];
    const walls = [...boundarySegs(), ...def.walls];
    const allHunters = [
      ...def.hunters.map(h => ({...h, type:'hunter'})),
      ...def.wardens.map(h => ({...h, type:'warden'})),
    ];
    return {
      idx,
      player: {x:def.player.x, y:def.player.y, vx:0, vy:0, heading:0},
      exit: {x:def.exit.x, y:def.exit.y, found:false, foundAt:0},
      hunters: allHunters.map(h => ({
        x:h.x, y:h.y, speed:h.speed, type:h.type,
        state:'dormant', wanderTarget:null, wanderUntil:0, target:null,
        revealAt:-99999, lastX:h.x, lastY:h.y, stuckTimer:0,
      })),
      walls,
      wallReveal: new Array(walls.length).fill(-99999),
      wallFirstTouch: new Array(walls.length).fill(-99999),
      pulses: [], echoesUsed: 0, cooldownUntil: 0,
      cooldownMs: def.cooldown||950, wallFadeMs: def.wallFade||4200,
      agitation: 0, firstEchoCast: false, lastHunterSoundAt: -99999,
      ended:false, won:false, particles: makeParticles(),
    };
  }

  function makeParticles(){
    const p = [];
    for (let i=0;i<26;i++) p.push({x:Math.random()*W,y:Math.random()*H,r:0.6+Math.random()*1.4,speed:6+Math.random()*10,drift:(Math.random()-0.5)*6,alpha:0.06+Math.random()*0.10});
    return p;
  }

  function closestPointOnSegment(px,py,x1,y1,x2,y2){
    const dx=x2-x1,dy=y2-y1,lenSq=dx*dx+dy*dy;
    let t=lenSq===0?0:((px-x1)*dx+(py-y1)*dy)/lenSq;
    t=Math.max(0,Math.min(1,t));
    const cx=x1+t*dx,cy=y1+t*dy;
    return {x:cx,y:cy,dist:Math.hypot(px-cx,py-cy)};
  }

  function resolveCircleVsWalls(entity, walls){
    for (let pass=0; pass<2; pass++){
      for (const w of walls){
        const cp = closestPointOnSegment(entity.x,entity.y,w.x1,w.y1,w.x2,w.y2);
        const r = entity.radius;
        if (cp.dist < r){
          if (cp.dist > 0.0001){
            const nx=(entity.x-cp.x)/cp.dist, ny=(entity.y-cp.y)/cp.dist;
            const push=r-cp.dist; entity.x+=nx*push; entity.y+=ny*push;
          } else {
            const dx=w.x2-w.x1,dy=w.y2-w.y1,len=Math.hypot(dx,dy)||1;
            entity.x+=(-dy/len)*r; entity.y+=(dx/len)*r;
          }
        }
      }
    }
  }

  function wardenSearchMs(idx){ return Math.min(WARDEN_SEARCH_CAP_MS, WARDEN_SEARCH_BASE_MS + idx*WARDEN_SEARCH_STEP_MS); }

  // ---------------- input ----------------
  window.addEventListener('keydown', e => {
    if (!running) return;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space',' '].includes(e.key) || e.code==='Space') e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if ((e.code==='Space' || e.key===' ') && running) castEcho();
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  function castEcho(){
    const now = performance.now();
    if (now < game.cooldownUntil) return;
    game.cooldownUntil = now + game.cooldownMs;
    game.echoesUsed += 1;
    el.echoCount.textContent = game.echoesUsed;
    Sound.playPing();
    game.pulses.push({x:game.player.x,y:game.player.y,r:0,speed:PULSE_SPEED,maxR:900,bounced:new Set(),depth:0,primary:true});
    game.firstEchoCast = true;
    if (game.idx >= AGITATION_START_DEPTH){
      game.agitation = Math.min(AGITATION_CAP, game.agitation + AGITATION_PER_CAST);
      el.agitationVal.textContent = Math.round(game.agitation*100) + '%';
    }
    for (const h of game.hunters){
      if (h.state === 'dormant') h.state = 'idle';
      const dh = Math.hypot(h.x-game.player.x, h.y-game.player.y);
      if (dh <= HEARING_RADIUS){ h.target = {x:game.player.x,y:game.player.y}; h.state = 'hunt'; }
    }
  }

  function update(dt){
    const p = game.player;
    let dx=0,dy=0;
    if (keys['w']||keys['arrowup']) dy-=1;
    if (keys['s']||keys['arrowdown']) dy+=1;
    if (keys['a']||keys['arrowleft']) dx-=1;
    if (keys['d']||keys['arrowright']) dx+=1;
    if (dx||dy){
      const len=Math.hypot(dx,dy); dx/=len; dy/=len;
      p.heading = Math.atan2(dy,dx);
      p.x += dx*148*dt; p.y += dy*148*dt;
    }
    p.radius = PLAYER_R;
    resolveCircleVsWalls(p, game.walls);

    const now = performance.now();
    for (const pulse of game.pulses) pulse.r += pulse.speed*dt;
    for (const pulse of game.pulses){
      if (pulse.dead) continue;
      for (let i=0;i<game.walls.length;i++){
        const w = game.walls[i];
        const cp = closestPointOnSegment(pulse.x,pulse.y,w.x1,w.y1,w.x2,w.y2);
        if (cp.dist <= pulse.r){
          if (now - game.wallReveal[i] > 250) game.wallFirstTouch[i] = now;
          game.wallReveal[i] = now;
          if (w.mirror && !pulse.bounced.has(i) && pulse.depth < MAX_BOUNCE_DEPTH){
            pulse.bounced.add(i);
            Sound.playBounce();
            game.pulses.push({x:cp.x,y:cp.y,r:0,speed:pulse.speed*0.85,maxR:pulse.maxR*0.6,bounced:new Set(pulse.bounced),depth:pulse.depth+1,primary:false});
          }
        }
      }
      const de = Math.hypot(pulse.x-game.exit.x, pulse.y-game.exit.y);
      if (de <= pulse.r && !game.exit.found){ game.exit.found = true; game.exit.foundAt = now; }
      for (const h of game.hunters){
        const dh = Math.hypot(pulse.x-h.x, pulse.y-h.y);
        if (dh <= pulse.r){
          if (h.revealAt < now-HUNTER_FADE && now-game.lastHunterSoundAt > HUNTER_SOUND_COOLDOWN){
            (h.type==='warden' ? Sound.playWardenPing : Sound.playHunterPing)();
            game.lastHunterSoundAt = now;
          }
          h.revealAt = now;
        }
      }
    }
    game.pulses = game.pulses.filter(pl => pl.r < pl.maxR);

    for (const h of game.hunters){
      h.radius = (h.type==='warden') ? WARDEN_R : HUNTER_R;
      if (h.state === 'dormant') continue;
      const effSpeed = h.speed * (1+game.agitation);
      if (h.state==='hunt' && h.target){
        const ddx=h.target.x-h.x, ddy=h.target.y-h.y, dd=Math.hypot(ddx,ddy);
        if (dd < 10){
          h.state = 'search';
          h.wanderUntil = now + (h.type==='warden' ? wardenSearchMs(game.idx) : 2200);
          h.wanderTarget = null;
        } else { h.x += (ddx/dd)*effSpeed*dt; h.y += (ddy/dd)*effSpeed*dt; }
      } else if (h.state==='search'){
        if (!h.wanderTarget || Math.hypot(h.wanderTarget.x-h.x,h.wanderTarget.y-h.y) < 12){
          h.wanderTarget = {x:Math.max(30,Math.min(830,h.x+(Math.random()-0.5)*220)), y:Math.max(30,Math.min(510,h.y+(Math.random()-0.5)*220))};
        }
        const ddx=h.wanderTarget.x-h.x, ddy=h.wanderTarget.y-h.y, dd=Math.hypot(ddx,ddy)||1;
        h.x += (ddx/dd)*effSpeed*0.55*dt; h.y += (ddy/dd)*effSpeed*0.55*dt;
        if (now > h.wanderUntil) h.state = 'idle';
      } else {
        if (!h.wanderTarget || Math.hypot(h.wanderTarget.x-h.x,h.wanderTarget.y-h.y) < 12 || Math.random()<0.003){
          h.wanderTarget = {x:Math.max(30,Math.min(830,h.x+(Math.random()-0.5)*120)), y:Math.max(30,Math.min(510,h.y+(Math.random()-0.5)*120))};
        }
        const ddx=h.wanderTarget.x-h.x, ddy=h.wanderTarget.y-h.y, dd=Math.hypot(ddx,ddy)||1;
        h.x += (ddx/dd)*effSpeed*0.25*dt; h.y += (ddy/dd)*effSpeed*0.25*dt;
      }
      resolveCircleVsWalls(h, game.walls);
      const moved = Math.hypot(h.x-h.lastX, h.y-h.lastY);
      if (moved < 0.15){
        h.stuckTimer += dt;
        if (h.stuckTimer > STUCK_THRESHOLD){
          if (h.state==='hunt'){
            const nx=-(h.target?(h.target.y-h.y):1), ny=(h.target?(h.target.x-h.x):0);
            const nl=Math.hypot(nx,ny)||1, side=Math.random()<0.5?1:-1;
            h.x += (nx/nl)*side*6; h.y += (ny/nl)*side*6;
            resolveCircleVsWalls(h, game.walls);
          } else h.wanderTarget = null;
          h.stuckTimer = 0;
        }
      } else h.stuckTimer = 0;
      h.lastX = h.x; h.lastY = h.y;
    }

    for (const pt of game.particles){
      pt.y -= pt.speed*dt; pt.x += pt.drift*dt;
      if (pt.y < -4){ pt.y = H+4; pt.x = Math.random()*W; }
    }

    let nearest = Infinity;
    for (const h of game.hunters){ if (h.state==='dormant') continue; nearest = Math.min(nearest, Math.hypot(p.x-h.x,p.y-h.y)); }
    if (nearest < Infinity) Sound.updateTension(nearest, now);

    const remain = Math.max(0, game.cooldownUntil-now);
    const frac = 1-remain/game.cooldownMs;
    el.cdRing.setAttribute('stroke-dashoffset', String(88*(1-frac)));

    const distToExit = Math.hypot(p.x-game.exit.x, p.y-game.exit.y);
    if (!game.ended && distToExit < EXIT_R*0.6){ game.ended=true; game.won=true; onWin(); }
    if (!game.ended){
      for (const h of game.hunters){
        if (Math.hypot(p.x-h.x,p.y-h.y) < (PLAYER_R+h.radius+3)){ game.ended=true; game.won=false; onLose(); break; }
      }
    }
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    ctx.save();
    for (const pt of game.particles){ ctx.globalAlpha=pt.alpha; ctx.fillStyle='#7fb9c9'; ctx.beginPath(); ctx.arc(pt.x,pt.y,pt.r,0,Math.PI*2); ctx.fill(); }
    ctx.restore();

    const now = performance.now();
    for (let i=0;i<game.walls.length;i++){
      const w = game.walls[i];
      const isBoundary = i<4;
      let alpha;
      if (isBoundary) alpha = 0.16;
      else {
        const sinceLast = now-game.wallReveal[i], sinceFirst = now-game.wallFirstTouch[i];
        const rampIn = Math.min(1, sinceFirst/WALL_RAMP_MS);
        const fadeOut = Math.max(0, 1-sinceLast/game.wallFadeMs);
        alpha = Math.max(w.mirror?0.14:0, Math.min(rampIn,fadeOut));
      }
      if (alpha <= 0.01) continue;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = w.mirror ? getMirrorColor(now) : '#8fa9b8';
      ctx.lineWidth = w.mirror ? 3 : 2.2;
      if (w.mirror){ ctx.shadowColor='rgba(238,244,246,0.6)'; ctx.shadowBlur=6; }
      ctx.beginPath(); ctx.moveTo(w.x1,w.y1); ctx.lineTo(w.x2,w.y2); ctx.stroke(); ctx.restore();
    }

    if (game.exit.found){
      const t=(now-game.exit.foundAt)/1000, pulseR=EXIT_R+Math.sin(t*2.2)*3;
      ctx.save();
      const g=ctx.createRadialGradient(game.exit.x,game.exit.y,2,game.exit.x,game.exit.y,pulseR*2.2);
      g.addColorStop(0,'rgba(255,207,122,0.9)'); g.addColorStop(1,'rgba(255,207,122,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(game.exit.x,game.exit.y,pulseR*2.2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ffcf7a'; ctx.beginPath(); ctx.arc(game.exit.x,game.exit.y,6,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    for (const h of game.hunters){
      const hSince = now-h.revealAt;
      if (hSince < HUNTER_FADE){
        const a = 1-hSince/HUNTER_FADE;
        const color = h.type==='warden' ? '#ff6b3d' : '#ff2d55';
        ctx.save(); ctx.globalAlpha=Math.min(0.9,a); ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=14;
        drawSpikyBlob(h.x,h.y, h.type==='warden'?14:12, h.type==='warden'?8:6);
        ctx.restore();
      }
    }

    for (const pulse of game.pulses){
      const fade = Math.max(0, 1-pulse.r/pulse.maxR);
      ctx.save(); ctx.globalAlpha=fade*(pulse.primary?0.55:0.4);
      ctx.strokeStyle='#57e8d4'; ctx.lineWidth=pulse.primary?1.6:1.1;
      ctx.beginPath(); ctx.arc(pulse.x,pulse.y,Math.max(0,pulse.r),0,Math.PI*2); ctx.stroke(); ctx.restore();
    }

    ctx.save();
    ctx.translate(game.player.x, game.player.y);
    ctx.rotate(game.player.heading);
    ctx.fillStyle = playerColor;
    ctx.shadowColor = playerGlow; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(9,0); ctx.quadraticCurveTo(-4,-7,-9,-2); ctx.quadraticCurveTo(-4,0,-9,2); ctx.quadraticCurveTo(-4,7,9,0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function getMirrorColor(now){ const s=0.5+0.5*Math.sin(now/500), c=Math.round(230+s*20); return `rgb(${c},${c},${Math.min(255,c+6)})`; }
  function drawSpikyBlob(cx,cy,r,spikes){
    ctx.beginPath();
    for (let i=0;i<spikes*2;i++){
      const ang=(i/(spikes*2))*Math.PI*2, rad=i%2===0?r:r*0.55;
      const x=cx+Math.cos(ang)*rad, y=cy+Math.sin(ang)*rad;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }

  function loop(t){
    const dt = Math.min(0.05,(t-lastTime)/1000); lastTime=t;
    if (running && game && !game.ended) update(dt);
    if (game) render();
    requestAnimationFrame(loop);
  }

  let seenAgitationNotice = false;
  function startLevel(idx){
    levelIndex = idx;
    game = buildLevel(idx);
    el.depthNum.textContent = ROMAN[idx];
    el.levelName.textContent = LEVELS[idx].name;
    el.echoCount.textContent = '0';
    el.agitationRow.style.display = idx >= AGITATION_START_DEPTH ? 'flex' : 'none';
    el.agitationVal.textContent = '0%';
    keys = {};
    el.intro.classList.remove('show'); el.win.classList.remove('show');
    el.lose.classList.remove('show'); el.notice.classList.remove('show');
    if (idx===AGITATION_START_DEPTH && !seenAgitationNotice){ running=false; el.notice.classList.add('show'); }
    else { running=true; Sound.startAmbient(); }
  }

  function onWin(){
    running=false; Sound.stopAmbient(); Sound.playWin();
    if (levelIndex >= LEVELS.length-1){
      el.winTitle.textContent='the abyssal floor';
      el.winBody.textContent='No colder water beneath this. You cast '+game.echoesUsed+' echoes to get here.';
      el.nextBtn.textContent='descend again, from the top';
    } else {
      el.winTitle.textContent='vent found';
      el.winBody.textContent='The water warms. '+game.echoesUsed+' echoes cast at this depth.';
      el.nextBtn.textContent='descend further';
    }
    el.win.classList.add('show');
  }
  function onLose(){ running=false; Sound.stopAmbient(); Sound.playLose(); el.lose.classList.add('show'); }

  el.startBtn.addEventListener('click', () => { Sound.resume(); startLevel(0); });
  el.nextBtn.addEventListener('click', () => { Sound.resume(); startLevel(levelIndex>=LEVELS.length-1 ? 0 : levelIndex+1); });
  el.retryBtn.addEventListener('click', () => { Sound.resume(); startLevel(levelIndex); });
  el.noticeBtn.addEventListener('click', () => { seenAgitationNotice=true; el.notice.classList.remove('show'); running=true; Sound.startAmbient(); });
  el.leaveBtn.addEventListener('click', () => {
    running = false; Sound.stopAmbient();
    el.intro.classList.remove('show'); el.win.classList.remove('show'); el.lose.classList.remove('show'); el.notice.classList.remove('show');
    if (onExitCb) onExitCb();
  });

  function start(profile, onExit){
    playerColor = (profile && profile.color) || '#bff2ea';
    playerGlow = playerColor;
    onExitCb = onExit;
    seenAgitationNotice = false;
    game = buildLevel(0);
    el.depthNum.textContent = ROMAN[0];
    el.levelName.textContent = LEVELS[0].name;
    el.echoCount.textContent = '0';
    el.agitationRow.style.display = 'none';
    running = false;
    el.win.classList.remove('show'); el.lose.classList.remove('show'); el.notice.classList.remove('show');
    el.intro.classList.add('show');
    if (!loopStarted){ loopStarted = true; lastTime = performance.now(); requestAnimationFrame(loop); }
  }

  return { start };
})();
