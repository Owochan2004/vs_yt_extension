// ==UserScript==
// @name         YouTube Streamer to VS Code
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ws, pc;
    const WS_URL = 'ws://localhost:9999';
    let lastVideoId = '';
    let debounceTimer = null;
    let candidateQueue = [];

    function initWS() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => console.log('[VS Code Stream] Conectado al puente.');

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'ready') {
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

        ws.onclose = () => setTimeout(initWS, 3000);
    }

    function triggerStream(force = false) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            startStreaming(force);
        }, 600);
    }

    async function startStreaming(force = false) {
        const video = document.querySelector('video');
        const currentId = new URLSearchParams(location.search).get('v');

        if (!video || video.readyState < 2 || (!force && currentId === lastVideoId)) {
            return;
        }

        lastVideoId = currentId;
        console.log('[VS Code Stream] Transmitiendo video:', currentId);

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
            const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

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

    function checkVideo() {
        const video = document.querySelector('video');
        if (!video) return;

        const currentId = new URLSearchParams(location.search).get('v');
        if (currentId && currentId !== lastVideoId && !video.paused) {
            triggerStream();
        }
    }

    initWS();
    setInterval(checkVideo, 1000);

    // SOLUCIÓN PAUSA / REANUDAR: Notifica siempre el estado
    document.addEventListener('playing', (e) => {
        if (e.target.tagName === 'VIDEO') {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'state', playing: true }));
            }
            const currentId = new URLSearchParams(location.search).get('v');
            if (currentId !== lastVideoId) {
                triggerStream();
            }
        }
    }, true);

    document.addEventListener('pause', (e) => {
        if (e.target.tagName === 'VIDEO' && !e.target.ended && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'state', playing: false }));
        }
    }, true);
})();