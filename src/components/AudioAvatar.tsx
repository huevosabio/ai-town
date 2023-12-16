// src/components/AudioAvatar.tsx
import { useState, useEffect, useRef } from 'react';
import { useAvatar } from '@avatechai/avatars/react'
import { ThreeJSPlugin } from "@avatechai/avatars/threejs";

interface AudioAvatarProps {
  audioUrl: string | undefined | null;
  avatarId: string | undefined;
}

export default function AudioAvatar({ audioUrl, avatarId }: AudioAvatarProps) {
  const audioSourceNode = useRef<AudioBufferSourceNode>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isTTSLoading = useRef(false);
  const [initAvatar, setInitAvatar] = useState(false);
  const { avatarDisplay, connectAudioContext, connectAudioNode } = useAvatar({
    avatarId,
    avatarLoaders: [ThreeJSPlugin],
    scale: -0.6,
    infoBox: false,
    className: "bg-brown-700 !h-[100px] sm:!h-[300px]",
    onAvatarLoaded: () => {
      setInitAvatar(true);
    },
  });

  useEffect(() => {
    if (!initAvatar) return;
    if (audioContextRef.current && audioContextRef.current.state === 'running') return;
    audioContextRef.current = new AudioContext();
    connectAudioContext(audioContextRef.current);
  }, [initAvatar]);

  useEffect(() => {
    if (!audioContextRef.current) return;
    if (isTTSLoading.current) return;

    if (audioUrl) {
      isTTSLoading.current = true;
      fetch(audioUrl).then(async (response) => {
        if (!audioContextRef.current) return;
        audioContextRef.current?.resume();

        if (audioSourceNode.current) {
          audioSourceNode.current.stop();
          audioSourceNode.current = undefined;
        }

        const val = await response.arrayBuffer();
        const _audioSourceNode = audioContextRef.current.createBufferSource();
        const buffer = await audioContextRef.current.decodeAudioData(val);
        _audioSourceNode.buffer = buffer;

        connectAudioNode(_audioSourceNode);
        _audioSourceNode.start();

        setIsLoading(false);
        isTTSLoading.current = false;

        audioSourceNode.current = _audioSourceNode;
        _audioSourceNode.onended = () => {
          audioSourceNode.current = undefined;
        };
      });
    }
  }, [audioUrl]);

  return (
    <>
      <div className="box">
        {avatarDisplay}
      </div>
    </>
  );
}