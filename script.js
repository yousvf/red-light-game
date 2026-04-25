(async () => {
	const MEDIA = {
		doll_turn:    'imgs/dollturntoscreen.mp4',      // plays when RED starts
		doll_reverse: 'imgs/dollturntoscreen - REVERSE.mp4', // plays when GREEN starts
		machine_sfx:  'imgs/robot-arm-sound-effect_w5GQc6lB.mp3',
		sing_green:   'imgs/Squid game doll (sound effect).mp3'
	};
	// ----------------------------------------------------------------------

	// DOM Elements
	const intro = document.getElementById('intro');
	const game = document.getElementById('game');
	const videoCanvas = document.getElementById('videoCanvas');
	const colorOverlay = document.getElementById('colorOverlay');
	const bigText = document.getElementById('bigText');
	const statusMsg = document.getElementById('statusMsg');
	const splitLine = document.getElementById('splitLine');
	const leftMsg = document.getElementById('leftMsg');
	const rightMsg = document.getElementById('rightMsg');
	const highscoreDisplay = document.getElementById('highscoreDisplay');
	const dollWrap = document.getElementById('dollWrap');
	const loadingOverlay = document.getElementById('loadingOverlay');
	const loadingMsg = document.getElementById('loadingMsg');
	const loadingHint = document.getElementById('loadingHint');
	const retryWrap = document.querySelector('#loadingOverlay .retry');
	const retryBtn = document.getElementById('retryBtn');

	// Media hooks (two video layers now)
	const dollVideoWrap = document.getElementById('dollVideoWrap');
	const dollTurn = document.getElementById('dollTurn');
	const dollReverse = document.getElementById('dollReverse');
	const sfxBgm = document.getElementById('sfx_bgm');
	const sfxMachine = document.getElementById('sfx_machine');
	const spBtn = document.getElementById('spBtn');
	const mpBtn = document.getElementById('mpBtn');

	// Singing audio
	const sfxSinging = document.createElement('audio');
	sfxSinging.id = 'sfx_singing';
	sfxSinging.loop = true;
	document.body.appendChild(sfxSinging);

	const UIs = {
		single: { wrap: document.getElementById('single-ui'), bar: document.getElementById('prog_single') },
		p1: { wrap: document.getElementById('p1-ui'), bar: document.getElementById('prog_p1') },
		p2: { wrap: document.getElementById('p2-ui'), bar: document.getElementById('prog_p2') }
	};

	const LOG_W = 1280, LOG_H = 720;
	function setupCanvas(canvas) { canvas.width = LOG_W; canvas.height = LOG_H; return canvas.getContext('2d'); }
	const videoCtx = setupCanvas(videoCanvas);

	// Game Variables
	let isMultiplayer = false;
	let detector = null, video = null, loopId = null;
	let roundActive = false, gameEnded = false;
	let lightState = 'green'; 
	let cycleTimer = null, machineTimer = null, videoTimer = null;
	let startTime = 0;
	let modelReady = false;
	let redEnforcementActive = true;
	const RED_ENFORCE_DELAY = 1200;

	// Movement Tuning
	const DEADZONE = 4.5; 
	const VIOLATION_THRESHOLD = 0.35; 
	const BASE_SPEED_MULTIPLIER = 0.005; 

	// Highscore
	let bestTime = localStorage.getItem('rlgl_fastest_time');
	if (bestTime) {
		highscoreDisplay.textContent = `FASTEST WIN: ${parseFloat(bestTime).toFixed(2)}s`;
		highscoreDisplay.style.opacity = '1';
	}

	const createPlayerState = () => ({
		progress: 0, violated: false, won: false,
		smoothedKps: null, lastKps: null, motionEMA: 0, violationFrames: 0
	});
	let players = {};

	spBtn.onclick = () => startGameMode(false);
	mpBtn.onclick = () => startGameMode(true);
	spBtn.disabled = true; mpBtn.disabled = true;

	retryBtn && (retryBtn.onclick = () => { startInit(true); });

	// Which clip will play on the next light transition: true -> turn plays on RED; false -> reverse plays on GREEN
	// Start with turn frozen and ready
	let nextPlayIsTurn = true;

	async function startInit(force = false) {
		loadingOverlay.style.display = 'flex';
		loadingMsg.textContent = 'Initializing camera & model…';
		loadingHint.style.display = 'block';
		retryWrap.style.display = 'none';

		try {
			await initAI();
			modelReady = true;

			sfxMachine.src = MEDIA.machine_sfx || '';
			sfxSinging.src = MEDIA.sing_green || '';

			// reduce robot-arm volume noticeably but not silent
			try { sfxMachine.volume = 0.25; } catch(e){}

			await preloadMedia();

			loadingOverlay.style.display = 'none';
			spBtn.disabled = false; mpBtn.disabled = false;
			showStatus('READY');
			try { dollWrap.classList.remove('riseAnim'); void dollWrap.offsetWidth; dollWrap.classList.add('riseAnim'); } catch(e) {}
		} catch (err) {
			console.error('Init error:', err);
			loadingMsg.textContent = 'Failed to initialize camera/model';
			loadingHint.textContent = 'Please allow camera access and reload, or click Retry.';
			retryWrap.style.display = 'block';
			spBtn.disabled = true; mpBtn.disabled = true;
		}
	}

	async function initAI() {
	loadingMsg.textContent = 'Warming up TensorFlow…';
	try { await tf.ready(); } catch(e) {}

	try { await tf.setBackend('webgl'); } catch { try { await tf.setBackend('cpu'); } catch {} }

	loadingMsg.textContent = 'Opening camera…';
	if (!video) {
		video = document.createElement('video');
		video.autoplay = true; video.playsInline = true; video.muted = true;
		video.width = LOG_W; video.height = LOG_H;
	}

	const stream = await navigator.mediaDevices.getUserMedia({ video: { width: LOG_W, height: LOG_H } });
	video.srcObject = stream;
	await new Promise((res, rej) => {
		const t = setTimeout(() => res(), 1500);
		video.onloadeddata = () => { clearTimeout(t); res(); };
		video.onerror = (e) => { clearTimeout(t); rej(e); };
	});
	await video.play();

	loadingMsg.textContent = 'Loading pose model…';
	try {
		detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
			modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
			enableTracking: true
		});
	} catch (e) {
		try {
			detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
				modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
				enableTracking: false
			});
		} catch (e2) {
			detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { runtime: 'tfjs' });
		}
	}
	try { await detector.estimatePoses(video, { flipHorizontal:true }); } catch(e){}
	}

	function showCentralMsg(text, color = 'white', size = 72, timeout) {
		bigText.style.opacity = '0';
		setTimeout(() => {
			bigText.style.color = color; bigText.style.fontSize = size + 'px';
			bigText.textContent = text; bigText.style.opacity = '1';
			if (timeout) setTimeout(()=> { if (bigText.textContent === text) bigText.style.opacity = '0'; }, timeout);
		}, 200);
	}

	function showStatus(str) { statusMsg.textContent = str; }

	function setOverlay(color, alpha) {
	if(!color) { colorOverlay.style.opacity = '0'; return; }
		colorOverlay.style.background = color; colorOverlay.style.opacity = String(alpha);
	}

	let lastTime = performance.now();
	async function loop() {
	if (gameEnded) return;
	const now = performance.now();
	const dt = (now - lastTime) / 1000;
	lastTime = now;

	let poses = [];
	try { if (detector) poses = await detector.estimatePoses(video, { flipHorizontal: true }); } catch(e) {}

	videoCtx.clearRect(0,0,LOG_W,LOG_H);
	try {
		const vw = video.videoWidth || LOG_W;
		const vh = video.videoHeight || LOG_H;
		const videoAspect = vw / vh;
		const canvasAspect = LOG_W / LOG_H;
		let sx = 0, sy = 0, sWidth = vw, sHeight = vh;
		if (videoAspect > canvasAspect) {
			sWidth = Math.round(vh * canvasAspect);
			sx = Math.round((vw - sWidth) / 2);
		} else {
			sHeight = Math.round(vw / canvasAspect);
			sy = Math.round((vh - sHeight) / 2);
		}
		videoCtx.save(); videoCtx.scale(-1,1);
		videoCtx.drawImage(video, sx, sy, sWidth, sHeight, -LOG_W, 0, LOG_W, LOG_H);
		videoCtx.restore();
	} catch(e) {}

	let activePoses = {};
	poses.forEach(pose => {
		let cx = 0, validKps = 0;
		(pose.keypoints || []).forEach(k => { if(k.score > 0.3) { cx += (LOG_W - k.x); validKps++; }});
		if (validKps === 0) return;
		cx /= validKps; 

		if (!isMultiplayer) {
			if (!activePoses['single'] || (pose.score || 0) > (activePoses['single'].score || 0)) activePoses['single'] = pose;
		} else {
			if (cx < LOG_W / 2) {
			if (!activePoses['p1'] || (pose.score || 0) > (activePoses['p1'].score || 0)) activePoses['p1'] = pose;
			} else if (!activePoses['p2'] || (pose.score || 0) > (activePoses['p2'].score || 0)) activePoses['p2'] = pose;
		}
	});

	Object.keys(players).forEach(pid => {
		let p = players[pid]; let pose = activePoses[pid]; let bar = UIs[pid].bar;
		if (p.violated || p.won || !pose) return;

		videoCtx.fillStyle = lightState === 'red' ? 'crimson' : 'cyan';
		(pose.keypoints || []).forEach(k => {
			if (k.score > 0.3) { videoCtx.beginPath(); videoCtx.arc(LOG_W - k.x, k.y, 4, 0, Math.PI*2); videoCtx.fill(); }
		});

		const raw = pose.keypoints || [];
		if (!p.smoothedKps) {
			p.smoothedKps = raw.map(k => ({...k}));
			p.lastKps = p.smoothedKps.map(k => ({...k}));
		} else {
			p.lastKps = p.smoothedKps.map(k => ({...k}));
			for(let i=0; i<raw.length; i++) {
				if (raw[i].score > 0.3) {
					p.smoothedKps[i].x = 0.3 * raw[i].x + 0.7 * p.smoothedKps[i].x;
					p.smoothedKps[i].y = 0.3 * raw[i].y + 0.7 * p.smoothedKps[i].y;
				}
			}
		}

		let sum = 0, cnt = 0;
		for (let i=0; i<p.smoothedKps.length; i++) {
			let dist = Math.hypot(p.smoothedKps[i].x - p.lastKps[i].x, p.smoothedKps[i].y - p.lastKps[i].y);
			if (dist > DEADZONE) { sum += dist; cnt++; }
		}
		
		let motion = cnt > 2 ? (sum / cnt) : 0;
		p.motionEMA = (0.3 * motion) + (0.7 * p.motionEMA);

		if (roundActive) {
		if (lightState === 'green') {
			let velocity = (p.motionEMA * BASE_SPEED_MULTIPLIER);
			p.progress = Math.min(1, p.progress + (velocity * dt));
			bar.style.width = (p.progress * 100) + '%';
			if (p.progress >= 1) triggerWin(pid);
		} 
		else if (lightState === 'red') {
			if (redEnforcementActive) {
				if (p.motionEMA > VIOLATION_THRESHOLD) p.violationFrames++;
				else p.violationFrames = Math.max(0, p.violationFrames - 1);
				if (p.violationFrames > 6) triggerLoss(pid);
			} else {
				p.violationFrames = Math.max(0, p.violationFrames - 1);
			}
		}
		}
	});

	loopId = requestAnimationFrame(loop);
	}

	function triggerWin(pid) {
		if (gameEnded) return;
		gameEnded = true; roundActive = false; stopAutoCycle();
		players[pid].won = true; UIs[pid].bar.classList.add('winner');
	
		if (!isMultiplayer) {
			let timeTaken = (Date.now() - startTime) / 1000;
			if (!bestTime || timeTaken < parseFloat(bestTime)) {
				localStorage.setItem('rlgl_fastest_time', timeTaken); bestTime = timeTaken;
				showCentralMsg(`NEW RECORD: ${timeTaken.toFixed(2)}s!`, 'gold', 72, 4000);
			} else {
				showCentralMsg('YOU WIN!', '#4de28d', 96, 4000);
			}
		} else {
			let loserId = pid === 'p1' ? 'p2' : 'p1';
			showLocalText(pid, 'WINNER!', '#4de28d', '');
			showLocalText(loserId, 'TOO SLOW', 'crimson', '');
		}
		setTimeout(resetToMenu, 5000);
	}

	function triggerLoss(pid) {
		if (gameEnded) return;
		players[pid].violated = true; UIs[pid].bar.classList.add('eliminated');

		if (!isMultiplayer) {
			gameEnded = true; roundActive = false; stopAutoCycle();
			showCentralMsg('YOU MOVED ON RED!', 'crimson', 72, 4000);
			setTimeout(resetToMenu, 4000);
		} else {
			gameEnded = true; roundActive = false; stopAutoCycle();
			let winnerId = pid === 'p1' ? 'p2' : 'p1';
			UIs[winnerId].bar.classList.add('winner');
			showLocalText(pid, 'ELIMINATED', 'crimson', '<br><span class="subText">You moved on red!</span>');
			showLocalText(winnerId, 'WINNER!', '#4de28d', '<br><span class="subText">Opponent eliminated.</span>');
			setTimeout(resetToMenu, 5000);
		}
	}

	function showLocalText(pid, main, color, sub) {
		let el = pid === 'p1' ? leftMsg : rightMsg;
		el.innerHTML = `<span style="font-size:64px; color:${color};">${main}</span>${sub}`;
		el.style.opacity = '1';
	}

		// Helper: make a video layer visible (crossfade)
	function showLayer(vidToShow, vidToHide) {
		try {
			vidToShow.classList.add('visible');
			if (vidToHide) vidToHide.classList.remove('visible');
		} catch(e){}
	}

	async function runAutoCalibrationAndStart() {
		players = isMultiplayer ? { p1: createPlayerState(), p2: createPlayerState() } : { single: createPlayerState() };
		Object.values(UIs).forEach(u => { u.bar.style.width = '0%'; u.bar.className = 'progressInner'; u.wrap.style.display = 'none'; });
		leftMsg.style.opacity = '0'; rightMsg.style.opacity = '0';
		gameEnded = false; roundActive = false;
		dollVideoWrap.style.display = 'block';

		if (isMultiplayer) { UIs.p1.wrap.style.display = 'flex'; UIs.p2.wrap.style.display = 'flex'; splitLine.style.display = 'block'; }
		else { UIs.single.wrap.style.display = 'flex'; splitLine.style.display = 'none'; }

		cancelAnimationFrame(loopId); lastTime = performance.now(); loop();

		// Prepare both videos: freeze TURN at its beginning frame and keep REVERSE frozen at its beginning too
		try {
			dollTurn.src = MEDIA.doll_turn;
			dollTurn.currentTime = 0;
			await dollTurn.play().catch(()=>{});
			dollTurn.pause();
		} catch(e) { console.warn('dollTurn preload error', e); }

		try {
			dollReverse.src = MEDIA.doll_reverse;
			dollReverse.currentTime = 0;
			await dollReverse.play().then(()=>{ dollReverse.pause(); }).catch(()=>{});
		} catch(e) { console.warn('dollReverse preload error', e); }

		// Show the TURN frozen frame at start (game starts at GREEN per spec)
		nextPlayIsTurn = true;
		showLayer(dollTurn, dollReverse);

		for (let i=3; i>=1; i--) { showCentralMsg(String(i), 'white', 120, 800); await new Promise(r=>setTimeout(r, 1000)); }
		
		startTime = Date.now(); roundActive = true;
		// start with GREEN state already active (your code already sets green on first call)
		setGreen(); 
	}

	let nextGreenDuration = 0, nextRedDuration = 0;
	function pickGreenDuration() { return 4000 + Math.random() * 5000; }
	function pickRedDuration() { return 5000 + Math.random() * 4000; }

	function setGreen() {
	if (gameEnded) return;
	lightState = 'green';
	showStatus('GREEN LIGHT');

	nextGreenDuration = pickGreenDuration();
	if (cycleTimer) clearTimeout(cycleTimer);
	if (videoTimer) clearTimeout(videoTimer);
	cycleTimer = setTimeout(setRed, nextGreenDuration);

	setOverlay('rgba(77, 226, 141, 0.1)', 1);
	showCentralMsg('GREEN LIGHT', '#4de28d', 90, 1000);

	// AUDIO: adapt singing to green duration
	try {
		const singDur = sfxSinging.duration || 0.001;
		let rate = 1;
		if (singDur > 0 && !isNaN(singDur)) {
			rate = singDur / (nextGreenDuration / 1000.0);
			rate = Math.max(0.4, Math.min(2.0, rate));
		}
		sfxSinging.playbackRate = rate;
		sfxSinging.currentTime = 0;
		sfxSinging.play().catch(()=>{});
	} catch (e) {}

	// We only play the reverse if it was prepared as the 'next to play' (i.e., nextPlayIsTurn === false)
	if (!nextPlayIsTurn) {
		// play reverse from its start and when it ends, freeze TURN at its beginning
		try {
			dollReverse.currentTime = 0;
			dollReverse.onended = () => {
				// when reverse finishes, freeze TURN at beginning and show it's frozen
				try { dollReverse.pause(); } catch(e){}
				try { dollTurn.currentTime = 0; dollTurn.pause(); } catch(e){}
				showLayer(dollTurn, dollReverse);
				// prepare state so TURN will be the one to play on next RED
				nextPlayIsTurn = true;
				dollReverse.onended = null;
			};
			showLayer(dollReverse, dollTurn);
			dollReverse.play().catch(()=>{});
		} catch(e) { console.warn('play reverse error', e); }
	} else {
		// If TURN is the one that would play on RED, we must ensure TURN remains frozen and visible during GREEN
		try { dollTurn.currentTime = 0; dollTurn.pause(); showLayer(dollTurn, dollReverse); } catch(e){}
	}

	setTimeout(()=> setOverlay(null,0), 600);
	}

	function setRed() {
	if (gameEnded) return;
	lightState = 'red';
	redEnforcementActive = false;
	setTimeout(() => { redEnforcementActive = true; }, RED_ENFORCE_DELAY);

	nextRedDuration = pickRedDuration();
	if (cycleTimer) clearTimeout(cycleTimer);
	if (videoTimer) clearTimeout(videoTimer);
	cycleTimer = setTimeout(setGreen, nextRedDuration);

	// AUDIO: robot sound
	try {
		sfxMachine.currentTime = 0;
		sfxMachine.play().catch(()=>{});
	} catch(e){}
	try { sfxSinging.pause(); sfxSinging.currentTime = 0; } catch(e){}

	Object.keys(players).forEach(pid => players[pid].violationFrames = 0);
	showStatus('RED LIGHT');
	setOverlay('rgba(220, 20, 60, 0.15)', 1);
	showCentralMsg('RED LIGHT', 'crimson', 90, 1000);

	if (nextPlayIsTurn) {
		try {
			dollTurn.currentTime = 0;
			dollTurn.onended = () => {
				// when turn finishes, freeze REVERSE at its beginning and show frozen reverse
				try { dollTurn.pause(); } catch(e){}
				try { dollReverse.currentTime = 0; dollReverse.pause(); } catch(e){}
				showLayer(dollReverse, dollTurn);
				// prepare state so REVERSE will play on next GREEN
				nextPlayIsTurn = false;
				dollTurn.onended = null;
			};
			showLayer(dollTurn, dollReverse);
			dollTurn.play().catch(()=>{});
		} catch(e) { console.warn('play turn error', e); }
	} else {
		// If REVERSE was supposed to play on GREEN, ensure reverse remains frozen and visible during RED
		try { dollReverse.currentTime = 0; dollReverse.pause(); showLayer(dollReverse, dollTurn); } catch(e){}
	}

	setTimeout(()=> setOverlay(null,0), 800);
	}

	function stopAutoCycle() { 
	clearTimeout(cycleTimer); 
	clearTimeout(machineTimer);
	if (videoTimer) clearTimeout(videoTimer);
	}

	function resetToMenu() {
		game.style.opacity = '0';
		setTimeout(() => {
			cancelAnimationFrame(loopId);
			dollVideoWrap.style.display = 'none';
			try { dollTurn.pause(); dollReverse.pause(); } catch(e){}
			if(sfxBgm.src) sfxBgm.pause();
			sfxSinging.pause();
			sfxMachine.pause();
			
			if (bestTime) { highscoreDisplay.textContent = `FASTEST WIN: ${parseFloat(bestTime).toFixed(2)}s`; highscoreDisplay.style.opacity = '1'; }
			
			intro.style.display = 'block'; void intro.offsetWidth; intro.style.opacity = '1';
			spBtn.disabled = false; mpBtn.disabled = false;
			try { dollWrap.classList.remove('riseAnim'); void dollWrap.offsetWidth; dollWrap.classList.add('riseAnim'); } catch(e) {}
		}, 1000);
	}

	async function startGameMode(multi) {
		isMultiplayer = multi;
		intro.style.opacity = '0';
		try { dollWrap.classList.remove('riseAnim'); } catch(e) {}
		spBtn.disabled = true; mpBtn.disabled = true;
		
		try { if(sfxBgm.src) { sfxBgm.currentTime = 0; sfxBgm.play().catch(()=>{}); } } catch(e) {}

		setTimeout(async () => {
			intro.style.display = 'none'; game.style.opacity = '1';
			if (!detector) {
				loadingOverlay.style.display = 'flex'; loadingMsg.textContent = 'Starting camera & model…';
				try { await initAI(); loadingOverlay.style.display = 'none'; } catch(e) { loadingMsg.textContent = 'Camera failed. Click Retry.'; retryWrap.style.display='block'; return; }
			}
			runAutoCalibrationAndStart();
		}, 800);
	}

	async function preloadMedia() {
		const loadAudioMeta = (audioEl) => new Promise((res) => {
			if (!audioEl) return res();
			if (audioEl.readyState >= 1 && audioEl.duration && !isNaN(audioEl.duration)) {
				res(); return;
			}
			audioEl.preload = 'metadata';
			audioEl.onloadedmetadata = () => res();
			audioEl.onerror = () => res();
			setTimeout(res, 1500);
		});

		const loadVideoMeta = (videoEl, src) => new Promise((res) => {
			if (!videoEl) return res();
			videoEl.preload = 'auto';
			videoEl.src = src;
			videoEl.onloadedmetadata = () => { res(); };
			videoEl.onerror = () => { res(); };
			setTimeout(res, 1500);
		});

		try {
			await Promise.all([
				loadAudioMeta(sfxMachine),
				loadAudioMeta(sfxSinging),
				loadVideoMeta(dollTurn, MEDIA.doll_turn),
				loadVideoMeta(dollReverse, MEDIA.doll_reverse)
			]);
		} catch(e) { console.warn('preload error', e); }

		// both videos preloaded; we'll control playback during rounds to avoid flicker
	}

	startInit();
})().catch(e => console.error(e));