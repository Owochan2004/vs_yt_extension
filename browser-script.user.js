// ==UserScript==
// @name         YouTube Streamer to VS Code
// @match        https://www.youtube.com/*
// @match        https://music.youtube.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ws, pc;
    const WS_URL = 'ws://localhost:9999';
    let lastVideoId = '';
    let debounceTimer = null;
    let candidateQueue = [];
    let currentStream = null;

    function initWS() {
        ws = new WebSocket(WS_URL);

        // AL CONECTARSE: Si ya hay un video sonando en YouTube, transmitir de inmediato a VS Code
        ws.onopen = () => {
            console.log('[VS Code Stream] Conectado al puente.');
            const video = document.querySelector('video');
            if (video && !video.paused && video.readyState >= 2) {
                console.log('[VS Code Stream] Video en curso detectado al conectar. Enviando a VS Code...');
                triggerStream(true);
            }
        };

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'ready') {
                console.log('[VS Code Stream] VS Code solicitó transmisión.');
                triggerStream(true);
            } else if (data.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    while (candidateQueue.length > 0) {
                        const cand = candidateQueue.shift();
                        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                    }
                }
            } else if (data.type === 'candidate' && pc) {
                if (!pc.remoteDescription) {
                    candidateQueue.push(data.candidate);
                } else {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
                }
            }
        };

        // Reintento rápido cada 1.5s para vincularse de inmediato al abrir VS Code
        ws.onclose = () => setTimeout(initWS, 1500);
    }

    function triggerStream(force = false) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            startStreaming(force);
        }, 400);
    }

    async function startStreaming(force = false) {
        const video = document.querySelector('video');
        const currentId = new URLSearchParams(location.search).get('v') || location.pathname;

        if (!video || video.readyState < 2 || (!force && currentId === lastVideoId)) {
            return;
        }

        lastVideoId = currentId;

        // Liberar pistas anteriores de memoria RAM
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
            currentStream = null;
        }

        if (pc) {
            try { pc.close(); } catch(e) {}
            pc = null;
        }

        candidateQueue = [];
        pc = new RTCPeerConnection({ iceServers: [] });

        pc.onicecandidate = (event) => {
            if (event.candidate && ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
            }
        };

        try {
            // Captura a 30 FPS optimizada
            currentStream = video.captureStream ? video.captureStream(30) : video.mozCaptureStream(30);
            currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
                ws.send(JSON.stringify({ type: 'state', playing: true }));
            }
        } catch (err) {
            console.error('[VS Code Stream] Error al capturar stream:', err);
        }
    }

    // Vigilante continuo: detecta si la música suena pero no hay transmisión activa
    function checkVideo() {
        const video = document.querySelector('video');
        if (!video) return;

        const currentId = new URLSearchParams(location.search).get('v') || location.pathname;

        // Si hay música sonando y cambió de tema O se perdió la conexión WebRTC, reconectar
        if (!video.paused && (currentId !== lastVideoId || !pc || pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
            triggerStream(currentId !== lastVideoId);
        }
    }

    initWS();
    setInterval(checkVideo, 1000);

    document.addEventListener('playing', (e) => {
        if (e.target.tagName === 'VIDEO') {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'state', playing: true }));
            }
            const currentId = new URLSearchParams(location.search).get('v') || location.pathname;
            if (currentId !== lastVideoId || !pc) {
                triggerStream(true);
            }
        }
    }, true);

    document.addEventListener('pause', (e) => {
        if (e.target.tagName === 'VIDEO' && !e.target.ended && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'state', playing: false }));
        }
    }, true);
})();