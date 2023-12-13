

export async function textToSpeech(text: string): Promise<any> {
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
      voice: 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json',
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