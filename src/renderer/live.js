// Live listening with Deepgram: the microphone streams to Deepgram, words
// appear while the user talks, and Deepgram decides when the sentence ends
// (much better than a volume threshold). Needs the user's own Deepgram key.
window.JudithLive = (() => {
  const RATE = 16000;
  let session = null;
  let attempt = 0;

  // onPartial(text): the sentence so far. onEnd(text): the final sentence, '' if nothing.
  async function start({ key, model = 'nova-3', language = 'fr', keyterms = [], onPartial = () => {}, onLevel = () => {}, onEnd = () => {}, noSpeechMs = 6000 }) {
    stop();
    const mine = ++attempt;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (mine !== attempt) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    const params = new URLSearchParams({
      model, language,
      encoding: 'linear16', sample_rate: String(RATE), channels: '1',
      interim_results: 'true', smart_format: 'true', punctuate: 'true',
      endpointing: '400', utterance_end_ms: '1200', vad_events: 'true',
    });
    for (const term of keyterms) params.append('keyterm', term);
    const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key]);
    socket.binaryType = 'arraybuffer';

    const context = new AudioContext({ sampleRate: RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const waiting = []; // audio recorded before the socket is open
    let finalText = '';
    let heardAt = null;
    const startedAt = performance.now();

    session = { stream, context, processor, socket, done: false, onEnd, finish: null };

    const finish = () => {
      if (!session || session.done) return;
      session.done = true;
      const text = finalText.trim();
      stop();
      onEnd(text);
    };
    session.finish = finish;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const v = Math.max(-1, Math.min(1, input[i]));
        sum += v * v;
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      onLevel(Math.min(1, Math.sqrt(sum / input.length) * 12));
      if (socket.readyState === WebSocket.OPEN) socket.send(pcm.buffer);
      else if (socket.readyState === WebSocket.CONNECTING) waiting.push(pcm.buffer);
      if (heardAt === null && performance.now() - startedAt > noSpeechMs) finish();
      if (performance.now() - startedAt > 30000) finish();
    };
    source.connect(processor);
    processor.connect(context.destination);

    socket.onopen = () => waiting.splice(0).forEach((chunk) => socket.send(chunk));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'Results') {
        const text = message.channel?.alternatives?.[0]?.transcript ?? '';
        if (!text) return;
        heardAt = performance.now();
        if (message.is_final) finalText += `${finalText ? ' ' : ''}${text}`;
        onPartial(message.is_final ? finalText : `${finalText} ${text}`.trim());
        if (message.speech_final && finalText) finish();
      } else if (message.type === 'UtteranceEnd' && finalText) {
        finish();
      }
    };
    socket.onerror = () => finish();
    socket.onclose = () => finish();
    return true;
  }

  function stop() {
    if (!session) return;
    const { stream, context, processor, socket } = session;
    session = null;
    processor.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    context.close();
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }));
    socket.close();
  }

  return {
    start,
    finish: () => session?.finish?.(),
    cancel() {
      attempt += 1;
      stop();
    },
    get listening() {
      return session !== null && !session.done;
    },
  };
})();
