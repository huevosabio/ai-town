
const DEFAULT_PLAYHT_VOICE_URL = 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json';
const DEFAULT_ELEVENLANS_VOICE_URL = 'knrPHWnBmmDHMoiMeP3l';
const DEFAULT_TTS_PROVIDER = 'elevenlabs';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_turbo_v2';

export async function textToSpeech(text: string, voiceUrl?: string): Promise<any> {
  const ttsProvider = process.env.TTS_PROVIDER || DEFAULT_TTS_PROVIDER;
  switch (ttsProvider) {
    case 'elevenlabs':
      return textToSpeechElevenLabs(text, voiceUrl);
    case 'playht':
      return textToSpeechPHT(text, voiceUrl);
    default:
      throw new Error(`Unknown TTS provider ${ttsProvider}`);
  }
}

export async function textToSpeechElevenLabs(text: string, voiceUrl?: string): Promise<any> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
  const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || '';
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_API_URL) {
    throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_API_URL must be set');
  }
  const url = `${ELEVENLABS_API_URL}/${voiceUrl || DEFAULT_ELEVENLANS_VOICE_URL}`;
  const options = {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model_id: process.env.ELEVENLABS_MODEL || DEFAULT_ELEVENLABS_MODEL,
      text: text,
      voice_settings: {
        similarity_boost: 0.8,
        stability: 0.3
      },
    })
  };

  try {
    const response = await fetch(url, options);
    const audioFile = await response.blob();
    return audioFile;
  } catch (error) {
    throw error;
  }
}

export async function textToSpeechPHT(text: string, voiceUrl?: string): Promise<any> {
  const PLAYHT_USER_ID = process.env.PLAYHT_USER_ID || '';
  const PLAYHT_API_KEY = process.env.PLAYHT_API_KEY || '';
  if (!PLAYHT_USER_ID || !PLAYHT_API_KEY) {
    throw new Error('PLAYHT_USER_ID and PLAYHT_API_KEY must be set');
  }
  const url = 'https://api.play.ht/api/v2/tts/stream';
  const options = {
    method: 'POST',
    headers: {
      accept: 'audio/mpeg',
      'content-type': 'application/json',
      AUTHORIZATION: PLAYHT_API_KEY,
      'X-USER-ID': PLAYHT_USER_ID
    },
    body: JSON.stringify({
      text: text,
      voice: voiceUrl || DEFAULT_PLAYHT_VOICE_URL,
      output_format: 'mp3'
    })
  };

  try {
    const response = await fetch(url, options);
    const audioFile = await response.blob();
    return audioFile;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}