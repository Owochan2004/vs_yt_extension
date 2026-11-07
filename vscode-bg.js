(function () {
    const WS_URL = 'ws://localhost:9999';
    let ws, pc, video;
    let candidateQueue = [];
    
    // Variables de audio y visualizador
    let audioCtx, analyser, dataArray;
    let canvas, ctx;
    let isDrawing = false;

    // Extractor de color del video
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
    let neonColor = { r: 0, g: 255, b: 200 };

    // Variables de control de vibración (Tus valores personalizados)
    let lastBass = 0;
    let kickCooldown = 0;
    let shakeOffset = 0;
    let activeGlowElements = [];

    // Inyector de estilos: Capas + Cursor Grueso + Sin barra negra + Resaltado
    function injectCustomStyles() {
        if (document.getElementById('yt-custom-styles-fix')) return;
        const style = document.createElement('style');
        style.id = 'yt-custom-styles-fix';
        style.innerHTML = `
            .xterm-screen, .xterm-rows {
                position: relative !important;
                z-index: 5 !important;
            }

            .xterm-selection {
                z-index: 4 !important;
            }

            /* 1. ELIMINAR LA FRANJA NEGRA QUE TAPA TODA LA LÍNEA DEL CURSOR */
            .monaco-editor .current-line,
            .monaco-editor .view-overlays .current-line,
            .monaco-editor .current-line-margin {
                background: transparent !important;
                background-color: transparent !important;
                border: none !important;
            }

            /* 2. HACER LA RAYITA DEL CURSOR MÁS GRUESA Y CON RESPLANDOR NEÓN */
            .monaco-editor .cursor {
                width: 3.5px !important; /* Puedes subirlo a 4px o 5px si la quieres más gruesa */
                background-color: var(--yt-sel-border, #ffffff) !important;
                box-shadow: 0 0 8px var(--yt-sel-border, rgba(255, 255, 255, 0.7)) !important;
                border-radius: 2px !important;
            }

            /* 3. Resaltado en el EDITOR NORMAL */
            .monaco-editor .selected-text,
            .monaco-editor .focused .selected-text {
                background-color: var(--yt-sel-bg, rgba(255, 255, 255, 0.35)) !important;
                outline: 1.5px solid var(--yt-sel-border, #ffffff) !important;
                outline-offset: -1px;
                box-shadow: 0 0 8px var(--yt-sel-border, rgba(255, 255, 255, 0.6)) !important;
                border-radius: 2px !important;
            }

            .monaco-editor .selectionHighlight {
                background-color: var(--yt-sel-bg, rgba(255, 255, 255, 0.20)) !important;
                outline: 1px dashed var(--yt-sel-border, rgba(255, 255, 255, 0.5)) !important;
            }

            /* 4. Resaltado en la TERMINAL (IDÉNTICO AL EDITOR) */
            .xterm .xterm-selection div,
            .xterm-selection div,
            .terminal .xterm-selection div,
            .terminal-wrapper .xterm-selection div {
                background-color: var(--yt-sel-bg, rgba(255, 255, 255, 0.35)) !important;
                outline: 1.5px solid var(--yt-sel-border, #ffffff) !important;
                outline-offset: -1px;
                box-shadow: 0 0 8px var(--yt-sel-border, rgba(255, 255, 255, 0.6)) !important;
                border-radius: 2px !important;
            }

            .xterm-rows ::selection {
                background-color: var(--yt-sel-bg, rgba(255, 255, 255, 0.35)) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function start() {
        injectCustomStyles();

        const editor = document.querySelector('.part.editor');
        if (!editor) {
            setTimeout(start, 100);
            return;
        }

        video = document.getElementById('yt-stream-bg');
        if (!video) {
            video = document.createElement('video');
            video.id = 'yt-stream-bg';
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.style.opacity = '0';
            editor.prepend(video);
        }

        initWS();
        setupTerminalCanvas();
    }

    function setupTerminalCanvas() {
        const wrapper = document.querySelector('.terminal-wrapper') || 
                        document.querySelector('.terminal-outer-container') || 
                        document.querySelector('.part.panel');

        if (!wrapper) {
            setTimeout(setupTerminalCanvas, 400);
            return;
        }

        canvas = document.getElementById('terminal-audio-vis');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'terminal-audio-vis';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '2';
            canvas.style.opacity = '0.90';
            ctx = canvas.getContext('2d');
        }

        if (canvas.parentElement !== wrapper) {
            wrapper.style.position = 'relative';
            wrapper.appendChild(canvas);
        }

        const resize = () => {
            if (wrapper.clientWidth > 0 && wrapper.clientHeight > 0) {
                canvas.width = wrapper.clientWidth;
                canvas.height = wrapper.clientHeight;
            }
        };
        new ResizeObserver(resize).observe(wrapper);
        resize();
    }

    function setupAudio(stream) {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 128;
                analyser.smoothingTimeConstant = 0.72;
                dataArray = new Uint8Array(analyser.frequencyBinCount);
            }

            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const audioStream = new MediaStream(stream.getAudioTracks());
            const source = audioCtx.createMediaStreamSource(audioStream);
            source.connect(analyser);

            if (!isDrawing) {
                isDrawing = true;
                drawLoop();
            }
        } catch(e) {
            console.warn('[VS Code BG] Audio setup warning:', e);
        }
    }

    // === EFECTO EXPLORER Y CALCULO DE COLOR NEGATIVO ===
    let frameCount = 0;
    function updateExplorerNeon(bassPulse, rawBass) {
        frameCount++;

        if (frameCount % 6 === 0 && video && video.readyState >= 2) {
            try {
                colorCtx.drawImage(video, 0, 0, 1, 1);
                let [r, g, b] = colorCtx.getImageData(0, 0, 1, 1).data;
                neonColor = { r, g, b };

                let invR = 255 - r;
                let invG = 255 - g;
                let invB = 255 - b;

                const invLum = 0.299 * invR + 0.587 * invG + 0.114 * invB;
                if (invLum < 100) {
                    invR = Math.min(255, invR + 110);
                    invG = Math.min(255, invG + 110);
                    invB = Math.min(255, invB + 110);
                }

                document.documentElement.style.setProperty('--yt-sel-bg', `rgba(${invR}, ${invG}, ${invB}, 0.38)`);
                document.documentElement.style.setProperty('--yt-sel-border', `rgb(${invR}, ${invG}, ${invB})`);
                document.documentElement.style.setProperty('--vscode-terminal-selectionBackground', `rgba(${invR}, ${invG}, ${invB}, 0.38)`);
            } catch(e) {}
        }

        // Control de vibración suave (TUS VALORES EXACTOS CONSERVADOS)
        if (kickCooldown > 0) {
            kickCooldown--;
            if (kickCooldown <= 2) shakeOffset = 0;
        } else if (rawBass > 150 && (rawBass - lastBass > 11)) {
            shakeOffset = 1.5;
            kickCooldown = 5;
        }
        lastBass = rawBass;

        const { r, g, b } = neonColor;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const isTooDark = luminance < 65;

        const displayColor = isTooDark ? '#ffffff' : `rgb(${r}, ${g}, ${b})`;
        const glowColor = isTooDark ? 'rgba(255, 255, 255, 0.85)' : `rgb(${r}, ${g}, ${b})`;

        const openTabElements = document.querySelectorAll('.tabs-and-actions-container .tab .label-name, .tab .tab-label');
        const openNames = new Set(Array.from(openTabElements).map(el => el.textContent.trim()));

        const explorerRows = document.querySelectorAll('.explorer-viewlet .monaco-list-row');
        const currentActive = [];

        explorerRows.forEach(row => {
            const label = row.querySelector('.label-name');
            if (!label) return;

            const fileName = label.textContent.trim();
            if (openNames.has(fileName)) {
                currentActive.push({ row, label });

                const glowPx = Math.round(bassPulse * 12);

                label.style.color = displayColor;
                label.style.fontWeight = 'bold';

                label.style.textShadow = bassPulse > 0.15 
                    ? `0 0 1px #fff, 0 0 ${glowPx}px ${glowColor}, 0 0 ${glowPx * 2}px ${glowColor}` 
                    : (isTooDark ? '0 0 2px rgba(255,255,255,0.7)' : 'none');

                row.style.transform = shakeOffset !== 0 ? `translateX(${shakeOffset}px)` : 'none';
                row.style.borderLeft = `3px solid ${glowColor}`;
                row.style.backgroundColor = bassPulse > 0.30 
                    ? (isTooDark ? `rgba(255, 255, 255, ${bassPulse * 0.12})` : `rgba(${r}, ${g}, ${b}, ${bassPulse * 0.15})`)
                    : 'transparent';
                row.style.transition = 'background-color 0.08s ease, border-left 0.08s ease';
            }
        });

        activeGlowElements.forEach(({ row, label }) => {
            if (!currentActive.some(item => item.row === row)) {
                label.style.color = '';
                label.style.fontWeight = '';
                label.style.textShadow = '';
                row.style.transform = '';
                row.style.borderLeft = '';
                row.style.backgroundColor = '';
            }
        });

        activeGlowElements = currentActive;
    }

    // === BUCLE PRINCIPAL DE ANIMACIÓN ===
    function drawLoop() {
        requestAnimationFrame(drawLoop);
        if (!analyser || !dataArray) return;

        analyser.getByteFrequencyData(dataArray);

        const rawBass = (dataArray[1] + dataArray[2] + dataArray[3] + dataArray[4]) / 4;
        const bassPulse = Math.min(1, Math.max(0, (rawBass - 40) / 150));

        updateExplorerNeon(bassPulse, rawBass);

        if (!ctx || !canvas || !video || video.readyState < 2) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const SENSITIVITY = 1.10;   
        const NOISE_FLOOR = 30;     
        const numBarsPerSide = 24;  
        const totalBars = numBarsPerSide * 2;
        const barWidth = canvas.width / totalBars;
        const blockHeight = 4;      
        const blockGap = 2;         
        const centerX = canvas.width / 2;
        const maxHeight = canvas.height * 0.78;

        ctx.save();
        ctx.beginPath();

        for (let i = 0; i < numBarsPerSide; i++) {
            const binIndex = Math.min(63, Math.floor(Math.pow(i / numBarsPerSide, 1.4) * 45) + 1);
            const rawFreq = dataArray[binIndex] || 0;

            const cleanFreq = Math.max(0, rawFreq - NOISE_FLOOR);
            const boostedFreq = Math.min(255, cleanFreq * SENSITIVITY);

            const barHeight = (boostedFreq / 255) * maxHeight;
            const totalBlocks = Math.floor(barHeight / (blockHeight + blockGap));

            const w = barWidth - 3;
            const xRight = centerX + (i * barWidth) + 1;
            const xLeft  = centerX - ((i + 1) * barWidth) + 2;

            for (let b = 0; b < totalBlocks; b++) {
                const y = canvas.height - (b + 1) * (blockHeight + blockGap) - 2;
                ctx.rect(xRight, y, w, blockHeight);
                ctx.rect(xLeft, y, w, blockHeight);
            }
        }

        ctx.clip();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const grad = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - maxHeight);
        grad.addColorStop(0, 'rgba(0, 255, 128, 0.35)');
        grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.35)');
        grad.addColorStop(1, 'rgba(255, 0, 180, 0.45)');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.restore();
    }

    function initWS() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => ws.send(JSON.stringify({ type: 'ready' }));

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'offer') {
                if (pc) {
                    try { pc.close(); } catch(err) {}
                    pc = null;
                }
                candidateQueue = [];
                pc = new RTCPeerConnection({ iceServers: [] });

                pc.ontrack = (event) => {
                    if (event.track.kind === 'video') {
                        if (video.srcObject !== event.streams[0]) {
                            video.srcObject = event.streams[0];
                            video.play().catch(console.error);
                            video.style.opacity = '0.40';
                        }
                    } else if (event.track.kind === 'audio') {
                        setupAudio(event.streams[0]);
                    }
                };

                pc.onicecandidate = (event) => {
                    if (event.candidate && ws?.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
                    }
                };

                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

                while (candidateQueue.length > 0) {
                    const cand = candidateQueue.shift();
                    await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
            } else if (data.type === 'candidate' && pc) {
                if (!pc.remoteDescription) {
                    candidateQueue.push(data.candidate);
                } else {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
                }
            } else if (data.type === 'state') {
                video.style.opacity = data.playing ? '0.40' : '0';
                if (canvas) canvas.style.opacity = data.playing ? '0.90' : '0';
                if (data.playing) {
                    video.play().catch(() => {});
                    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
                }
            }
        };

        ws.onclose = () => {
            if (video) video.style.opacity = '0';
            if (canvas) canvas.style.opacity = '0';
            setTimeout(initWS, 3000);
        };
    }

    start();
})();